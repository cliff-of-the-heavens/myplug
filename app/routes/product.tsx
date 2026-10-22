import { and, asc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import {
  CalendarCheckIcon,
  MessageCircleIcon,
  MinusIcon,
  PencilIcon,
  PlusIcon,
  RepeatIcon,
  ShieldCheckIcon,
  ShoppingBagIcon,
  SparklesIcon,
  StoreIcon,
  WandSparklesIcon,
} from "lucide-react";
import { useState } from "react";
import { AvailabilityCalendar, availabilityRange } from "~/components/booking-calendar";
import { BusinessBadge } from "~/components/business-badge";
import { DeliveryFields } from "~/components/delivery-fields";
import { DealCountdown, priceDisplay } from "~/components/price";
import { ShareButton } from "~/components/share-button";
import { CartButtons, FavouriteButton } from "~/components/shopping";
import { data, Form, Link, redirect, useNavigation } from "react-router";
import { AuthLink } from "~/components/auth-dialog";
import { FollowStoreButton } from "~/components/follow-store";
import { FormError, Container } from "~/components/page";
import { ProductShelf } from "~/components/product-card";
import { ReportButton } from "~/components/report-button";
import { SafeImage } from "~/components/safe-image";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Field, Input, NativeSelect, Textarea } from "~/components/ui/input";
import { db, schema } from "~/db/client.server";
import { getFollowState } from "~/lib/alerts.server";
import { getUser, requireCustomer } from "~/lib/auth.server";
import { getFeed } from "~/lib/catalog.server";
import type { PaymentTiming, PlanFrequency } from "~/db/schema";
import { addDays, formatDay, FREQUENCIES, FREQUENCY_LABEL, today } from "~/lib/dates";
import { date, money, stockLabel } from "~/lib/format";
import { useOptionalUser } from "~/lib/hooks";
import { findOrCreateConversation } from "~/lib/messaging.server";
import { BILL_TERMS_DAYS } from "~/lib/orders";
import { bookedCounts, OrderError, placeOrder } from "~/lib/orders.server";
import { createPlan } from "~/lib/recurring.server";
import { offerTerms } from "~/lib/digital";
import { offersFor } from "~/lib/digital.server";
import { liveSalesFor } from "~/lib/pricing.server";
import { listAddresses } from "~/lib/addresses.server";
import { publicBusinessInfo } from "~/lib/business.server";
import { availableCouriers, createDeliveryTx, deliveryFromForm, notifyInvitedCouriers, usualCouriers } from "~/lib/delivery.server";
import { notify } from "~/lib/notify.server";
import { cn, str } from "~/lib/utils";
import type { Route } from "./+types/product";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data ? `${data.product.title} · MyPlug` : "Product · MyPlug" }];
}

async function loadProduct(id: string) {
  return db.query.products.findFirst({
    where: eq(schema.products.id, id),
    columns: { mediaKey: false }, // the purchased file is private; it never goes to the browser
    // Only public store fields: review notes and other admin data must not reach the page.
    with: {
      store: {
        columns: { id: true, ownerId: true, name: true, slug: true, currency: true, status: true, createdAt: true, deliveryMode: true, preferredCourierId: true },
        with: { preferredCourier: { columns: { name: true } } },
      },
      category: true,
      images: { orderBy: asc(schema.productImages.position), columns: { id: true, url: true } },
    },
  });
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const [product, user] = await Promise.all([loadProduct(params.id), getUser(request)]);
  const isOwner = !!user?.storeId && product?.storeId === user.storeId;
  const visible = product?.isActive && product.store.status === "approved";
  if (!product || (!visible && !isOwner && user?.role !== "admin")) throw data("Product not found", { status: 404 });

  const related = await getFeed(
    10,
    and(
      ne(schema.products.id, product.id),
      product.categoryId
        ? eq(schema.products.categoryId, product.categoryId)
        : eq(schema.products.storeId, product.storeId),
    ),
  );
  const follow = await getFollowState(user, product.storeId);
  const booking = product.kind === "service" ? await bookingInfo(product.id, product.storeId) : null;
  // What the order form needs to offer delivery choices (customers ordering physical products only).
  const checkout =
    user?.role === "customer" && product.kind === "product"
      ? {
          addresses: await listAddresses(user.id),
          couriers: product.store.deliveryMode === "customer" ? await availableCouriers() : [],
          usualCourierIds: product.store.deliveryMode === "customer" ? await usualCouriers(user.id) : [],
        }
      : null;
  const business = await publicBusinessInfo(product.storeId);
  const digital =
    product.kind === "digital"
      ? {
          offers: await offersFor(product.id),
          owned:
            user?.role === "customer"
              ? await db.query.digitalGrants.findMany({
                  where: and(eq(schema.digitalGrants.productId, product.id), eq(schema.digitalGrants.userId, user.id)),
                  columns: { id: true, label: true, activatedAt: true },
                })
              : [],
        }
      : null;
  // Live sale (timed deal, store-wide or per-item discount) on this product
  const sales = (await liveSalesFor(product.storeId)).filter((d) => d.allProducts || d.products.some((p) => p.productId === product.id));
  const best = sales.sort((a, b) => (b.percentOff ?? 0) - (a.percentOff ?? 0))[0];
  const sale = best?.percentOff ? { pct: best.percentOff, endsAt: best.endsAt, name: best.name } : null;
  return { product, related, isOwner, follow, booking, checkout, business, digital, sale };
}

const CALENDAR_DAYS = 63; // nine weeks ahead

/**
 * What customers see before booking a service: free/full days, and the provider's
 * track record (counts only, so no customer's details are exposed).
 */
async function bookingInfo(productId: string, storeId: string) {
  const { orders } = schema;
  const from = addDays(today(), 1);
  const yearAgo = addDays(today(), -365);
  const [booked, [record]] = await Promise.all([
    bookedCounts(productId, from, addDays(from, CALENDAR_DAYS - 1)),
    db
      .select({
        completed: sql<number>`count(*) filter (where ${orders.status} = 'delivered')::int`,
        completedYear: sql<number>`count(*) filter (where ${orders.status} = 'delivered' and ${orders.bookingDate} >= ${yearAgo})::int`,
        upcoming: sql<number>`count(*) filter (where ${orders.status} in ('confirmed','processing') and ${orders.bookingDate} > ${today()})::int`,
        cancelledByProvider: sql<number>`count(*) filter (where ${orders.status} = 'cancelled' and ${orders.bookingDate} >= ${yearAgo})::int`,
        lastCompleted: sql<string | null>`max(${orders.bookingDate}) filter (where ${orders.status} = 'delivered')`,
      })
      .from(orders)
      // Bookings are dated orders that aren't part of a recurring delivery plan.
      .where(and(eq(orders.storeId, storeId), isNotNull(orders.bookingDate), isNull(orders.planId))),
  ]);
  return { days: availabilityRange(from, CALENDAR_DAYS, booked), record };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireCustomer(request);
  const form = await request.formData();
  const intent = form.get("intent");
  const product = await loadProduct(params.id);
  if (!product || !product.isActive) throw data("Product not found", { status: 404 });

  if (intent === "order" || intent === "book") {
    const paymentTiming: PaymentTiming = form.get("payment") === "prepaid" ? "prepaid" : "on_delivery";
    try {
      // Products: address book + delivery choices. Bookings: just the venue.
      const delivery =
        intent === "order" ? await deliveryFromForm(form, user.id, product.store.deliveryMode, product.store.preferredCourierId) : null;
      const address = delivery?.shippingAddress ?? str(form.get("address"));
      if (address.length < 10) return { error: `Please enter a full ${intent === "book" ? "event" : "delivery"} address.` };
      // Repeat deliveries become a plan; each delivery is then created as its own order.
      if (intent === "order" && form.get("repeat") === "on") {
        const plan = await createPlan({
          customerId: user.id,
          productId: product.id,
          quantity: Number(form.get("quantity")),
          frequency: str(form.get("frequency")) as PlanFrequency,
          startOn: str(form.get("startOn")),
          endOn: str(form.get("endOn")) || null,
          paymentTiming,
          shippingAddress: address,
          notes: str(form.get("notes")),
          deliveryPrefs: delivery
            ? {
                method: delivery.method,
                courierId: delivery.directCourierId,
                handover: delivery.handover,
                delegateName: delivery.delegateName,
                delegatePhone: delivery.delegatePhone,
                recipientName: delivery.address.recipientName,
                recipientPhone: delivery.address.phone,
                area: delivery.address.area,
                city: delivery.address.city,
              }
            : undefined,
        });
        return redirect(`/account/plans?created=${plan.number}`);
      }
      const order = await placeOrder({
        customerId: user.id,
        productId: product.id,
        quantity: intent === "book" ? 1 : Number(form.get("quantity")),
        shippingAddress: address,
        notes: str(form.get("notes")),
        paymentTiming,
        bookingDate: intent === "book" ? str(form.get("bookingDate")) : null,
        createDelivery: delivery ? (tx, orderId) => createDeliveryTx(tx, orderId, delivery) : undefined,
      });
      await notifyInvitedCouriers(order.id);
      await notify([product.store.ownerId], {
        title: `New ${intent === "book" ? "booking request" : "order"} ${order.number}`,
        body: `${product.title}${intent === "book" ? ` on ${str(form.get("bookingDate"))}` : ""}`,
        href: `/sell/orders/${order.id}`,
      }, { email: true });
      return redirect(`/account/orders/${order.id}?placed=1`);
    } catch (e) {
      if (e instanceof OrderError) return { error: e.message };
      throw e;
    }
  }

  if (intent === "buy") {
    try {
      const order = await placeOrder({
        customerId: user.id,
        productId: product.id,
        quantity: 1,
        shippingAddress: "Digital purchase",
        offerId: str(form.get("offerId")),
        paymentTiming: "prepaid",
      });
      await notify([product.store.ownerId], { title: `New purchase ${order.number}`, body: product.title, href: `/sell/orders/${order.id}` }, { email: true });
      return redirect(`/account/orders/${order.id}?placed=1`);
    } catch (e) {
      if (e instanceof OrderError) return { error: e.message };
      throw e;
    }
  }

  if (intent === "message" || intent === "special") {
    const special = intent === "special";
    const convo = await findOrCreateConversation({
      customerId: user.id,
      storeId: product.storeId,
      productId: product.id,
      subject: special ? `Special order: ${product.title}` : product.title,
      isSpecialOrder: special,
    });
    return redirect(`/messages/${convo.id}`);
  }

  throw data("Unknown action", { status: 400 });
}

type LoadedProduct = Route.ComponentProps["loaderData"]["product"];

/** Pay after delivery (default) or in advance. */
function PaymentChoice({ afterLabel }: { afterLabel: string }) {
  const [value, setValue] = useState<PaymentTiming>("on_delivery");
  const options: [PaymentTiming, string, string][] = [
    ["on_delivery", afterLabel, `Bill due ${BILL_TERMS_DAYS} days after it's done`],
    ["prepaid", "Pay in advance", "Pay first; the merchant starts once it's received"],
  ];
  return (
    <fieldset className="grid grid-cols-2 gap-2">
      <legend className="mb-1.5 text-sm font-semibold">Payment</legend>
      {options.map(([v, label, text]) => (
        <label
          key={v}
          className={cn("flex cursor-pointer gap-2 rounded-xl border-2 p-2.5 text-sm", value === v ? "border-primary bg-primary/5" : "hover:border-primary/40")}
        >
          <input type="radio" name="payment" value={v} checked={value === v} onChange={() => setValue(v)} className="mt-0.5 accent-primary" />
          <span className="grid">
            <span className="font-semibold">{label}</span>
            <span className="text-xs text-muted-foreground">{text}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

type Checkout = NonNullable<Route.ComponentProps["loaderData"]["checkout"]>;

function OrderBox({ product, checkout }: { product: LoadedProduct; checkout: Checkout }) {
  const [qty, setQty] = useState(1);
  // One-off purchases go through the cart; this form sets up repeat deliveries.
  const repeat = true;
  const nav = useNavigation();
  const busy = nav.state !== "idle" && nav.formData?.get("intent") === "order";
  // Repeat orders don't reserve stock up front, so the in-stock count only limits one-off orders.
  const max = product.trackStock && !repeat ? product.quantity : 999;
  const tomorrow = addDays(today(), 1);

  return (
    <Form method="post" encType="multipart/form-data" className="grid gap-4">
      <input type="hidden" name="intent" value="order" />
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold">Quantity</span>
        <div className="flex items-center rounded-full border-2">
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Less">
            <MinusIcon />
          </Button>
          <input
            name="quantity"
            type="number"
            min={1}
            max={max}
            value={qty}
            onChange={(e) => setQty(Math.min(max, Math.max(1, Number(e.target.value) || 1)))}
            className="w-12 bg-transparent text-center font-bold outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
          />
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => setQty((q) => Math.min(max, q + 1))} aria-label="More">
            <PlusIcon />
          </Button>
        </div>
        <span className="ml-auto text-sm text-muted-foreground">
          {repeat ? "Each delivery" : "Total"}{" "}
          <strong className="text-lg text-foreground">{money(product.priceCents * qty, product.store.currency)}</strong>
        </span>
      </div>
      <input type="hidden" name="repeat" value="on" />
      <p className="text-xs text-muted-foreground">Each delivery is billed separately, at the price on the day.</p>
      {repeat ? (
        <div className="grid gap-3 rounded-xl bg-muted/50 p-3 sm:grid-cols-3">
          <Field label="How often">
            <NativeSelect name="frequency" defaultValue="daily">
              {FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {FREQUENCY_LABEL[f]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="First delivery">
            <Input name="startOn" type="date" min={tomorrow} defaultValue={tomorrow} required />
          </Field>
          <Field label="Last delivery (optional)">
            <Input name="endOn" type="date" min={tomorrow} />
          </Field>
        </div>
      ) : null}
      <PaymentChoice afterLabel="Pay after delivery" />
      <DeliveryFields
        addresses={checkout.addresses}
        mode={product.store.deliveryMode}
        storeName={product.store.name}
        storeCourierName={product.store.preferredCourier?.name ?? null}
        couriers={checkout.couriers}
        usualCourierIds={checkout.usualCourierIds}
        currency={product.store.currency}
        repeat={repeat}
      />
      <Field label="Notes for the merchant (optional)">
        <Textarea name="notes" rows={2} className="min-h-0" />
      </Field>
      <Button type="submit" size="lg" disabled={busy}>
        {repeat ? <RepeatIcon /> : <ShoppingBagIcon />} {busy ? "Placing order..." : repeat ? "Start repeat order" : "Place order"}
      </Button>
      <p className="text-xs text-muted-foreground">
        {repeat
          ? "Manage, pause or cancel repeat orders under My orders → Repeat orders."
          : "Track your order and bill any time under My orders."}
      </p>
    </Form>
  );
}

function BookingBox({ product, booking }: { product: LoadedProduct; booking: NonNullable<Route.ComponentProps["loaderData"]["booking"]> }) {
  const [day, setDay] = useState<string | null>(null);
  const nav = useNavigation();
  const busy = nav.state !== "idle" && nav.formData?.get("intent") === "book";
  return (
    <Form method="post" className="grid gap-4">
      <input type="hidden" name="intent" value="book" />
      <input type="hidden" name="bookingDate" value={day ?? ""} />
      <div className="grid gap-1">
        <p className="text-sm font-semibold">Pick a date</p>
        <AvailabilityCalendar days={booking.days} capacity={product.dailyCapacity ?? 1} selected={day} onSelect={setDay} />
      </div>
      <p className="text-sm">
        {day ? (
          <>
            Booking for <strong>{formatDay(day, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</strong> · from{" "}
            <strong>{money(product.priceCents, product.store.currency)}</strong>
          </>
        ) : (
          <span className="text-muted-foreground">Tap a green day to choose it. Need a date further ahead? Message the provider.</span>
        )}
      </p>
      <PaymentChoice afterLabel="Pay after the event" />
      <Field label="Event address / venue">
        <Textarea name="address" required minLength={10} rows={2} placeholder="Venue, area, city" />
      </Field>
      <Field label="Event details (optional)" hint="Times, number of guests, theme, anything the provider should know">
        <Textarea name="notes" rows={2} className="min-h-0" />
      </Field>
      <Button type="submit" size="lg" disabled={busy || !day}>
        <CalendarCheckIcon /> {busy ? "Sending..." : "Request booking"}
      </Button>
      <p className="text-xs text-muted-foreground">
        The date is yours once the provider confirms. When a day's bookings are full, nobody else can book it.
      </p>
    </Form>
  );
}

function DigitalBox({ product, digital }: { product: LoadedProduct; digital: NonNullable<Route.ComponentProps["loaderData"]["digital"]> }) {
  const [offerId, setOfferId] = useState(digital.offers[0]?.id ?? "");
  const busy = useNavigation().formData?.get("intent") === "buy";
  return (
    <Form method="post" className="grid gap-3">
      <input type="hidden" name="intent" value="buy" />
      {digital.owned.length ? (
        <p className="rounded-lg bg-success/15 p-2 text-sm text-success">
          You own this ({digital.owned.map((g) => g.label).join(", ")}).{" "}
          <Link to="/account/library" className="font-semibold underline">Open your library</Link>
        </p>
      ) : null}
      {digital.offers.map((o) => (
        <label key={o.id} className={cn("flex cursor-pointer items-center gap-3 rounded-xl border-2 p-3 text-sm", offerId === o.id ? "border-primary bg-primary/5" : "hover:border-primary/40")}>
          <input type="radio" name="offerId" value={o.id} checked={offerId === o.id} onChange={() => setOfferId(o.id)} className="accent-primary" />
          <span className="grid flex-1">
            <span className="font-semibold">{o.label}</span>
            <span className="text-xs text-muted-foreground">{offerTerms(o, product.mediaType)}</span>
          </span>
          <span className="font-black">{money(o.priceCents, product.store.currency)}</span>
        </label>
      ))}
      <Button type="submit" size="lg" disabled={busy || !offerId}>
        <ShoppingBagIcon /> {busy ? "Placing order..." : "Buy"}
      </Button>
      <p className="text-xs text-muted-foreground">
        You pay the seller first and report your payment on the order. Access opens in your library once they confirm it.
      </p>
    </Form>
  );
}

/** Free sample: video/audio player or PDF viewer. */
function Preview({ url, type }: { url: string; type: "video" | "audio" | "document" | null }) {
  if (type === "video") return <video src={url} controls preload="metadata" className="w-full rounded-2xl border bg-black" />;
  if (type === "audio") return <audio src={url} controls preload="metadata" className="w-full" />;
  return <iframe src={url} title="Preview" className="h-96 w-full rounded-2xl border" />;
}

/** Public, anonymous track record of a service provider, so customers can check they're genuine. */
function TrackRecord({ record, since }: { record: NonNullable<Route.ComponentProps["loaderData"]["booking"]>["record"]; since: Date | string }) {
  const items = [
    ["Bookings completed", record.completed],
    ["Completed in the last year", record.completedYear],
    ["Confirmed upcoming", record.upcoming],
  ] as const;
  return (
    <div className="grid gap-3 rounded-2xl border bg-card p-5">
      <h2 className="flex items-center gap-2 font-bold">
        <ShieldCheckIcon className="size-5 text-success" /> Provider's booking record
      </h2>
      <div className="grid grid-cols-3 gap-2 text-center">
        {items.map(([label, n]) => (
          <div key={label} className="rounded-xl bg-muted/50 p-2">
            <p className="text-2xl font-black">{n}</p>
            <p className="text-[11px] text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        On MyPlug since {date(since)}
        {record.lastCompleted ? ` · last completed booking ${formatDay(record.lastCompleted, { day: "numeric", month: "short", year: "numeric" })}` : ""}
        {record.cancelledByProvider ? ` · ${record.cancelledByProvider} cancelled in the last year` : ""}. Counted from bookings made
        on MyPlug; customers' details are never shown.
      </p>
    </div>
  );
}

export default function ProductPage({ loaderData, actionData }: Route.ComponentProps) {
  const { product, related, isOwner, follow, booking, sale } = loaderData;
  const price = priceDisplay({ ...product, salePct: sale?.pct });
  const user = useOptionalUser();
  const stock = stockLabel(product.quantity, product.trackStock);
  const isService = product.kind === "service";
  const available = isService || !product.trackStock || product.quantity > 0;
  const [photo, setPhoto] = useState<string | null>(null);
  const photos = [...(product.imageUrl && !product.imageHidden ? [product.imageUrl] : []), ...product.images.map((i) => i.url)];

  return (
    <Container className="py-6 md:py-10">
      <nav className="mb-4 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-primary">Home</Link>
        {product.category ? (
          <>
            {" / "}
            <Link to={`/search?category=${product.category.slug}`} className="hover:text-primary">
              {product.category.name}
            </Link>
          </>
        ) : null}
      </nav>

      <div className="grid gap-8 md:grid-cols-2 lg:gap-12">
        <div className="grid gap-2">
          <SafeImage
            src={photo ?? product.imageUrl}
            hidden={!photo && product.imageHidden}
            alt={product.title}
            className="aspect-square rounded-2xl border"
          />
          {photos.length > 1 ? (
            <div className="scrollbar-none flex gap-2 overflow-x-auto">
              {photos.map((url) => (
                <button
                  key={url}
                  type="button"
                  onClick={() => setPhoto(url)}
                  className={cn("size-16 shrink-0 overflow-hidden rounded-lg border-2", (photo ?? photos[0]) === url ? "border-primary" : "border-transparent")}
                >
                  <img src={url} alt="" className="size-full object-cover" loading="lazy" />
                </button>
              ))}
            </div>
          ) : null}
          <ReportButton targetType="product" targetId={product.id} label="Report this listing" className="justify-self-end" />
        </div>

        <div className="grid content-start gap-5">
          <div className="grid gap-2">
            {!product.isActive ? <Badge variant="muted">Hidden from shoppers</Badge> : null}
            <div className="flex items-start gap-2">
              <h1 className="flex-1 text-2xl font-extrabold tracking-tight md:text-3xl">{product.title}</h1>
              <FavouriteButton productId={product.id} className="mt-1" />
              <ShareButton path={`/p/${product.id}`} title={product.title} text={`${product.title} on MyPlug`} />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Link to={`/s/${product.store.slug}`} className="flex w-fit items-center gap-1.5 text-sm font-semibold text-accent hover:underline">
                <StoreIcon className="size-4" /> {product.store.name}
              </Link>
              <BusinessBadge storeName={product.store.name} info={loaderData.business} />
              {!isOwner ? (
                <FollowStoreButton storeId={product.store.id} storeName={product.store.name} follow={follow} className="h-8 px-3 text-xs" />
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-baseline gap-3">
            {isService ? <span className="text-sm text-muted-foreground">from</span> : null}
            <span className="text-4xl font-black text-primary">{money(price.now, product.store.currency)}</span>
            {price.was ? <span className="text-lg text-muted-foreground line-through">{money(price.was, product.store.currency)}</span> : null}
            {price.pct ? <Badge variant="highlight">-{price.pct}%</Badge> : null}
            {isService ? (
              <Badge variant="accent">
                <CalendarCheckIcon /> Up to {product.dailyCapacity ?? 1} booking{(product.dailyCapacity ?? 1) > 1 ? "s" : ""} a day
              </Badge>
            ) : (
              <Badge variant={stock.tone === "out" ? "destructive" : stock.tone === "low" ? "warning" : "success"}>
                {stock.text}
              </Badge>
            )}
          </div>
          {sale ? (
            <p className="-mt-3 flex flex-wrap items-center gap-2 text-sm font-semibold text-primary">
              {sale.name}
              {sale.endsAt ? <DealCountdown endsAt={sale.endsAt} /> : null}
            </p>
          ) : null}
          {!isService && product.trackStock && product.quantity > 0 ? (
            <p className="-mt-3 text-sm text-muted-foreground">{product.quantity} available</p>
          ) : null}

          <div className="rounded-2xl border bg-card p-5">
            <FormError error={actionData && "error" in actionData ? actionData.error : null} />
            {isOwner ? (
              <Button asChild variant="outline">
                <Link to={`/sell/products/${product.id}`}>
                  <PencilIcon /> Edit this listing
                </Link>
              </Button>
            ) : !user ? (
              <div className="grid gap-3">
                <p className="text-sm text-muted-foreground">
                  Sign in as a customer to {isService ? "book" : "order"} or message this merchant.
                </p>
                {booking ? <AvailabilityCalendar days={booking.days} capacity={product.dailyCapacity ?? 1} /> : null}
                <Button asChild size="lg">
                  <AuthLink mode="login">Sign in to {isService ? "book" : "order"}</AuthLink>
                </Button>
              </div>
            ) : user.role !== "customer" ? (
              <div className="grid gap-3">
                <p className="text-sm text-muted-foreground">{isService ? "Booking" : "Ordering"} is available to customer accounts only.</p>
                {booking ? <AvailabilityCalendar days={booking.days} capacity={product.dailyCapacity ?? 1} /> : null}
              </div>
            ) : loaderData.digital ? (
              <DigitalBox product={product} digital={loaderData.digital} />
            ) : booking ? (
              <BookingBox product={product} booking={booking} />
            ) : available ? (
              <div className="grid gap-3">
                <CartButtons productId={product.id} storeId={product.store.id} max={product.trackStock ? product.quantity : 999} />
                <details className="group rounded-xl border p-3">
                  <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
                    <RepeatIcon className="size-4 text-primary" /> Deliver on repeat instead (e.g. daily bread)
                  </summary>
                  <div className="mt-3">
                    <OrderBox product={product} checkout={loaderData.checkout!} />
                  </div>
                </details>
              </div>
            ) : (
              <p className="text-sm">
                <strong>Out of stock.</strong> Tap <em>Get alerts</em> above to get an email when it's back, or message
                the merchant below.
              </p>
            )}
          </div>

          {user?.role === "customer" && !isOwner ? (
            <Form method="post" className="grid grid-cols-2 gap-3">
              <Button type="submit" name="intent" value="message" variant="outline">
                <MessageCircleIcon /> Ask a question
              </Button>
              <Button type="submit" name="intent" value="special" variant="accent">
                <WandSparklesIcon /> Special order
              </Button>
            </Form>
          ) : null}

          {booking ? <TrackRecord record={booking.record} since={product.store.createdAt} /> : null}

          {product.kind === "digital" && product.previewUrl ? (
            <div className="grid gap-2">
              <h2 className="font-bold">Free preview</h2>
              <Preview url={product.previewUrl} type={product.mediaType} />
            </div>
          ) : null}

          {product.description ? (
            <div className="grid gap-2">
              <h2 className="font-bold">{isService ? "About this service" : "About this item"}</h2>
              <p className="whitespace-pre-line text-muted-foreground">{product.description}</p>
            </div>
          ) : null}

          {product.references ? (
            <div className="grid gap-2">
              <h2 className="font-bold">References & past work</h2>
              <p className="whitespace-pre-line text-muted-foreground">{product.references}</p>
              <p className="text-xs text-muted-foreground">Provided by the merchant. Ask them for contact details if you want to check a reference.</p>
            </div>
          ) : null}
        </div>
      </div>

      {related.length ? (
        <section className="mt-12 grid gap-4">
          <h2 className="flex items-center gap-2 text-xl font-extrabold">
            <SparklesIcon className="size-5 text-primary" /> You might also like
          </h2>
          <ProductShelf products={related} />
        </section>
      ) : null}
    </Container>
  );
}

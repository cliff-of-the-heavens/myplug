import { and, asc, eq } from "drizzle-orm";
import { data, Form, Link, useNavigation, useRouteLoaderData } from "react-router";
import { useState } from "react";
import { AlertFields } from "~/components/alert-composer";
import { DigitalFields } from "~/components/digital-fields";
import { GalleryField } from "~/components/gallery-field";
import { LocationFields } from "~/components/location-fields";
import { ImageDropzone } from "~/components/image-dropzone";
import { FormError, PageHeader } from "~/components/page";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Field, Input, NativeSelect, Textarea } from "~/components/ui/input";
import { db, schema } from "~/db/client.server";
import { alertType as alertTypeEnum, mediaType as mediaTypeEnum, type AlertType, type ListingType, type MediaType, type PriceType, type ProductKind, type PropertyFeatures } from "~/db/schema";
import { PropertyFields } from "~/components/property-fields";
import { AutoFields } from "~/components/auto-fields";
import { ConditionField } from "~/components/condition-guide";
import { isItemCondition } from "~/lib/condition";
import { AUTO_CATEGORY_SLUG, autoFromForm, type AutoDetails } from "~/lib/auto";
import { assertCanAddListing, BandError, maxPhotos, storePlan } from "~/lib/bands.server";
import { featuresFromForm, LISTING_TYPES, needsTitleDeed, PRICE_TYPES } from "~/lib/property";
import { DigitalError, offersFromForm, saveDigital } from "~/lib/digital.server";
import { ALERT_NAME } from "~/lib/alerts";
import { AlertError, getQuota, sendAlert, subscriberCounts } from "~/lib/alerts.server";
import { redirectWithFlash, requireMerchant } from "~/lib/auth.server";
import { currencySymbol, parseMoney } from "~/lib/format";
import { parseLocations } from "~/lib/locations";
import { getStorageSettings, isOwnUpload, resolveBackend } from "~/lib/storage.server";
import { uploadImage, UploadError } from "~/lib/upload.server";
import { capitalize, cn, str } from "~/lib/utils";
import type { loader as rootLoader } from "~/root";
import type { Route } from "./+types/sell.product-form";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `${data?.product ? "Edit" : "New"} listing · MyPlug` }];
}


async function ownProduct(storeId: string, id: string) {
  const product = await db.query.products.findFirst({
    where: and(eq(schema.products.id, id), eq(schema.products.storeId, storeId)),
    with: {
      images: { orderBy: asc(schema.productImages.position), columns: { url: true, section: true } },
      offers: { orderBy: asc(schema.digitalOffers.position) },
      propertyOffers: { columns: { id: true }, limit: 1 },
    },
  });
  if (!product) throw data("Product not found", { status: 404 });
  return product;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireMerchant(request);
  const [product, quota, counts] = await Promise.all([
    params.id ? ownProduct(user.storeId, params.id) : null,
    getQuota(user.storeId),
    subscriberCounts(user.storeId),
  ]);
  const requested = new URL(request.url).searchParams.get("kind");
  const kind: ProductKind = product?.kind ?? (requested === "service" || requested === "digital" || requested === "property" ? requested : "product");
  // Large media uploads go straight to Blob when it's the active storage.
  const { backend } = await getStorageSettings();
  const directUploads = resolveBackend(backend) === "blob";
  // Never send the private file's storage key to the browser.
  const safeProduct = product ? { ...product, mediaKey: undefined, hasMedia: !!product.mediaKey } : null;
  const [photoLimit, plan, store] = await Promise.all([
    maxPhotos(),
    storePlan(user.storeId),
    db.query.stores.findFirst({ where: eq(schema.stores.id, user.storeId), columns: { physicalAddress: true } }),
  ]);
  return {
    product: safeProduct,
    kind,
    currency: user.storeCurrency,
    quota,
    counts,
    directUploads,
    photoLimit,
    plan: { name: plan.band?.name ?? "", used: plan.used, limit: plan.limit },
    storeAddress: store?.physicalAddress ?? null,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireMerchant(request);
  const existing = params.id ? await ownProduct(user.storeId, params.id) : null;
  const form = await request.formData();
  if (!existing) {
    try {
      await assertCanAddListing(user.storeId);
    } catch (e) {
      if (e instanceof BandError) return { error: e.message };
      throw e;
    }
  }
  const photoLimit = await maxPhotos();

  const kindValue = str(form.get("kind"));
  const kind: ProductKind = kindValue === "service" || kindValue === "digital" || kindValue === "property" ? kindValue : "product";
  const title = str(form.get("title"));
  const price = parseMoney(form.get("price"));
  const compareAt = str(form.get("compareAt")) ? parseMoney(form.get("compareAt")) : null;
  // "always" = continuous supply: always in stock, no count kept. Services have no stock.
  const trackStock = kind === "product" && form.get("stockMode") !== "always";
  const quantity = trackStock ? Math.floor(Number(form.get("quantity"))) : (existing?.quantity ?? 0);
  const dailyCapacity = kind === "service" ? Math.floor(Number(form.get("dailyCapacity"))) : null;
  if (kind === "service" && (!Number.isInteger(dailyCapacity) || dailyCapacity! < 1 || dailyCapacity! > 100)) {
    return { error: "Bookings per day must be between 1 and 100." };
  }
  let digital: { mediaType: MediaType; offers: ReturnType<typeof offersFromForm> } | null = null;
  if (kind === "digital") {
    const mediaType = str(form.get("mediaType")) as MediaType;
    if (!mediaTypeEnum.enumValues.includes(mediaType)) return { error: "Choose the kind of file you're selling." };
    try {
      digital = { mediaType, offers: offersFromForm(form) };
    } catch (e) {
      if (e instanceof DigitalError) return { error: e.message };
      throw e;
    }
    const newFile = form.get("mediaFile");
    const hasNew = !!str(form.get("mediaKey")) || (newFile instanceof File && newFile.size > 0);
    if (!existing?.mediaKey && !hasNew) return { error: "Upload the full file customers will get." };
  }
  let property: {
    listingType: ListingType;
    priceType: PriceType;
    reservePriceCents: number | null;
    biddingEndsAt: Date | null;
    titleDeed: boolean | null;
    propertyFeatures: PropertyFeatures;
  } | null = null;
  if (kind === "property") {
    if (existing?.soldAt) return { error: "This property has been sold, so it can't be changed." };
    const listingType = str(form.get("listingType")) as ListingType;
    if (!LISTING_TYPES.some((t) => t.value === listingType)) return { error: "Choose the type of property listing." };
    let priceType = str(form.get("priceType")) as PriceType;
    if (!PRICE_TYPES.some((t) => t.value === priceType)) return { error: "Choose how the price works." };
    if (listingType === "rental" && priceType === "reserve") priceType = "negotiable";
    if (str(form.get("description")).length < 30) return { error: "Describe the property in at least 30 characters." };
    const propertyFeatures = featuresFromForm(form, listingType);
    if (!propertyFeatures.location) return { error: "Enter where the property is." };
    if (listingType === "land" && !propertyFeatures.plotSize) return { error: "Enter the plot size." };
    let titleDeed: boolean | null = null;
    if (needsTitleDeed(listingType)) {
      const v = str(form.get("titleDeed"));
      if (v !== "yes" && v !== "no") return { error: "Say whether a title deed is available." };
      titleDeed = v === "yes";
    }
    let reservePriceCents: number | null = null;
    let biddingEndsAt: Date | null = null;
    if (priceType === "reserve") {
      reservePriceCents = parseMoney(form.get("reservePrice"));
      if (!reservePriceCents || (price && reservePriceCents < price)) return { error: "The reserve price can't be lower than the opening bid." };
      biddingEndsAt = new Date(str(form.get("biddingEndsAt")));
      if (Number.isNaN(biddingEndsAt.getTime())) return { error: "Choose when bidding ends." };
      const hasBids = !!existing?.propertyOffers.length;
      if (hasBids && existing?.biddingEndsAt && biddingEndsAt < existing.biddingEndsAt) return { error: "People have already bid, so you can only extend the closing date." };
      if (biddingEndsAt.getTime() < Date.now() + 3_600_000 && biddingEndsAt.getTime() !== existing?.biddingEndsAt?.getTime()) {
        return { error: "Bidding must end at least an hour from now." };
      }
    }
    property = { listingType, priceType, reservePriceCents, biddingEndsAt, titleDeed, propertyFeatures };
  }
  let autoDetails: AutoDetails | null = null;
  const categoryId = /^[0-9a-f-]{36}$/i.test(str(form.get("categoryId"))) ? str(form.get("categoryId")) : null;
  if (kind === "product" && categoryId) {
    const cat = await db.query.categories.findFirst({ where: eq(schema.categories.id, categoryId), columns: { slug: true } });
    if (cat?.slug === AUTO_CATEGORY_SLUG) {
      const parsed = autoFromForm(form);
      if (typeof parsed === "string") return { error: parsed };
      autoDetails = parsed;
    }
  }
  // Gallery/portfolio photos were uploaded one by one; accept only URLs of files we stored.
  const gallery: { url: string; section: string | null }[] = [];
  const sections: [string, string | null][] =
    property && property.listingType !== "land" ? [["galleryExterior", "exterior"], ["galleryInterior", "interior"]] : [["gallery", null]];
  for (const [field, section] of sections) {
    for (const url of form.getAll(field).map(String).slice(0, photoLimit)) {
      if (await isOwnUpload(url)) gallery.push({ url, section });
    }
  }
  const alertType = str(form.get("alertType")) as AlertType | "";
  if (title.length < 3) return { error: "Title must be at least 3 characters." };
  if (kind !== "digital" && (price === null || price <= 0)) return { error: "Enter a valid price." };
  if (!Number.isFinite(quantity) || quantity < 0) return { error: "Quantity can't be negative." };
  if (alertType && !alertTypeEnum.enumValues.includes(alertType)) return { error: "Unknown alert type." };

  let imageUrl: string | null;
  try {
    imageUrl = await uploadImage(form.get("image"), "products");
  } catch (e) {
    if (e instanceof UploadError) return { error: e.message };
    throw e;
  }

  const values = {
    title: title.slice(0, 160),
    description: str(form.get("description")).slice(0, 5000),
    categoryId: /^[0-9a-f-]{36}$/i.test(str(form.get("categoryId"))) ? str(form.get("categoryId")) : null,
    // Digital products are priced by their options; the listing shows the lowest.
    priceCents: digital ? Math.min(...digital.offers.map((o) => o.priceCents)) : price!,
    compareAtCents: !digital && !property && compareAt && compareAt > price! ? compareAt : null,
    quantity: property ? 1 : quantity,
    trackStock: property ? false : trackStock,
    kind,
    archiveWhenSoldOut: kind === "product" && trackStock && form.get("archiveWhenSoldOut") === "on",
    // Restocked: a sold-out listing that was archived goes back on sale.
    ...(kind === "product" && quantity > 0 && existing?.archivedAt ? { archivedAt: null } : {}),
    listingType: property?.listingType ?? null,
    priceType: property?.priceType ?? null,
    reservePriceCents: property?.reservePriceCents ?? null,
    biddingEndsAt: property?.biddingEndsAt ?? null,
    // A new closing date means a new "bidding closed" notice.
    ...(property && property.biddingEndsAt?.getTime() !== existing?.biddingEndsAt?.getTime() ? { biddingNoticeAt: null } : {}),
    titleDeed: property?.titleDeed ?? null,
    propertyFeatures: property?.propertyFeatures ?? null,
    autoDetails,
    dailyCapacity,
    references: kind === "service" ? str(form.get("references")).slice(0, 3000) || null : null,
    // Physical products: empty means "at the store's address"
    locations: kind === "product" ? parseLocations(form.getAll("locations")) : [],
    // Physical items only; vehicles and spare parts give theirs in the Auto details
    condition: kind === "product" && !autoDetails && isItemCondition(str(form.get("condition"))) ? (str(form.get("condition")) as typeof schema.products.$inferInsert.condition) : null,
    isActive: form.get("isActive") === "on",
    // A new image replaces the old one and clears any moderation hide
    ...(imageUrl ? { imageUrl, imageHidden: false } : {}),
  };

  let productId = existing?.id;
  if (existing) {
    await db.update(schema.products).set(values).where(eq(schema.products.id, existing.id));
  } else {
    const [created] = await db.insert(schema.products).values({ ...values, storeId: user.storeId }).returning({ id: schema.products.id });
    productId = created.id;
  }
  if (digital) {
    try {
      await saveDigital(productId!, {
        ...digital,
        mediaFile: form.get("mediaFile"),
        mediaKey: str(form.get("mediaKey")) || null,
        previewFile: form.get("previewFile"),
        previewUrl: str(form.get("previewUrl")) || null,
      });
    } catch (e) {
      if (!(e instanceof DigitalError)) throw e;
      return redirectWithFlash(request, `/sell/products/${productId}`, { tone: "warning", text: `Saved, but: ${e.message}` });
    }
  }
  await db.transaction(async (tx) => {
    await tx.delete(schema.productImages).where(eq(schema.productImages.productId, productId!));
    if (gallery.length) {
      await tx.insert(schema.productImages).values(gallery.map((g, position) => ({ productId: productId!, url: g.url, section: g.section, position })));
    }
  });

  const saved = existing ? "Changes saved." : `${kind === "service" ? "Service" : kind === "digital" ? "Digital product" : kind === "property" ? "Property" : "Product"} published.`;
  if (!alertType) return redirectWithFlash(request, "/sell/products", { tone: "success", text: saved });
  try {
    const alert = await sendAlert({
      storeId: user.storeId,
      productIds: [productId!],
      type: alertType,
      message: str(form.get("alertMessage")),
      userId: user.id,
    });
    return redirectWithFlash(request, "/sell/products", {
      tone: "success",
      text: `${saved} ${capitalize(ALERT_NAME[alertType])} alert sent to ${alert.recipientCount} subscriber${alert.recipientCount === 1 ? "" : "s"}.`,
    });
  } catch (e) {
    if (!(e instanceof AlertError)) throw e;
    return redirectWithFlash(request, "/sell/products", { tone: "warning", text: `${saved} The alert wasn't sent: ${e.message}` });
  }
}

export default function ProductForm({ loaderData, actionData }: Route.ComponentProps) {
  const { product, currency, quota, counts } = loaderData;
  const [kind, setKind] = useState<ProductKind>(loaderData.kind);
  const [alwaysInStock, setAlwaysInStock] = useState(product ? !product.trackStock : false);
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? "");
  const categories = (useRouteLoaderData<typeof rootLoader>("root")?.categories ?? []).filter((c) => c.kind === kind);
  const isService = kind === "service";
  const isProperty = kind === "property";
  const busy = useNavigation().state !== "idle";
  const cents = (c: number | null | undefined) => (c != null ? (c / 100).toFixed(2) : "");

  return (
    <>
      <PageHeader title={product ? `Edit ${isService ? "service" : isProperty ? "property" : "product"}` : "New listing"} />
      {!product && loaderData.plan.limit != null ? (
        <p className={cn("mb-4 rounded-xl px-3 py-2 text-sm", loaderData.plan.used >= loaderData.plan.limit ? "bg-destructive/10 text-destructive" : "bg-muted")}>
          {loaderData.plan.name} plan: {loaderData.plan.used} of {loaderData.plan.limit} listings used.{" "}
          <Link to="/sell/plan" className="font-semibold underline">
            {loaderData.plan.used >= loaderData.plan.limit ? "Upgrade to add more" : "See plans"}
          </Link>
        </p>
      ) : null}
      <Card>
        <CardContent className="pt-5">
          <Form method="post" encType="multipart/form-data" className="grid gap-5 md:grid-cols-[16rem_1fr]">
            <div className="grid content-start gap-2">
              <p className="text-sm font-semibold">{isProperty ? "Cover photo" : "Main photo"}</p>
              <ImageDropzone
                defaultPreview={product?.imageUrl ?? null}
                className="aspect-square"
                hint="Drag & drop or click"
              />
              {product?.imageHidden ? (
                <p className="text-xs text-destructive">
                  This image was hidden after reports. Upload a new one to replace it.
                </p>
              ) : null}
            </div>

            <div className="grid content-start gap-4">
              <FormError error={actionData?.error} />
              <fieldset className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <legend className="mb-1.5 text-sm font-semibold">What are you listing?</legend>
                {(
                  [
                    ["product", "A product", "Something customers order and you deliver"],
                    ["service", "A service", "Booked for a date: DJ, decor, cakes, photography..."],
                    ["digital", "A digital product", "Video, music or a document, to download or watch online"],
                    ["property", "Real Estate", "Land or a house for sale, or a house to rent"],
                  ] as const
                ).map(([value, label, text]) => (
                  <label
                    key={value}
                    className={cn(
                      "flex cursor-pointer gap-2 rounded-xl border-2 p-3 text-sm transition-colors",
                      kind === value ? "border-primary bg-primary/5" : "hover:border-primary/40",
                    )}
                  >
                    <input type="radio" name="kind" value={value} checked={kind === value} onChange={() => setKind(value)} className="mt-0.5 accent-primary" />
                    <span className="grid">
                      <span className="font-semibold">{label}</span>
                      <span className="text-xs text-muted-foreground">{text}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <Field label="Title">
                <Input name="title" required defaultValue={product?.title} maxLength={160} />
              </Field>
              {!isProperty ? (
                <Field label="Description">
                  <Textarea name="description" rows={5} defaultValue={product?.description} />
                </Field>
              ) : null}
              <Field label="Category">
                <NativeSelect key={kind} name="categoryId" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                  <option value="">Uncategorised</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              {kind === "product" && categories.find((c) => c.id === categoryId)?.slug === AUTO_CATEGORY_SLUG ? (
                <AutoFields d={product?.autoDetails ?? null} />
              ) : kind === "product" ? (
                <ConditionField initial={product?.condition ?? null} />
              ) : null}
              {isProperty ? (
                <PropertyFields
                  currency={currency}
                  max={loaderData.photoLimit}
                  d={{
                    listingType: product?.listingType ?? null,
                    priceType: product?.priceType ?? null,
                    priceCents: product?.priceCents ?? null,
                    reservePriceCents: product?.reservePriceCents ?? null,
                    biddingEndsAt: product?.biddingEndsAt ?? null,
                    titleDeed: product?.titleDeed ?? null,
                    propertyFeatures: product?.propertyFeatures ?? null,
                    description: product?.description ?? "",
                    images: product?.images ?? [],
                    hasOffers: !!product?.propertyOffers.length,
                  }}
                />
              ) : null}
              {kind !== "digital" && !isProperty ? (
              <div className="grid grid-cols-2 gap-3">
                  <Field label={`${isService ? "Starting price" : "Price"} (${currencySymbol(currency)})`}>
                    <Input name="price" required inputMode="decimal" defaultValue={cents(product?.priceCents)} />
                  </Field>
                  <Field label={`Was (${currencySymbol(currency)})`} hint="Shows a deal">
                    <Input name="compareAt" inputMode="decimal" defaultValue={cents(product?.compareAtCents)} />
                  </Field>
                </div>
              ) : null}
              {kind === "digital" ? (
                <DigitalFields
                  mediaType={product?.mediaType ?? "video"}
                  offers={product?.offers ?? []}
                  hasMedia={!!product?.hasMedia}
                  previewUrl={product?.previewUrl ?? null}
                  direct={loaderData.directUploads}
                  currency={currency}
                />
              ) : isService ? (
                <>
                  <Field
                    label="Bookings you can take per day"
                    hint="Once this many bookings are confirmed for a date, nobody else can book that day."
                    className="max-w-72"
                  >
                    <Input name="dailyCapacity" type="number" min={1} max={100} required defaultValue={product?.dailyCapacity ?? 1} />
                  </Field>
                  <Field label="References & past work" hint="Events you've done, clients who can vouch for you, awards. Shown on your listing.">
                    <Textarea
                      name="references"
                      rows={4}
                      maxLength={3000}
                      defaultValue={product?.references ?? ""}
                      placeholder="e.g. Banda-Phiri wedding, Lilongwe, May 2026 (300 guests). Capital Hotel year-end party 2025."
                    />
                  </Field>
                </>
              ) : isProperty ? null : (
              <fieldset className="grid gap-2">
                <legend className="mb-1.5 text-sm font-semibold">Stock</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(
                    [
                      [false, "I count my stock", "Shows how many are left and sells out at 0"],
                      [true, "Always in stock", "Continuous supply: no count, never sells out"],
                    ] as const
                  ).map(([always, label, text]) => (
                    <label
                      key={label}
                      className={cn(
                        "flex cursor-pointer gap-2 rounded-xl border-2 p-3 text-sm transition-colors",
                        alwaysInStock === always ? "border-primary bg-primary/5" : "hover:border-primary/40",
                      )}
                    >
                      <input
                        type="radio"
                        name="stockMode"
                        value={always ? "always" : "count"}
                        checked={alwaysInStock === always}
                        onChange={() => setAlwaysInStock(always)}
                        className="mt-0.5 accent-primary"
                      />
                      <span className="grid">
                        <span className="font-semibold">{label}</span>
                        <span className="text-xs text-muted-foreground">{text}</span>
                      </span>
                    </label>
                  ))}
                </div>
                {!alwaysInStock ? (
                  <>
                    <Field label="Quantity" className="max-w-40">
                      <Input name="quantity" type="number" min={0} required defaultValue={product?.quantity ?? 1} />
                    </Field>
                    <label className="flex items-start gap-2 text-sm">
                      <input type="checkbox" name="archiveWhenSoldOut" defaultChecked={product?.archiveWhenSoldOut ?? false} className="mt-0.5 size-4 accent-primary" />
                      <span>
                        <span className="font-medium">Archive when sold out</span>
                        <span className="block text-xs text-muted-foreground">
                          Hidden from shoppers once it reaches 0, then deleted for good after the period MyPlug sets. Restock before then to bring it back.
                        </span>
                      </span>
                    </label>
                  </>
                ) : null}
              </fieldset>
              )}
              {kind === "product" ? <LocationFields initial={product?.locations ?? []} storeAddress={loaderData.storeAddress} /> : null}
              {!isProperty ? (
                <Field label={isService ? "Portfolio: photos of your work" : "More photos"} hint={`Up to ${loaderData.photoLimit}. Drag & drop several at once.`}>
                  <GalleryField initial={product?.images.map((i) => i.url) ?? []} max={loaderData.photoLimit} />
                </Field>
              ) : null}
              <AlertFields quota={quota} counts={counts} />
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" name="isActive" defaultChecked={product?.isActive ?? true} className="size-4 accent-primary" />
                Visible to shoppers
              </label>
              <Button type="submit" size="lg" disabled={busy} className="justify-self-start">
                {busy ? "Saving..." : product ? "Save changes" : `Publish ${isProperty ? "property" : kind}`}
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>
    </>
  );
}

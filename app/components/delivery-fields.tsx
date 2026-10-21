import { AlertTriangleIcon, BikeIcon, KeyRoundIcon, MapPinIcon, StoreIcon, UserRoundIcon } from "lucide-react";
import { useState } from "react";
import type { HandoverType, StoreDeliveryMode } from "~/db/schema";
import { HANDOVER_LABEL, HANDOVER_TYPES, MAX_QUOTE_INVITES, SECOND_CHECK_LABEL } from "~/lib/delivery";
import { money } from "~/lib/format";
import { cn } from "~/lib/utils";
import { AddressFields } from "./address-fields";
import { ImageDropzone } from "./image-dropzone";
import { Field, Input, NativeSelect } from "./ui/input";

export type SavedAddress = { id: string; label: string; recipientName: string; phone: string; line1: string; area: string; city: string; landmark: string | null; isDefault: boolean };
export type CourierOption = { id: string; name: string; vehicle: string | null; rates: { area: string; estimateCents: number }[] };

/** A courier's estimate for an area (area match first, then city). */
function estimate(c: CourierOption, area: string, city: string) {
  const a = c.rates.find((r) => r.area.toLowerCase() === area.trim().toLowerCase());
  return (a ?? c.rates.find((r) => r.area.toLowerCase() === city.trim().toLowerCase()))?.estimateCents ?? null;
}

function Choice({ name, value, checked, onChange, icon: Icon, label, text }: {
  name: string; value: string; checked: boolean; onChange: () => void; icon: React.ComponentType<{ className?: string }>; label: string; text: string;
}) {
  return (
    <label className={cn("flex cursor-pointer gap-2 rounded-xl border-2 p-3 text-sm", checked ? "border-primary bg-primary/5" : "hover:border-primary/40")}>
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} className="mt-0.5 accent-primary" />
      <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
      <span className="grid">
        <span className="font-semibold">{label}</span>
        <span className="text-xs text-muted-foreground">{text}</span>
      </span>
    </label>
  );
}

/**
 * Delivery part of the order form: address, how it's handed over, who delivers (as the
 * store allows), pickup time, and how the person collecting is verified.
 */
export function DeliveryFields({
  addresses,
  mode,
  storeName,
  storeCourierName,
  couriers,
  usualCourierIds,
  currency,
  repeat = false,
}: {
  addresses: SavedAddress[];
  mode: StoreDeliveryMode;
  storeName: string;
  storeCourierName: string | null;
  couriers: CourierOption[];
  usualCourierIds: string[];
  currency: string;
  repeat?: boolean;
}) {
  const initial = addresses.find((a) => a.isDefault) ?? addresses[0];
  const [addressId, setAddressId] = useState<string>(initial?.id ?? "new");
  const [newArea, setNewArea] = useState({ area: "", city: "" });
  const [choice, setChoice] = useState<"collection" | "quotes" | "direct">("collection");
  const [handover, setHandover] = useState<HandoverType>("in_person");
  const [collector, setCollector] = useState<"me" | "someone">("me");
  const [hasPhoto, setHasPhoto] = useState(false);
  const [pickupWhen, setPickupWhen] = useState<"any" | "at">("any");
  const [verify, setVerify] = useState<"code" | "phrase">("code");
  const [picked, setPicked] = useState<string[]>([]);

  const chosen = addresses.find((a) => a.id === addressId);
  const area = chosen?.area ?? newArea.area;
  const city = chosen?.city ?? newArea.city;
  const sorted = [...couriers].sort((a, b) => (estimate(a, area, city) === null ? 1 : 0) - (estimate(b, area, city) === null ? 1 : 0));
  const usual = couriers.filter((c) => usualCourierIds.includes(c.id));
  const collecting = mode === "customer" && choice === "collection";
  const viaCourier = mode === "merchant_courier" || (mode === "customer" && choice !== "collection");

  return (
    <div className="grid gap-4">
      {/* Address */}
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-semibold">{collecting ? "Your details" : "Deliver to"}</legend>
        {addresses.map((a) => (
          <label key={a.id} className={cn("flex cursor-pointer gap-2 rounded-xl border-2 p-3 text-sm", addressId === a.id ? "border-primary bg-primary/5" : "hover:border-primary/40")}>
            <input type="radio" name="addressId" value={a.id} checked={addressId === a.id} onChange={() => setAddressId(a.id)} className="mt-0.5 accent-primary" />
            <MapPinIcon className="mt-0.5 size-4 shrink-0 text-primary" />
            <span className="grid">
              <span className="font-semibold">{a.label}</span>
              <span className="text-xs text-muted-foreground">{a.recipientName} · {a.phone} · {a.line1}, {a.area}, {a.city}</span>
            </span>
          </label>
        ))}
        <label className={cn("flex cursor-pointer items-center gap-2 rounded-xl border-2 p-3 text-sm", addressId === "new" ? "border-primary bg-primary/5" : "hover:border-primary/40")}>
          <input type="radio" name="addressId" value="new" checked={addressId === "new"} onChange={() => setAddressId("new")} className="accent-primary" />
          <span className="font-semibold">{addresses.length ? "A new address" : "Enter your address"}</span>
        </label>
        {addressId === "new" ? (
          <div
            className="grid gap-2 rounded-xl bg-muted/50 p-3"
            onChange={(e) => {
              const t = e.target as HTMLInputElement;
              if (t.name === "new_area" || t.name === "new_city") setNewArea((v) => ({ ...v, [t.name.slice(4)]: t.value }));
            }}
          >
            <AddressFields prefix="new_" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="saveAddress" defaultChecked className="size-4 accent-primary" /> Save to my addresses
            </label>
          </div>
        ) : null}
      </fieldset>

      {/* Who delivers */}
      {mode === "merchant" ? (
        <p className="flex gap-2 rounded-xl bg-secondary/60 p-3 text-sm"><StoreIcon className="size-4 shrink-0 text-primary" /> {storeName} delivers this order itself.</p>
      ) : mode === "merchant_courier" ? (
        <p className="flex gap-2 rounded-xl bg-secondary/60 p-3 text-sm">
          <BikeIcon className="size-4 shrink-0 text-primary" /> Delivered by {storeCourierName ?? "the store's courier"}. Delivery is paid by {storeName}.
        </p>
      ) : (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-semibold">Delivery ({storeName} doesn't deliver; you arrange it)</legend>
          <Choice name="deliveryChoice" value="collection" checked={choice === "collection"} onChange={() => setChoice("collection")} icon={UserRoundIcon} label="Collect it" text="You, or someone you send, pick it up from the store" />
          {!repeat ? (
            <Choice name="deliveryChoice" value="quotes" checked={choice === "quotes"} onChange={() => setChoice("quotes")} icon={BikeIcon} label="Get quotes from couriers" text={`Ask up to ${MAX_QUOTE_INVITES}; accept the price you like`} />
          ) : null}
          <Choice name="deliveryChoice" value="direct" checked={choice === "direct"} onChange={() => setChoice("direct")} icon={BikeIcon} label="Use my usual courier" text="Ask one courier directly, no bidding" />
        </fieldset>
      )}

      {mode === "customer" && choice === "quotes" ? (
        <div className="grid gap-1 rounded-xl border p-2">
          {sorted.length === 0 ? <p className="p-2 text-sm text-muted-foreground">No couriers available yet.</p> : null}
          {sorted.map((c) => {
            const est = estimate(c, area, city);
            const on = picked.includes(c.id);
            return (
              <label key={c.id} className={cn("flex cursor-pointer items-center gap-2 rounded-lg p-2 text-sm", on ? "bg-primary/10" : "hover:bg-muted", !on && picked.length >= MAX_QUOTE_INVITES && "opacity-50")}>
                <input
                  type="checkbox"
                  name="quoteCourier"
                  value={c.id}
                  checked={on}
                  onChange={() => setPicked((l) => (on ? l.filter((x) => x !== c.id) : l.length < MAX_QUOTE_INVITES ? [...l, c.id] : l))}
                  className="size-4 accent-primary"
                />
                <span className="flex-1">
                  <span className="font-semibold">{c.name}</span> <span className="text-xs text-muted-foreground">{c.vehicle}</span>
                </span>
                <span className="text-xs">{est !== null ? `about ${money(est, currency)}` : "price on request"}</span>
              </label>
            );
          })}
          <p className="px-2 text-xs text-muted-foreground">Couriers confirm their price after you order. Accepting one closes the bidding.</p>
        </div>
      ) : null}

      {mode === "customer" && choice === "direct" ? (
        <Field label="Courier" hint="They confirm the price and take the job, no bidding">
          <NativeSelect name="directCourier" required defaultValue={usual[0]?.id ?? ""}>
            <option value="" disabled>Choose a courier</option>
            {usual.length ? (
              <optgroup label="Couriers you've used">
                {usual.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </optgroup>
            ) : null}
            <optgroup label="All couriers">
              {couriers.filter((c) => !usualCourierIds.includes(c.id)).map((c) => {
                const est = estimate(c, area, city);
                return <option key={c.id} value={c.id}>{c.name}{est !== null ? ` (about ${money(est, currency)})` : ""}</option>;
              })}
            </optgroup>
          </NativeSelect>
        </Field>
      ) : null}

      {/* Collection: who comes */}
      {collecting ? (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-semibold">Who's collecting?</legend>
          <div className="grid grid-cols-2 gap-2">
            <Choice name="collector" value="me" checked={collector === "me"} onChange={() => setCollector("me")} icon={UserRoundIcon} label="Me" text="I'll bring the pickup code" />
            <Choice name="collector" value="someone" checked={collector === "someone"} onChange={() => setCollector("someone")} icon={UserRoundIcon} label="Someone else" text="Not a registered courier" />
          </div>
          {collector === "someone" ? (
            <div className="grid gap-3 rounded-xl bg-muted/50 p-3 sm:grid-cols-[1fr_9rem]">
              <div className="grid gap-3">
                <Field label="Their full name"><Input name="collectorName" required /></Field>
                <Field label="Their phone number"><Input name="collectorPhone" type="tel" required /></Field>
                <Field label="Their ID number" hint="The store checks it at pickup"><Input name="collectorIdNumber" required /></Field>
              </div>
              <Field label="Their photo (recommended)">
                <div onChange={(e) => setHasPhoto(!!(e.target as HTMLInputElement).files?.length)}>
                  <ImageDropzone name="collectorPhoto" prompt="Add photo" hint="" className="aspect-square" />
                </div>
              </Field>
              {!hasPhoto ? (
                <p className="flex gap-2 rounded-lg bg-warning/20 p-2 text-xs sm:col-span-2">
                  <AlertTriangleIcon className="size-4 shrink-0" /> Without a photo the store can only check the name, ID number and
                  code, so the risk of the wrong person collecting is higher.
                </p>
              ) : null}
            </div>
          ) : null}
        </fieldset>
      ) : null}

      {/* Destination handover */}
      {!collecting ? (
        <div className="grid gap-2">
          <Field label="On arrival">
            <NativeSelect name="handover" value={handover} onChange={(e) => setHandover(e.target.value as HandoverType)}>
              {HANDOVER_TYPES.map((h) => <option key={h} value={h}>{HANDOVER_LABEL[h]}</option>)}
            </NativeSelect>
          </Field>
          {handover === "delegate" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Delegate's name"><Input name="delegateName" required /></Field>
              <Field label="Delegate's phone"><Input name="delegatePhone" type="tel" required /></Field>
            </div>
          ) : null}
        </div>
      ) : (
        <input type="hidden" name="handover" value="in_person" />
      )}

      {/* Pickup time and verification: whenever someone other than the store's own staff collects */}
      {(viaCourier || collecting) && !repeat ? (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Pickup time">
              <NativeSelect name="pickupWhen" value={pickupWhen} onChange={(e) => setPickupWhen(e.target.value as "any" | "at")}>
                <option value="any">Any time</option>
                <option value="at">At a set time</option>
              </NativeSelect>
            </Field>
            {pickupWhen === "at" ? (
              <Field label="When" hint="The store may adjust it">
                <Input name="pickupAt" type="datetime-local" required />
              </Field>
            ) : null}
          </div>
          <fieldset className="grid gap-2 rounded-xl border p-3">
            <legend className="flex items-center gap-1.5 px-1 text-sm font-semibold"><KeyRoundIcon className="size-4 text-primary" /> Pickup security</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <Choice name="verifyMethod" value="code" checked={verify === "code"} onChange={() => setVerify("code")} icon={KeyRoundIcon} label="Pickup code" text="We create a code; whoever collects quotes it" />
              <Choice name="verifyMethod" value="phrase" checked={verify === "phrase"} onChange={() => setVerify("phrase")} icon={KeyRoundIcon} label="My secret phrase" text="You tell it only to the person collecting" />
            </div>
            {verify === "phrase" ? (
              <Field label="Secret phrase" hint="Not shown to the store or courier; the store checks what they're told">
                <Input name="phrase" required minLength={4} maxLength={80} autoComplete="off" />
              </Field>
            ) : null}
            <Field label="Extra check before release">
              <NativeSelect name="secondCheck" defaultValue="none">
                {(["none", "phone", "app"] as const).map((v) => <option key={v} value={v}>{SECOND_CHECK_LABEL[v]}</option>)}
              </NativeSelect>
            </Field>
          </fieldset>
        </>
      ) : null}
    </div>
  );
}

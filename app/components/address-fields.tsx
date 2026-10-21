import { Field, Input } from "./ui/input";

type Address = {
  label?: string;
  recipientName?: string;
  phone?: string;
  line1?: string;
  area?: string;
  city?: string;
  landmark?: string | null;
};

/** The fields of a delivery address. `prefix` keeps names unique when it sits inside a bigger form. */
export function AddressFields({ prefix = "", value = {}, required = true }: { prefix?: string; value?: Address; required?: boolean }) {
  const n = (k: string) => prefix + k;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Label">
        <Input name={n("label")} defaultValue={value.label ?? "Home"} placeholder="Home, Office..." maxLength={40} />
      </Field>
      <Field label="Recipient name">
        <Input name={n("recipientName")} defaultValue={value.recipientName} required={required} autoComplete="name" />
      </Field>
      <Field label="Recipient phone">
        <Input name={n("phone")} type="tel" defaultValue={value.phone} required={required} autoComplete="tel" placeholder="+265 99 123 4567" />
      </Field>
      <Field label="Street, plot or building">
        <Input name={n("line1")} defaultValue={value.line1} required={required} autoComplete="address-line1" />
      </Field>
      <Field label="Area" hint="Used to find couriers who deliver there">
        <Input name={n("area")} defaultValue={value.area} required={required} placeholder="e.g. Area 47" />
      </Field>
      <Field label="Town / city">
        <Input name={n("city")} defaultValue={value.city} required={required} autoComplete="address-level2" placeholder="Lilongwe" />
      </Field>
      <Field label="Landmark (optional)" className="sm:col-span-2">
        <Input name={n("landmark")} defaultValue={value.landmark ?? ""} placeholder="e.g. Blue gate opposite the clinic" />
      </Field>
    </div>
  );
}

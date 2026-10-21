import { Form, useNavigation } from "react-router";
import { ImageDropzone, PROOF_TYPES } from "./image-dropzone";
import { Button } from "./ui/button";
import { Field, Input } from "./ui/input";

/**
 * Customer tells the merchant they've paid (no payment gateway needed):
 * a transaction reference and/or a proof-of-payment file. The merchant then confirms it.
 */
export function PaymentReportForm({
  intent,
  hidden,
  withAmount,
  amountLabel = "Amount paid",
  submitLabel = "I've paid: notify the merchant",
}: {
  intent: string;
  hidden?: Record<string, string>;
  withAmount?: boolean;
  amountLabel?: string;
  submitLabel?: string;
}) {
  const busy = useNavigation().formData?.get("intent") === intent;
  return (
    <Form method="post" encType="multipart/form-data" className="grid gap-3 rounded-xl bg-secondary/50 p-3">
      <input type="hidden" name="intent" value={intent} />
      {Object.entries(hidden ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <div className="grid gap-3 sm:grid-cols-2">
        {withAmount ? (
          <Field label={amountLabel}>
            <Input name="amount" inputMode="decimal" required placeholder="e.g. 50,000" />
          </Field>
        ) : null}
        <Field label="Payment reference" hint="Bank or mobile money transaction ID">
          <Input name="reference" maxLength={120} placeholder="e.g. TXN 8F2K19" />
        </Field>
      </div>
      <Field label="Proof of payment (optional)">
        <ImageDropzone
          name="proof"
          types={PROOF_TYPES}
          prompt="Add proof"
          hint="Drop or click · PDF or image"
          className="min-h-24"
          imgClassName="max-h-40 w-full object-contain"
        />
      </Field>
      <Button type="submit" size="sm" disabled={busy} className="justify-self-start">
        {busy ? "Sending..." : submitLabel}
      </Button>
    </Form>
  );
}

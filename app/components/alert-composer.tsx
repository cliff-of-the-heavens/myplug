import { BellRingIcon, ShieldCheckIcon } from "lucide-react";
import type { AlertType } from "~/db/schema";
import { ALERT_MESSAGE_MAX, ALERT_TYPES } from "~/lib/alerts";
import { Field, NativeSelect, Textarea } from "./ui/input";

export type AlertQuota = { enabled: boolean; blocked: boolean; used: number; limit: number; remaining: number };
export type SubscriberCounts = Record<AlertType | "total", number>;

/** Why the merchant can't send any alert at the moment, if so. */
export function quotaProblem(quota: AlertQuota) {
  if (!quota.enabled) return "Email alerts are switched off by MyPlug at the moment.";
  if (quota.blocked) return "MyPlug has paused email alerts for your store. Contact support.";
  if (quota.remaining <= 0) return `You've used all ${quota.limit} alerts for this week.`;
  return null;
}

/**
 * Fields for sending an alert (alertType, alertMessage) inside a form.
 * The server re-checks everything; this only explains the limits up front.
 */
export function AlertFields({
  quota,
  counts,
  optional = true,
  defaultType = "",
}: {
  quota: AlertQuota;
  counts: SubscriberCounts;
  optional?: boolean;
  defaultType?: AlertType | "";
}) {
  const problem = quotaProblem(quota);
  return (
    <fieldset className="grid gap-3 rounded-xl border-2 border-dashed p-4">
      <legend className="flex items-center gap-1.5 px-1 text-sm font-bold">
        <BellRingIcon className="size-4 text-primary" /> Email your subscribers
      </legend>
      <p className="text-xs text-muted-foreground">
        {counts.total} subscriber{counts.total === 1 ? "" : "s"} · {quota.remaining} of {quota.limit} alerts left this week
      </p>
      {problem ? (
        <p className="text-sm font-medium text-destructive">{problem}</p>
      ) : (
        <>
          <Field label="Alert">
            <NativeSelect name="alertType" defaultValue={defaultType} required={!optional}>
              {optional ? <option value="">Don't send an alert</option> : <option value="" disabled>Choose an alert</option>}
              {ALERT_TYPES.map((t) => (
                <option key={t.type} value={t.type} disabled={!counts[t.type]}>
                  {t.label} ({counts[t.type]} subscriber{counts[t.type] === 1 ? "" : "s"})
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Short note (optional)" hint={`Plain text, up to ${ALERT_MESSAGE_MAX} characters. Links are removed.`}>
            <Textarea name="alertMessage" rows={2} maxLength={ALERT_MESSAGE_MAX} className="min-h-0" placeholder="e.g. Fresh batch just arrived, limited sizes!" />
          </Field>
        </>
      )}
      <p className="flex gap-1.5 text-xs text-muted-foreground">
        <ShieldCheckIcon className="size-4 shrink-0 text-success" />
        MyPlug sends the email for you. Subscribers' email addresses are never shared with stores, and they can unsubscribe
        at any time.
      </p>
    </fieldset>
  );
}

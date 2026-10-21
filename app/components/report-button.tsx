import { FlagIcon } from "lucide-react";
import { useFetcher } from "react-router";
import type { ReportTarget } from "~/db/schema";
import { useOptionalUser } from "~/lib/hooks";
import { AuthLink } from "./auth-dialog";
import { REPORT_REASONS } from "~/lib/moderation";
import { cn } from "~/lib/utils";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Textarea } from "./ui/input";

export function ReportButton({
  targetType,
  targetId,
  label = "Report",
  className,
}: {
  targetType: ReportTarget;
  targetId: string;
  label?: string;
  className?: string;
}) {
  const user = useOptionalUser();
  const cls = cn(
    "inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive",
    className,
  );

  if (!user) {
    return (
      <AuthLink mode="login" className={cls}>
        <FlagIcon className="size-3.5" /> {label}
      </AuthLink>
    );
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" className={cls}>
          <FlagIcon className="size-3.5" /> {label}
        </button>
      </DialogTrigger>
      <DialogContent>
        {/* Remounts on every open, so each report starts with a fresh form */}
        <ReportForm targetType={targetType} targetId={targetId} />
      </DialogContent>
    </Dialog>
  );
}

function ReportForm({ targetType, targetId }: { targetType: ReportTarget; targetId: string }) {
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();

  if (fetcher.data?.ok) {
    return (
      <DialogHeader>
        <DialogTitle>Thanks for letting us know</DialogTitle>
        <DialogDescription>
          Our moderators will review this. Images reported as nudity, or reported by several people, are hidden
          right away while we check them.
        </DialogDescription>
      </DialogHeader>
    );
  }

  return (
    <fetcher.Form method="post" action="/api/report" className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Report this content</DialogTitle>
        <DialogDescription>Tell us what is wrong. The owner won't see who reported it.</DialogDescription>
      </DialogHeader>
      <input type="hidden" name="targetType" value={targetType} />
      <input type="hidden" name="targetId" value={targetId} />
      <div className="grid gap-2">
        {REPORT_REASONS.map((r) => (
          <label
            key={r.value}
            className="flex cursor-pointer items-center gap-3 rounded-lg border-2 px-3 py-2 text-sm has-checked:border-primary has-checked:bg-primary/5"
          >
            <input type="radio" name="reason" value={r.value} required className="accent-primary" />
            {r.label}
          </label>
        ))}
      </div>
      <Textarea name="details" placeholder="Anything else we should know? (optional)" maxLength={1000} />
      {fetcher.data?.error ? <p className="text-sm text-destructive">{fetcher.data.error}</p> : null}
      <Button type="submit" variant="destructive" disabled={fetcher.state !== "idle"}>
        {fetcher.state !== "idle" ? "Sending..." : "Submit report"}
      </Button>
    </fetcher.Form>
  );
}

import { BellIcon, BellRingIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useFetcher } from "react-router";
import { ALERT_TYPES } from "~/lib/alerts";
import { useOptionalUser } from "~/lib/hooks";
import { cn } from "~/lib/utils";
import type { action as subscribeAction } from "~/routes/api.subscribe";
import { AuthLink } from "./auth-dialog";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";

export type FollowState = {
  subscription: { newProducts: boolean; restocks: boolean; discounts: boolean } | null;
  emailAlerts: boolean;
} | null;

/** "Get alerts" button: customers choose which email alerts they want from a store. */
export function FollowStoreButton({
  storeId,
  storeName,
  follow,
  className,
}: {
  storeId: string;
  storeName: string;
  follow: FollowState;
  className?: string;
}) {
  const user = useOptionalUser();
  const fetcher = useFetcher<typeof subscribeAction>();
  const [open, setOpen] = useState(false);
  const subscribed = !!follow?.subscription;

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && "ok" in fetcher.data) setOpen(false);
  }, [fetcher.state, fetcher.data]);

  if (!user) {
    return (
      <Button asChild variant="outline" className={className}>
        <AuthLink mode="login">
          <BellIcon /> Get alerts
        </AuthLink>
      </Button>
    );
  }
  if (user.role !== "customer" || !follow) return null;

  const current = follow.subscription ?? { newProducts: true, restocks: true, discounts: true };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={subscribed ? "secondary" : "outline"} className={className}>
          {subscribed ? <BellRingIcon /> : <BellIcon />} {subscribed ? "Alerts on" : "Get alerts"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Email alerts from {storeName}</DialogTitle>
          <DialogDescription>
            Choose what you'd like to hear about. MyPlug sends the emails, so {storeName} never sees your email address.
          </DialogDescription>
        </DialogHeader>
        <fetcher.Form method="post" action="/api/subscribe" className="grid gap-3">
          <input type="hidden" name="storeId" value={storeId} />
          {ALERT_TYPES.map((t) => (
            <label key={t.type} className="flex cursor-pointer items-start gap-3 rounded-xl border-2 p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
              <input type="checkbox" name={t.field} defaultChecked={current[t.field]} className="mt-0.5 size-4 accent-primary" />
              <span className="grid">
                <span className="font-semibold">{t.label}</span>
                <span className="text-xs text-muted-foreground">{t.text}</span>
              </span>
            </label>
          ))}
          {!follow.emailAlerts ? (
            <p className="rounded-lg bg-warning/20 px-3 py-2 text-xs">
              You've switched off all email alerts. Saving here switches them back on.
            </p>
          ) : null}
          <div className={cn("flex flex-wrap items-center gap-2")}>
            <Button type="submit" name="intent" value="save" disabled={fetcher.state !== "idle"}>
              Save
            </Button>
            {subscribed ? (
              <Button type="submit" name="intent" value="unfollow" variant="ghost" disabled={fetcher.state !== "idle"}>
                Stop all alerts from this store
              </Button>
            ) : null}
            <Link to="/account/alerts" className="ml-auto text-xs font-semibold text-primary hover:underline">
              Manage all alerts
            </Link>
          </div>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}

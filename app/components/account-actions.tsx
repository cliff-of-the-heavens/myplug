import { BanIcon, CheckIcon, RotateCcwIcon, XIcon } from "lucide-react";
import { useFetcher } from "react-router";
import type { StoreStatus } from "~/db/schema";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const STORE_STATUS_TONE: Record<StoreStatus, React.ComponentProps<typeof Badge>["variant"]> = {
  pending: "warning",
  approved: "success",
  rejected: "muted",
  suspended: "destructive",
  archived: "muted",
};

export function StoreStatusBadge({ status }: { status: StoreStatus }) {
  return (
    <Badge variant={STORE_STATUS_TONE[status]} className="capitalize">
      {status === "pending" ? "Awaiting approval" : status}
    </Badge>
  );
}

/**
 * Admin buttons for one account. Posts to the current route, whose action
 * should call handleAccountAction().
 */
export function AccountActions({
  userId,
  userStatus,
  storeStatus,
}: {
  userId: string;
  userStatus: "active" | "suspended";
  storeStatus?: StoreStatus | null;
}) {
  const fetcher = useFetcher<{ ok?: string; error?: string }>();
  const busy = fetcher.state !== "idle";
  const canReview = storeStatus === "pending" || storeStatus === "rejected";

  return (
    <fetcher.Form method="post" className="grid content-start gap-2 md:w-56">
      <input type="hidden" name="userId" value={userId} />
      <Input name="note" placeholder="Note to the user (reason)" className="h-8" maxLength={500} />
      {canReview ? (
        <Button type="submit" name="action" value="approve" size="sm" variant="accent" disabled={busy}>
          <CheckIcon /> Approve store
        </Button>
      ) : null}
      {storeStatus === "pending" ? (
        <Button type="submit" name="action" value="reject" size="sm" variant="outline" disabled={busy}>
          <XIcon /> Reject
        </Button>
      ) : null}
      {userStatus === "active" && !canReview ? (
        <Button type="submit" name="action" value="suspend" size="sm" variant="destructive" disabled={busy}>
          <BanIcon /> Suspend account
        </Button>
      ) : null}
      {userStatus === "suspended" ? (
        <Button type="submit" name="action" value="reactivate" size="sm" variant="secondary" disabled={busy}>
          <RotateCcwIcon /> Reactivate
        </Button>
      ) : null}
      {fetcher.data?.error ? <p className="text-xs font-medium text-destructive">{fetcher.data.error}</p> : null}
      {fetcher.data?.ok ? <p className="text-xs font-medium text-success">{fetcher.data.ok}</p> : null}
    </fetcher.Form>
  );
}

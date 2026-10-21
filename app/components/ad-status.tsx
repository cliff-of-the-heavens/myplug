import { AD_STATE_LABEL, type AdState } from "~/lib/promotions";
import { Badge } from "./ui/badge";

const TONE: Record<AdState, React.ComponentProps<typeof Badge>["variant"]> = {
  pending_quote: "secondary",
  awaiting_payment: "warning",
  payment_submitted: "accent",
  scheduled: "secondary",
  live: "success",
  ended: "muted",
  rejected: "destructive",
  cancelled: "muted",
};

export function AdStateBadge({ state }: { state: AdState }) {
  return <Badge variant={TONE[state]}>{AD_STATE_LABEL[state]}</Badge>;
}

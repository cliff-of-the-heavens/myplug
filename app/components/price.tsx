import { TimerIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "~/lib/utils";

/** Price after a live sale (percent off), with the "was" price when there's one. */
export function priceDisplay(p: { priceCents: number; compareAtCents: number | null; salePct?: number | null }) {
  const now = p.salePct ? Math.round((p.priceCents * (100 - p.salePct)) / 100) : p.priceCents;
  const was = p.salePct ? p.priceCents : p.compareAtCents && p.compareAtCents > p.priceCents ? p.compareAtCents : null;
  const pct = was ? Math.round((1 - now / was) * 100) : 0;
  return { now, was, pct };
}

/** "Ends in 2d 4h" countdown for timed deals; updates every minute. */
export function DealCountdown({ endsAt, className }: { endsAt: Date | string; className?: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  if (now === null) return null; // rendered on the client only, so server and browser agree
  const ms = new Date(endsAt).getTime() - now;
  if (ms <= 0) return null;
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-semibold text-destructive", className)}>
      <TimerIcon className="size-3.5" /> Ends in {d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`}
    </span>
  );
}


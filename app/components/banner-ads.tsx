import { ChevronLeftIcon, ChevronRightIcon, CrownIcon, StarIcon, TrendingUpIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { LiveBanner, TopShop } from "~/lib/banners.server";
import { cn } from "~/lib/utils";
import { SafeImage } from "./safe-image";
import { useAdViewTime } from "./tracker";

/** Small "Ad" label every paid banner carries, with a link to how ads work. */
function AdLabel({ className }: { className?: string }) {
  return (
    <Link
      to="/advertise"
      className={cn("absolute top-2 right-2 z-10 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white uppercase backdrop-blur hover:bg-black/75", className)}
      title="Paid advert: advertise on MyPlug"
    >
      Ad
    </Link>
  );
}

/** One banner image; clicks go through /ad/:id so they're counted. */
function BannerImage({ ad, className, eager = false }: { ad: LiveBanner; className?: string; eager?: boolean }) {
  const viewRef = useAdViewTime(ad.id);
  const img = (
    <img
      ref={viewRef as React.Ref<HTMLImageElement>}
      src={ad.creativeUrl}
      alt={ad.headline ?? "Advert"}
      width={ad.width ?? undefined}
      height={ad.height ?? undefined}
      loading={eager ? "eager" : "lazy"}
      className={cn("size-full object-cover", className)}
    />
  );
  return ad.hasLink ? (
    <a href={`/ad/${ad.id}`} rel="sponsored noopener" target="_blank" className="block size-full">
      {img}
    </a>
  ) : (
    img
  );
}

/**
 * A banner spot (home strip, search leaderboard, side banner). Renders nothing when no ad is
 * running, so pages never show empty boxes.
 */
export function BannerSlot({ ads, shape, className }: { ads: LiveBanner[] | undefined; shape: "strip" | "leaderboard" | "sidebar"; className?: string }) {
  const ad = ads?.[0];
  if (!ad) return null;
  const aspect = shape === "strip" ? "aspect-[16/3]" : shape === "leaderboard" ? "aspect-[6/1]" : "aspect-[1/2]";
  return (
    <aside aria-label="Advert" className={cn("relative overflow-hidden rounded-2xl border bg-muted", aspect, className)}>
      <AdLabel />
      <BannerImage ad={ad} />
    </aside>
  );
}

/**
 * The home hero: MyPlug's own slide plus any paid hero ads, rotating every 7 seconds (paused
 * on hover and for people who prefer reduced motion). Arrows and dots let people browse.
 */
export function HeroCarousel({ house, ads }: { house: React.ReactNode; ads: LiveBanner[] }) {
  const slides = ads.length;
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const total = slides + 1;
  useEffect(() => {
    if (!slides || paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setI((n) => (n + 1) % total), 7000);
    return () => clearInterval(t);
  }, [slides, paused, total]);
  if (!slides) return <>{house}</>;
  const go = (d: number) => setI((n) => (n + d + total) % total);
  return (
    <div className="relative h-full" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      <div className={cn("h-full", i !== 0 && "hidden")}>{house}</div>
      {ads.map((ad, n) => (
        <div key={ad.id} className={cn("relative h-full min-h-56 overflow-hidden rounded-3xl bg-muted md:min-h-80", i !== n + 1 && "hidden")}>
          <AdLabel className="top-3 right-3" />
          <BannerImage ad={ad} eager={n === 0} />
        </div>
      ))}
      <div className="absolute inset-x-0 bottom-3 z-10 flex items-center justify-center gap-2">
        <button type="button" onClick={() => go(-1)} aria-label="Previous slide" className="rounded-full bg-black/30 p-1 text-white backdrop-blur hover:bg-black/50">
          <ChevronLeftIcon className="size-4" />
        </button>
        {Array.from({ length: total }, (_, n) => (
          <button
            key={n}
            type="button"
            onClick={() => setI(n)}
            aria-label={`Slide ${n + 1}`}
            aria-current={i === n}
            className={cn("h-2 rounded-full bg-white/60 transition-all", i === n ? "w-6 bg-white" : "w-2")}
          />
        ))}
        <button type="button" onClick={() => go(1)} aria-label="Next slide" className="rounded-full bg-black/30 p-1 text-white backdrop-blur hover:bg-black/50">
          <ChevronRightIcon className="size-4" />
        </button>
      </div>
    </div>
  );
}

/** "Top 5 shops this week" / "Top rated shops" beside the hero. */
export function TopShopsPanel({ shops, mode }: { shops: TopShop[]; mode: "top_selling" | "top_rated" }) {
  if (!shops.length) return null;
  const Icon = mode === "top_selling" ? TrendingUpIcon : StarIcon;
  return (
    <aside className="grid content-start gap-3 rounded-3xl border bg-card p-4">
      <h2 className="flex items-center gap-2 font-extrabold">
        <Icon className={cn("size-5", mode === "top_selling" ? "text-primary" : "fill-amber-400 text-amber-400")} />
        {mode === "top_selling" ? "Top 5 shops this week" : "Top rated shops"}
      </h2>
      <ol className="grid gap-1">
        {shops.map((s, n) => (
          <li key={s.id}>
            <Link to={`/s/${s.slug}`} className="flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-muted">
              <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-black", n === 0 ? "bg-highlight text-highlight-foreground" : "bg-muted text-muted-foreground")}>
                {n === 0 ? <CrownIcon className="size-3.5" /> : n + 1}
              </span>
              <SafeImage src={s.logoUrl} alt="" className="size-9 shrink-0 rounded-lg" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{s.name}</span>
                <span className="block text-xs text-muted-foreground">{s.stat}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </aside>
  );
}

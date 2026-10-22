import { BadgeCheckIcon, BellRingIcon, GiftIcon, PercentIcon, LayoutDashboardIcon, MegaphoneIcon, PackageIcon, RepeatIcon, SettingsIcon, ShoppingCartIcon, StarIcon } from "lucide-react";
import { NavLink, Outlet } from "react-router";
import { Container } from "~/components/page";
import { requireMerchant } from "~/lib/auth.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/sell.layout";

export async function loader({ request }: Route.LoaderArgs) {
  await requireMerchant(request);
  return null;
}

const NAV = [
  { to: "/sell", label: "Overview", icon: LayoutDashboardIcon, end: true },
  { to: "/sell/products", label: "Listings", icon: PackageIcon },
  { to: "/sell/orders", label: "Orders & bookings", icon: ShoppingCartIcon },
  { to: "/sell/plans", label: "Repeat orders", icon: RepeatIcon },
  { to: "/sell/deals", label: "Deals & promo codes", icon: PercentIcon },
  { to: "/sell/coupons", label: "Gift coupons", icon: GiftIcon },
  { to: "/sell/reviews", label: "Reviews", icon: StarIcon },
  { to: "/sell/promote", label: "Advertise", icon: MegaphoneIcon },
  { to: "/sell/alerts", label: "Alerts", icon: BellRingIcon },
  { to: "/sell/store", label: "Store", icon: SettingsIcon },
  { to: "/sell/business", label: "Business info", icon: BadgeCheckIcon },
];

export default function SellLayout() {
  return (
    <Container className="grid gap-6 py-6 md:grid-cols-[13rem_1fr] md:py-8">
      <nav className="scrollbar-none -mx-4 flex gap-1 overflow-x-auto px-4 md:sticky md:top-36 md:mx-0 md:flex-col md:self-start md:px-0">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) =>
              cn(
                "flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors md:rounded-xl",
                isActive ? "bg-primary text-primary-foreground shadow-sm shadow-primary/30" : "hover:bg-muted",
              )
            }
          >
            <n.icon className="size-4" /> {n.label}
          </NavLink>
        ))}
      </nav>
      <div className="min-w-0">
        <Outlet />
      </div>
    </Container>
  );
}

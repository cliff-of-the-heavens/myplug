import {
  BellRingIcon,
  BikeIcon,
  FlagIcon,
  HardDriveIcon,
  LayoutDashboardIcon,
  MegaphoneIcon,
  SettingsIcon,
  StoreIcon,
  UsersIcon,
} from "lucide-react";
import { NavLink, Outlet } from "react-router";
import { Container } from "~/components/page";
import { getAdminCounts } from "~/lib/admin.server";
import { requireAdmin } from "~/lib/auth.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/admin.layout";

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  return { counts: await getAdminCounts() };
}

export default function AdminLayout({ loaderData }: Route.ComponentProps) {
  const { counts } = loaderData;
  const nav = [
    { to: "/admin", label: "Overview", icon: LayoutDashboardIcon, end: true },
    { to: "/admin/merchants", label: "Merchants", icon: StoreIcon, badge: counts.pendingMerchants + counts.pendingLicenses },
    { to: "/admin/couriers", label: "Couriers", icon: BikeIcon, badge: counts.pendingCouriers },
    { to: "/admin/customers", label: "Customers", icon: UsersIcon },
    { to: "/admin/ads", label: "Adverts", icon: MegaphoneIcon, end: true, badge: counts.adsToQuote + counts.paymentsToVerify },
    { to: "/admin/ads/settings", label: "Bands & payment", icon: SettingsIcon },
    { to: "/admin/alerts", label: "Email alerts", icon: BellRingIcon },
    { to: "/admin/moderation", label: "Moderation", icon: FlagIcon, badge: counts.openReports },
    { to: "/admin/system", label: "System settings", icon: HardDriveIcon },
  ];

  return (
    <Container className="grid gap-6 py-6 md:grid-cols-[14rem_1fr] md:py-8">
      <nav className="scrollbar-none -mx-4 flex gap-1 overflow-x-auto px-4 md:sticky md:top-36 md:mx-0 md:flex-col md:self-start md:px-0">
        <p className="hidden px-4 pb-2 text-xs font-bold tracking-wider text-muted-foreground uppercase md:block">Admin portal</p>
        {nav.map((n) => (
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
            {n.badge ? (
              <span className="ml-auto min-w-5 rounded-full bg-highlight px-1.5 text-center text-xs font-bold text-highlight-foreground">
                {n.badge}
              </span>
            ) : null}
          </NavLink>
        ))}
      </nav>
      <div className="min-w-0">
        <Outlet />
      </div>
    </Container>
  );
}

import {
  BellIcon,
  EyeOffIcon,
  HandCoinsIcon,
  KeyRoundIcon,
  GiftIcon,
  HeartIcon,
  ShoppingCartIcon,
  BikeIcon,
  CarFrontIcon,
  HomeIcon,
  ImagePlusIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MessageCircleIcon,
  LibraryIcon,
  MapPinIcon,
  PackageIcon,
  RepeatIcon,
  SearchIcon,
  ShieldIcon,
  StoreIcon,
  UserIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Form, Link, NavLink, useLocation, useSearchParams, useSubmit } from "react-router";
import type { ProductKind } from "~/db/schema";
import type { SessionUser } from "~/lib/auth.server";
import { AUTO_CATEGORY_SLUG } from "~/lib/auto";
import { HANDYMAN_GROUP } from "~/lib/handyman";
import { iconUrl } from "~/lib/brand";
import { AuthLink } from "./auth-dialog";
import { cn } from "~/lib/utils";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

type Category = { id: string; name: string; slug: string; kind: ProductKind; group: string | null };

export function Logo({ className }: { className?: string }) {
  return (
    <Link to="/" className={cn("flex shrink-0 items-center gap-1.5", className)}>
      <img src={iconUrl("icon.svg")} alt="" width={36} height={36} className="size-9 rounded-xl shadow-md shadow-primary/30" />
      <span className="text-xl font-black tracking-tight">
        My<span className="text-primary">Plug</span>
      </span>
    </Link>
  );
}

function SearchBar({ categories, className }: { categories: Category[]; className?: string }) {
  const [params] = useSearchParams();
  return (
    <Form
      action="/search"
      role="search"
      className={cn(
        "flex h-11 w-full overflow-hidden rounded-full border-2 border-primary bg-card focus-within:ring-4 focus-within:ring-primary/20",
        className,
      )}
    >
      <select
        name="category"
        defaultValue={params.get("category") ?? ""}
        aria-label="Category"
        className="hidden max-w-36 border-r bg-muted px-3 text-sm outline-none md:block"
      >
        <option value="">All</option>
        {categories.map((c) => (
          <option key={c.id} value={c.slug}>
            {c.name}
          </option>
        ))}
      </select>
      <input
        type="search"
        name="q"
        defaultValue={params.get("q") ?? ""}
        placeholder="Search products, services and stores"
        className="min-w-0 flex-1 bg-transparent px-4 text-sm outline-none"
      />
      <button type="submit" aria-label="Search" className="bg-primary px-5 text-primary-foreground hover:bg-primary/90">
        <SearchIcon className="size-5" />
      </button>
    </Form>
  );
}

const ACCOUNT_TYPE: Record<SessionUser["role"], string> = {
  customer: "Customer account",
  merchant: "Merchant account",
  courier: "Courier account",
  admin: "Administrator",
};

function AccountMenu({ user }: { user: SessionUser }) {
  const submit = useSubmit();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="gap-2 px-2 md:px-3">
          <span className="flex size-8 items-center justify-center rounded-full bg-secondary font-bold text-secondary-foreground">
            {user.name.charAt(0).toUpperCase()}
          </span>
          <span className="hidden max-w-28 truncate lg:inline">{user.name.split(" ")[0]}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="grid gap-0.5">
          <span className="max-w-60 truncate text-sm font-semibold text-foreground">{user.email}</span>
          <span className="text-xs font-normal text-muted-foreground">{ACCOUNT_TYPE[user.role]}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {user.role === "courier" ? (
          <>
            <DropdownMenuItem asChild>
              <Link to="/courier">
                <BikeIcon /> Courier dashboard
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/courier/transport">
                <CarFrontIcon /> Transport jobs
              </Link>
            </DropdownMenuItem>
          </>
        ) : null}
        {user.role === "merchant" ? (
          <>
            <DropdownMenuItem asChild>
              <Link to="/sell">
                <LayoutDashboardIcon /> Seller dashboard
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to={`/s/${user.storeSlug}`}>
                <StoreIcon /> View my store
              </Link>
            </DropdownMenuItem>
          </>
        ) : null}
        {user.role === "customer" ? (
          <>
            <DropdownMenuItem asChild>
              <Link to="/account/orders">
                <PackageIcon /> My orders
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/account/favourites">
                <HeartIcon /> Favourites
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/account/coupons">
                <GiftIcon /> Gift coupons
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/account/transport">
                <CarFrontIcon /> My transport
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/account/offers">
                <HandCoinsIcon /> Property offers
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/account/ad-free">
                <EyeOffIcon /> Ad-free browsing
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/account/plans">
                <RepeatIcon /> Repeat orders
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/account/library">
                <LibraryIcon /> My library
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/account/addresses">
                <MapPinIcon /> Addresses
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/requests?mine=1">
                <ImagePlusIcon /> My requests
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/account/alerts">
                <BellIcon /> Email alerts
              </Link>
            </DropdownMenuItem>
          </>
        ) : null}
        {user.role === "admin" ? (
          <DropdownMenuItem asChild>
            <Link to="/admin">
              <ShieldIcon /> Admin portal
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem asChild>
          <Link to="/messages">
            <MessageCircleIcon /> Messages
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/account/password">
            <KeyRoundIcon /> Change password
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {/* Submitted from onSelect: a <form> inside the menu is removed as the menu closes, before it can submit. */}
        <DropdownMenuItem onSelect={() => submit(null, { method: "post", action: "/logout" })}>
          <LogOutIcon /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UnreadDot({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white">
      {count > 9 ? "9+" : count}
    </span>
  );
}

export function SiteHeader({
  user,
  categories,
  unread,
  notices,
  cart,
}: {
  user: SessionUser | null;
  categories: Category[];
  unread: number;
  notices: number;
  cart: number;
}) {
  const { ref, collapsed } = useCollapsingHeader();
  return (
    <header
      ref={ref}
      className={cn(
        "sticky top-0 z-40 border-b bg-background/90 backdrop-blur transition-transform duration-200 supports-[backdrop-filter]:bg-background/75",
        collapsed && "-translate-y-full",
      )}
    >
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 md:gap-6 md:px-6">
        <Logo />
        <SearchBar categories={categories} className="hidden md:flex" />
        <nav className="ml-auto flex items-center gap-1">
          <Button asChild variant="ghost" className="hidden lg:inline-flex">
            <Link to="/requests">
              <ImagePlusIcon /> Requests
            </Link>
          </Button>
          {user ? (
            <>
              {user.role === "customer" ? (
                <Button asChild variant="ghost" size="icon" className="relative">
                  <Link to="/cart" aria-label="Cart">
                    <ShoppingCartIcon className="size-5" />
                    <UnreadDot count={cart} />
                  </Link>
                </Button>
              ) : null}
              <Button asChild variant="ghost" size="icon" className="relative">
                <Link to="/notifications" aria-label="Notifications">
                  <BellIcon className="size-5" />
                  <UnreadDot count={notices} />
                </Link>
              </Button>
              <Button asChild variant="ghost" size="icon" className="relative hidden md:inline-flex">
                <Link to="/messages" aria-label="Messages">
                  <MessageCircleIcon className="size-5" />
                  <UnreadDot count={unread} />
                </Link>
              </Button>
              <AccountMenu user={user} />
            </>
          ) : (
            <>
              <Button asChild variant="ghost" className="hidden sm:inline-flex">
                <AuthLink mode="register" role="merchant">
                  <StoreIcon /> Sell on MyPlug
                </AuthLink>
              </Button>
              <Button asChild variant="ghost" className="hidden sm:inline-flex">
                <AuthLink mode="register">Create account</AuthLink>
              </Button>
              <Button asChild>
                <AuthLink mode="login">Sign in</AuthLink>
              </Button>
            </>
          )}
        </nav>
      </div>
      <div className="px-4 pb-3 md:hidden">
        <SearchBar categories={categories} />
      </div>
      <TopMenu categories={categories} />
    </header>
  );
}

/**
 * On pages with a <StickySubmenu>, scrolling down slides the header away so the submenu becomes
 * the top menu; scrolling up brings the header back. The header's visible height is published as
 * --header-h so the submenu always sits right under whatever is showing.
 */
function useCollapsingHeader() {
  const ref = useRef<HTMLElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();

  useEffect(() => setCollapsed(false), [location.pathname, location.search]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const hasSubmenu = !!document.querySelector("[data-sticky-submenu]");
      if (!hasSubmenu || y < el.offsetHeight) setCollapsed(false);
      else if (y > lastY + 4) setCollapsed(true);
      else if (y < lastY - 4) setCollapsed(false);
      if (Math.abs(y - lastY) > 4) lastY = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // data-header-collapsed lets the pinned submenu take on the main menu's colours (in-data-[header-collapsed]:).
    document.documentElement.toggleAttribute("data-header-collapsed", collapsed);
    const publish = () => document.documentElement.style.setProperty("--header-h", collapsed ? "0px" : `${el.offsetHeight}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => ro.disconnect();
  }, [collapsed]);

  return { ref, collapsed };
}

/**
 * A page's own menu (e.g. the category chips) that takes over the top of the screen while
 * scrolling down, in the main menu's gradient. Its chips should use SUBMENU_CHIP.
 */
export function StickySubmenu({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-sticky-submenu=""
      className={cn(
        "sticky top-[var(--header-h,0px)] z-30 border-b bg-background/95 backdrop-blur transition-[top] duration-200 supports-[backdrop-filter]:bg-background/80",
        "in-data-[header-collapsed]:brand-gradient in-data-[header-collapsed]:border-transparent",
        className,
      )}
      {...props}
    />
  );
}

/** Chip colours inside a StickySubmenu: outlined normally, white-on-gradient (like the main menu) once pinned. */
export const SUBMENU_CHIP = {
  active:
    "border-primary bg-primary text-primary-foreground in-data-[header-collapsed]:border-white in-data-[header-collapsed]:bg-white in-data-[header-collapsed]:text-primary in-data-[header-collapsed]:shadow-sm",
  idle: "hover:border-primary/40 in-data-[header-collapsed]:border-transparent in-data-[header-collapsed]:bg-white/15 in-data-[header-collapsed]:text-white in-data-[header-collapsed]:hover:bg-white/30",
};

export const TOP_MENU: { key: ProductKind | "auto" | "handyman" | "transport"; label: string; to: string }[] = [
  { key: "product", label: "All products", to: "/search?kind=product" },
  { key: "auto", label: "Auto", to: `/search?category=${AUTO_CATEGORY_SLUG}` },
  { key: "service", label: "Services", to: "/search?kind=service" },
  { key: "handyman", label: "Handymen", to: `/search?group=${HANDYMAN_GROUP}` },
  { key: "transport", label: "Transport", to: "/transport" },
  { key: "digital", label: "Downloads", to: "/search?kind=digital" },
  { key: "property", label: "Real Estate", to: "/search?kind=property" },
];

/**
 * The main menu: the four kinds of listing, plus Auto (a product category big enough for its own
 * tab, with vehicles and spare parts as its submenu) and Handymen (the trades, a group of service
 * categories, as its submenu). Other categories appear as a submenu on the
 * browse page, so they aren't repeated here. The active tab follows the page (a category belongs
 * to its kind); browsing with nothing chosen means "All products".
 */
function TopMenu({ categories }: { categories: Category[] }) {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const onBrowse = location.pathname === "/search";
  const category = params.get("category");
  const chosen = categories.find((c) => c.slug === category);
  const fromCategory = chosen?.group === HANDYMAN_GROUP ? "handyman" : chosen?.kind;
  const kind = params.get("kind") as ProductKind | null;
  // A typed search with no menu chosen looks everywhere, so no tab is highlighted.
  const active: (typeof TOP_MENU)[number]["key"] | null = location.pathname.startsWith("/transport")
    ? "transport"
    : !onBrowse
    ? null
    : category === AUTO_CATEGORY_SLUG
      ? "auto"
      : params.get("group") === HANDYMAN_GROUP
        ? "handyman"
        : (fromCategory ?? kind ?? (params.get("q") ? null : "product"));
  return (
    <nav className="brand-gradient" aria-label="Main menu">
      <div className="scrollbar-none mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 py-1.5 md:px-6">
        {TOP_MENU.map((m) => (
          <Link
            key={m.key}
            to={m.to}
            aria-current={active === m.key ? "page" : undefined}
            className={cn(
              "shrink-0 rounded-full px-4 py-1 text-sm font-bold whitespace-nowrap text-white transition-colors",
              active === m.key ? "bg-white text-primary shadow-sm" : "bg-white/15 hover:bg-white/30",
            )}
          >
            {m.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

/** App-style tab bar on phones (and when installed as a PWA). */
export function MobileTabBar({ user, unread }: { user: SessionUser | null; unread: number }) {
  const tabs = [
    { to: "/", label: "Home", icon: HomeIcon, end: true },
    { to: "/search", label: "Browse", icon: SearchIcon },
    { to: "/requests", label: "Requests", icon: ImagePlusIcon },
    { to: "/messages", label: "Chats", icon: MessageCircleIcon, badge: unread },
    user?.role === "merchant"
      ? { to: "/sell", label: "Sell", icon: StoreIcon }
      : user?.role === "courier"
        ? { to: "/courier", label: "Jobs", icon: BikeIcon }
      : user?.role === "admin"
        ? { to: "/admin", label: "Admin", icon: ShieldIcon }
        : // Guests are sent to the sign-in pop-up by the orders page itself.
          { to: "/account/orders", label: user ? "Orders" : "Account", icon: user ? PackageIcon : UserIcon },
  ];
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <ul className="grid grid-cols-5">
        {tabs.map((t) => (
          <li key={t.label}>
            <NavLink
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                cn(
                  "flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium",
                  isActive ? "text-primary" : "text-muted-foreground",
                )
              }
            >
              <span className="relative">
                <t.icon className="size-5" />
                <UnreadDot count={t.badge ?? 0} />
              </span>
              {t.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t bg-muted/40 pb-20 md:pb-0">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 text-sm md:grid-cols-4 md:px-6">
        <div className="grid gap-2">
          <Logo />
          <p className="text-muted-foreground">Your plug for everything — from local merchants you can actually talk to.</p>
        </div>
        <div className="grid content-start gap-2">
          <p className="font-bold">Shop</p>
          <Link to="/search" className="text-muted-foreground hover:text-primary">All products</Link>
          <Link to="/search?sort=newest" className="text-muted-foreground hover:text-primary">New arrivals</Link>
          <Link to="/requests" className="text-muted-foreground hover:text-primary">Request something special</Link>
          <Link to="/transport" className="text-muted-foreground hover:text-primary">Rides, moving & car hire</Link>
        </div>
        <div className="grid content-start gap-2">
          <p className="font-bold">Sell</p>
          <AuthLink mode="register" role="merchant" redirectTo="/sell" className="text-muted-foreground hover:text-primary">Open a store</AuthLink>
          <Link to="/advertise" className="text-muted-foreground hover:text-primary">Advertise on MyPlug</Link>
          <AuthLink mode="register" role="handyman" className="text-muted-foreground hover:text-primary">Join as a handyman</AuthLink>
          <AuthLink mode="register" role="courier" redirectTo="/courier/profile" className="text-muted-foreground hover:text-primary">Deliver with MyPlug</AuthLink>
        </div>
        <div className="grid content-start gap-2">
          <p className="font-bold">Trust & safety</p>
          <Link to="/terms" className="text-muted-foreground hover:text-primary">Terms of Use</Link>
          <Link to="/safety" className="text-muted-foreground hover:text-primary">Community guidelines</Link>
          <Link to="/safety#reporting" className="text-muted-foreground hover:text-primary">Report content</Link>
        </div>
      </div>
      <p className="border-t py-4 text-center text-xs text-muted-foreground">© {new Date().getFullYear()} MyPlug</p>
    </footer>
  );
}

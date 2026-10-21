import {
  BellIcon,
  BikeIcon,
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
import { Form, Link, NavLink, useSearchParams, useSubmit } from "react-router";
import type { SessionUser } from "~/lib/auth.server";
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

type Category = { id: string; name: string; slug: string; kind: "product" | "service" | "digital" };

export function Logo({ className }: { className?: string }) {
  return (
    <Link to="/" className={cn("flex shrink-0 items-center gap-1.5", className)}>
      <span className="brand-gradient flex size-9 items-center justify-center rounded-xl text-lg font-black text-white shadow-md shadow-primary/30">
        M
      </span>
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
          <DropdownMenuItem asChild>
            <Link to="/courier">
              <BikeIcon /> Courier dashboard
            </Link>
          </DropdownMenuItem>
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
}: {
  user: SessionUser | null;
  categories: Category[];
  unread: number;
  notices: number;
}) {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
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
      <nav className="brand-gradient">
        <div className="scrollbar-none mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 py-1.5 md:px-6">
          <Link
            to="/search?kind=service"
            className="shrink-0 rounded-full bg-white/20 px-3 py-1 text-sm font-bold whitespace-nowrap text-white hover:bg-white/30"
          >
            Services
          </Link>
          <Link
            to="/search?kind=digital"
            className="shrink-0 rounded-full bg-white/20 px-3 py-1 text-sm font-bold whitespace-nowrap text-white hover:bg-white/30"
          >
            Downloads
          </Link>
          {categories.filter((c) => c.kind === "product").map((c) => (
            <Link
              key={c.id}
              to={`/search?category=${c.slug}`}
              className="shrink-0 rounded-full px-3 py-1 text-sm font-medium whitespace-nowrap text-white/90 hover:bg-white/15 hover:text-white"
            >
              {c.name}
            </Link>
          ))}
        </div>
      </nav>
    </header>
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
        </div>
        <div className="grid content-start gap-2">
          <p className="font-bold">Sell</p>
          <AuthLink mode="register" role="merchant" redirectTo="/sell" className="text-muted-foreground hover:text-primary">Open a store</AuthLink>
          <Link to="/sell/promote" className="text-muted-foreground hover:text-primary">Advertise your products</Link>
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

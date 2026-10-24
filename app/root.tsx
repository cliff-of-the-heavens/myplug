import { useEffect } from "react";
import { AuthDialogProvider } from "~/components/auth-dialog";
import {
  isRouteErrorResponse,
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  type ShouldRevalidateFunctionArgs,
} from "react-router";
import { Tracker } from "~/components/tracker";
import type { Route } from "./+types/root";
import "./app.css";
import { Container } from "./components/page";
import { MobileTabBar, SiteFooter, SiteHeader } from "./components/site-header";
import { Button } from "./components/ui/button";
import { analyticsOn } from "./lib/analytics.server";
import { getUser } from "./lib/auth.server";
import { getCategories } from "./lib/catalog.server";
import { unreadCount } from "./lib/messaging.server";
import { ICON_VERSION, iconUrl } from "./lib/brand";
import { unreadNotifications } from "./lib/notify.server";
import { cartCount, favouriteIds } from "./lib/shopping.server";
import { TERMS_VERSION } from "./lib/terms";
import { TermsGate } from "./components/terms-gate";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap",
  },
  { rel: "manifest", href: `/manifest.webmanifest?v=${ICON_VERSION}` },
  { rel: "icon", href: iconUrl("icon.svg"), type: "image/svg+xml" },
  { rel: "apple-touch-icon", href: iconUrl("apple-touch-icon.png") },
];

export const meta: Route.MetaFunction = () => [
  { title: "MyPlug — Shop local merchants" },
  { name: "description", content: "Discover and order from local merchants, request custom items and chat directly with sellers." },
];

export async function loader({ request }: Route.LoaderArgs) {
  const [user, categories, analytics] = await Promise.all([getUser(request), getCategories(), analyticsOn()]);
  const [unread, notices] = user ? await Promise.all([unreadCount(user), unreadNotifications(user.id)]) : [0, 0];
  // Hearts and the cart badge, for customers
  const [saved, cart] =
    user?.role === "customer" ? await Promise.all([favouriteIds(user.id), cartCount(user.id)]) : [{ products: [], stores: [] }, 0];
  // Everyone must accept the current Terms of Use (new users at sign-up, existing users once).
  const needsTerms = !!user && user.termsVersion !== TERMS_VERSION;
  return { user, categories, unread, notices, needsTerms, saved, cart, analytics };
}

// Don't refetch categories/user on every form submission unless it could have changed.
export function shouldRevalidate({ formAction, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  if (formAction === "/api/report") return false;
  return defaultShouldRevalidate;
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#f2643a" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="MyPlug" />
        <Meta />
        <Links />
      </head>
      <body className="min-h-dvh">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

function useServiceWorker() {
  useEffect(() => {
    if (import.meta.env.PROD && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
}

/** A file dropped outside a drop zone would make the browser open it, losing whatever form was being filled in. */
function useBlockStrayFileDrops() {
  useEffect(() => {
    function block(e: DragEvent) {
      if (e.defaultPrevented || !e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "none";
    }
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => {
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
    };
  }, []);
}

export default function App({ loaderData }: Route.ComponentProps) {
  useServiceWorker();
  useBlockStrayFileDrops();
  const { user, categories, unread, notices, needsTerms, cart, analytics } = loaderData;
  return (
    <AuthDialogProvider signedIn={!!user}>
      <SiteHeader user={user} categories={categories} unread={unread} notices={notices} cart={cart} />
      {needsTerms ? <TermsGate /> : null}
      <main className="pb-20 md:pb-0">
        <Outlet />
        <Tracker enabled={analytics} />
      </main>
      <SiteFooter />
      <MobileTabBar user={user} unread={unread} />
    </AuthDialogProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let details = "An unexpected error occurred. Please try again.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    title = error.status === 404 ? "Page not found" : error.status === 403 ? "Not allowed" : `Error ${error.status}`;
    details = typeof error.data === "string" && error.data ? error.data : error.statusText || details;
    if (error.status === 404) details = "We couldn't find what you were looking for.";
  } else if (import.meta.env.DEV && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <Container className="grid min-h-[60dvh] place-items-center py-16 text-center">
      <div className="grid gap-4">
        <p className="brand-gradient bg-clip-text text-6xl font-black text-transparent">Oops!</p>
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="text-muted-foreground">{details}</p>
        <Button asChild className="justify-self-center">
          <Link to="/">Back to shopping</Link>
        </Button>
        {stack ? <pre className="max-w-3xl overflow-x-auto rounded-lg bg-muted p-4 text-left text-xs">{stack}</pre> : null}
      </div>
    </Container>
  );
}

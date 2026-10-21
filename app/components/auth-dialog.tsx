import { BikeIcon, HourglassIcon, ShoppingBagIcon, StoreIcon } from "lucide-react";
import { createContext, useContext, useEffect, useState } from "react";
import { Link, useFetcher, useLocation, type LinkProps } from "react-router";
import { cn } from "~/lib/utils";
import type { action as loginAction } from "~/routes/login";
import type { action as registerAction } from "~/routes/register";
import { FormError } from "./page";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Field, Input, Textarea } from "./ui/input";

export type AuthMode = "login" | "register";
type Role = "customer" | "merchant" | "courier";
type AuthOptions = { redirectTo?: string; role?: Role };

const AUTH_PARAMS = ["auth", "redirectTo", "role"];

/** The current path with any auth pop-up parameters removed. */
function currentPath(location: { pathname: string; search: string }) {
  const params = new URLSearchParams(location.search);
  for (const p of AUTH_PARAMS) params.delete(p);
  const qs = params.toString();
  return location.pathname + (qs ? `?${qs}` : "");
}

// ---------------------------------------------------------------- forms

/** "Switch to sign up" control: a button inside the pop-up, a link on the full pages. */
function SwitchLink({ mode, onSwitch, children }: { mode: AuthMode; onSwitch?: () => void; children: React.ReactNode }) {
  const className = "font-semibold text-primary hover:underline";
  return onSwitch ? (
    <button type="button" onClick={onSwitch} className={className}>
      {children}
    </button>
  ) : (
    <Link to={`/${mode}`} className={className}>
      {children}
    </Link>
  );
}

export function LoginForm({ redirectTo, onSwitch }: { redirectTo: string; onSwitch?: () => void }) {
  const fetcher = useFetcher<typeof loginAction>();
  const busy = fetcher.state !== "idle";
  return (
    <fetcher.Form method="post" action="/login" className="grid gap-4">
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <FormError error={fetcher.data?.error} />
      <Field label="Email">
        <Input name="email" type="email" autoComplete="email" required autoFocus />
      </Field>
      <Field label="Password">
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      <Button type="submit" size="lg" disabled={busy}>
        {busy ? "Signing in..." : "Sign in"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        New to MyPlug?{" "}
        <SwitchLink mode="register" onSwitch={onSwitch}>
          Create an account
        </SwitchLink>
      </p>
    </fetcher.Form>
  );
}

export function RegisterForm({
  redirectTo,
  defaultRole = "customer",
  onSwitch,
}: {
  redirectTo: string;
  defaultRole?: Role;
  onSwitch?: () => void;
}) {
  const fetcher = useFetcher<typeof registerAction>();
  const [role, setRole] = useState<Role>(defaultRole);
  const busy = fetcher.state !== "idle";
  const errors = fetcher.data?.errors ?? {};

  const roles = [
    { value: "customer" as const, icon: ShoppingBagIcon, title: "I want to shop", text: "Order, track and request items" },
    { value: "merchant" as const, icon: StoreIcon, title: "I want to sell", text: "Products, services or downloads" },
    { value: "courier" as const, icon: BikeIcon, title: "I deliver", text: "Register as a courier" },
  ];

  return (
    <fetcher.Form method="post" action="/register" className="grid gap-4">
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <div className="grid grid-cols-3 gap-2">
        {roles.map((r) => (
          <label
            key={r.value}
            className={cn(
              "flex cursor-pointer flex-col gap-1 rounded-xl border-2 p-3 transition-colors",
              role === r.value ? "border-primary bg-primary/5" : "hover:border-primary/40",
            )}
          >
            <input
              type="radio"
              name="role"
              value={r.value}
              checked={role === r.value}
              onChange={() => setRole(r.value)}
              className="sr-only"
            />
            <r.icon className={cn("size-6", role === r.value ? "text-primary" : "text-muted-foreground")} />
            <span className="font-bold">{r.title}</span>
            <span className="text-xs text-muted-foreground">{r.text}</span>
          </label>
        ))}
      </div>

      <Field label="Full name" error={errors.name?.[0]}>
        <Input name="name" autoComplete="name" required />
      </Field>
      <Field label="Email" error={errors.email?.[0]}>
        <Input name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label={role === "courier" ? "Phone" : "Phone (optional)"} error={errors.phone?.[0]}>
        <Input name="phone" type="tel" autoComplete="tel" required={role === "courier"} />
      </Field>
      <Field label="Password" error={errors.password?.[0]} hint="At least 8 characters">
        <Input name="password" type="password" autoComplete="new-password" required minLength={8} />
      </Field>

      {role === "merchant" ? (
        <div className="grid gap-4 rounded-xl bg-secondary/60 p-4">
          <Field label="Store name" error={errors.storeName?.[0]}>
            <Input name="storeName" required />
          </Field>
          <Field label="Business registration number" error={errors.registrationNumber?.[0]} hint="You can upload your certificate and licences after signing up">
            <Input name="registrationNumber" required minLength={3} maxLength={60} placeholder="e.g. COY-2021-123456" />
          </Field>
          <Field label="What do you sell? (optional)">
            <Textarea name="storeDescription" rows={2} className="min-h-0" />
          </Field>
          <p className="flex gap-2 text-xs text-muted-foreground">
            <HourglassIcon className="size-4 shrink-0 text-primary" />
            We review every new store before it can sell. You'll be able to list products once an admin has
            approved it.
          </p>
        </div>
      ) : null}

      {role === "courier" ? (
        <p className="flex gap-2 rounded-xl bg-secondary/60 p-3 text-xs text-muted-foreground">
          <HourglassIcon className="size-4 shrink-0 text-primary" />
          Next you'll add a clear photo of your face and your ID document. An admin checks them before you can take jobs.
        </p>
      ) : null}
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="terms" required className="mt-0.5 size-4 accent-primary" />
        <span>
          I accept the{" "}
          <a href="/terms" target="_blank" rel="noreferrer" className="font-semibold text-primary underline">
            Terms of Use
          </a>
          . I understand MyPlug only connects people, offers no guarantees, and I use it at my own risk.
        </span>
      </label>
      <FormError error={errors.terms?.[0] ?? errors.role?.[0]} />
      <Button type="submit" size="lg" disabled={busy}>
        {busy ? "Creating account..." : role === "merchant" ? "Apply to sell" : role === "courier" ? "Register as a courier" : "Create account"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <SwitchLink mode="login" onSwitch={onSwitch}>
          Sign in
        </SwitchLink>
      </p>
    </fetcher.Form>
  );
}

// ---------------------------------------------------------------- pop-up

const AuthContext = createContext<{ open: (mode: AuthMode, opts?: AuthOptions) => void } | null>(null);

export function useAuthDialog() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuthDialog must be used inside <AuthDialogProvider>");
  return ctx;
}

/**
 * Renders the sign-in / sign-up pop-up. It opens from <AuthLink> clicks, and from
 * `?auth=login&redirectTo=...` in the URL, which is where pages that need an
 * account send guests.
 */
export function AuthDialogProvider({ signedIn, children }: { signedIn: boolean; children: React.ReactNode }) {
  const location = useLocation();
  const [state, setState] = useState<{ mode: AuthMode; opts: AuthOptions } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const mode = params.get("auth");
    if (mode !== "login" && mode !== "register") return;
    if (!signedIn) {
      setState({
        mode,
        opts: {
          redirectTo: params.get("redirectTo") ?? undefined,
          role: params.get("role") === "merchant" ? "merchant" : undefined,
        },
      });
    }
    // Tidy the address bar without a navigation (which would reshuffle the feed).
    window.history.replaceState(window.history.state, "", currentPath(location) + location.hash);
  }, [location.search]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close once the sign-in succeeded and the app reloaded the user.
  useEffect(() => {
    if (signedIn) setState(null);
  }, [signedIn]);

  const redirectTo = state?.opts.redirectTo ?? currentPath(location);
  const switchTo = (mode: AuthMode) => setState((s) => (s ? { ...s, mode } : s));

  return (
    <AuthContext.Provider value={{ open: (mode, opts = {}) => setState({ mode, opts }) }}>
      {children}
      <Dialog open={!!state} onOpenChange={(open) => !open && setState(null)}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto">
          {state?.mode === "register" ? (
            <>
              <DialogHeader className="text-center">
                <DialogTitle className="text-2xl">Create your account</DialogTitle>
                <DialogDescription>Browse freely. Sign up to order, chat and sell.</DialogDescription>
              </DialogHeader>
              <RegisterForm
                key="register"
                redirectTo={redirectTo}
                defaultRole={state.opts.role}
                onSwitch={() => switchTo("login")}
              />
            </>
          ) : (
            <>
              <DialogHeader className="text-center">
                <DialogTitle className="text-2xl">Welcome back</DialogTitle>
                <DialogDescription>Sign in to order, chat with merchants and track deliveries.</DialogDescription>
              </DialogHeader>
              <LoginForm key="login" redirectTo={redirectTo} onSwitch={() => switchTo("register")} />
            </>
          )}
        </DialogContent>
      </Dialog>
    </AuthContext.Provider>
  );
}

/**
 * A link to /login or /register that opens the pop-up instead. Without JavaScript
 * (or with ctrl/cmd-click) it still works as an ordinary link to the full page.
 */
export function AuthLink({
  mode,
  role,
  redirectTo,
  onClick,
  ...props
}: Omit<LinkProps, "to"> & { mode: AuthMode; role?: Role; redirectTo?: string }) {
  const auth = useAuthDialog();
  const location = useLocation();
  const target = redirectTo ?? currentPath(location);
  const params = new URLSearchParams({ redirectTo: target });
  if (role) params.set("role", role);

  return (
    <Link
      to={`/${mode}?${params}`}
      {...props}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        auth.open(mode, { redirectTo: target, role });
      }}
    />
  );
}

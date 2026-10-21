import type { LucideIcon } from "lucide-react";
import { cn } from "~/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-6 flex flex-wrap items-end justify-between gap-4", className)}>
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">{title}</h1>
        {description ? <p className="mt-1 text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-6 py-14 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
        <Icon className="size-7" />
      </span>
      <h2 className="text-lg font-bold">{title}</h2>
      {children ? <div className="max-w-sm text-sm text-muted-foreground">{children}</div> : null}
    </div>
  );
}

export function Container({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("mx-auto w-full max-w-7xl px-4 md:px-6", className)} {...props} />;
}

/** One-time message after a redirect (see redirectWithFlash). */
export function FlashMessage({ flash }: { flash: { tone: "success" | "warning"; text: string } | null }) {
  if (!flash) return null;
  return (
    <p
      role="status"
      className={cn(
        "mb-4 rounded-lg px-3 py-2 text-sm font-medium",
        flash.tone === "success" ? "bg-success/15 text-success" : "bg-warning/20 text-highlight-foreground dark:text-warning",
      )}
    >
      {flash.text}
    </p>
  );
}

export function FormError({ error }: { error?: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
      {error}
    </p>
  );
}

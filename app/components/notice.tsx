import { CheckCircle2Icon, CircleAlertIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useFetchers, useNavigation } from "react-router";
import { cn } from "~/lib/utils";

export type NoticeTone = "success" | "warning" | "error";

const TONE = {
  success: { inline: "bg-success/15 text-success", icon: CheckCircle2Icon, bar: "bg-success" },
  warning: { inline: "bg-warning/20 text-highlight-foreground dark:text-warning", icon: TriangleAlertIcon, bar: "bg-warning" },
  error: { inline: "bg-destructive/10 text-destructive", icon: CircleAlertIcon, bar: "bg-destructive" },
};
const SHOW_MS = { success: 6000, warning: 9000, error: 10000 };

// ---------------------------------------------------------------- pop-ups

type Toast = { id: number; tone: NoticeTone; text: string; target: HTMLElement | null };
let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function showToast(t: Omit<Toast, "id">) {
  const id = nextId++;
  // The same message again replaces the old pop-up rather than stacking up.
  toasts = [...toasts.filter((x) => x.text !== t.text), { ...t, id }].slice(-3);
  emit();
  return id;
}

export function dismissToast(id: number) {
  if (!toasts.some((t) => t.id === id)) return;
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

function useToasts() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => toasts,
    () => toasts,
  );
}

/** Top-right pop-ups for messages that appeared somewhere off screen. Rendered once, in the root layout. */
export function Toaster() {
  const list = useToasts();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || !list.length) return null;
  return createPortal(
    <div className="pointer-events-none fixed top-4 right-4 left-4 z-[100] flex flex-col items-end gap-2 sm:left-auto">
      {list.map((t) => (
        <ToastCard key={t.id} toast={t} />
      ))}
    </div>,
    document.body,
  );
}

function ToastCard({ toast }: { toast: Toast }) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(() => dismissToast(toast.id), SHOW_MS[toast.tone]);
    return () => clearTimeout(timer);
  }, [toast.id, toast.tone, paused]);
  const { icon: Icon, bar } = TONE[toast.tone];

  return (
    <div
      className="pointer-events-auto relative flex w-full max-w-sm overflow-hidden rounded-xl border bg-card text-card-foreground shadow-lg shadow-black/10 animate-in fade-in slide-in-from-top-2"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <span className={cn("w-1.5 shrink-0", bar)} />
      <button
        type="button"
        className="flex min-w-0 flex-1 items-start gap-2 p-3 text-left text-sm font-medium"
        title={toast.target ? "Show where this is" : undefined}
        onClick={() => {
          toast.target?.scrollIntoView({ behavior: "smooth", block: "center" });
          dismissToast(toast.id);
        }}
      >
        <Icon className={cn("mt-0.5 size-4 shrink-0", TONE[toast.tone].inline.split(" ").find((c) => c.startsWith("text-")))} />
        <span className="min-w-0 break-words">{toast.text}</span>
      </button>
      <button type="button" aria-label="Close" className="shrink-0 px-2 text-muted-foreground hover:text-foreground" onClick={() => dismissToast(toast.id)}>
        <XIcon className="size-4" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- inline message

function onScreen(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return true; // hidden on purpose: nothing to point at
  return r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
}

/**
 * A success, warning or error message shown where it happened (above the form or card). If that
 * spot is scrolled out of view when the message appears, it also pops up in the top-right corner.
 */
export function Notice({ tone, children, className }: { tone: NoticeTone; children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const toastId = useRef<number | null>(null);
  const text = typeof children === "string" ? children : (ref.current?.textContent ?? "");

  // Each finished submission counts, so the same message after a retry shows again.
  const navigation = useNavigation();
  const fetchers = useFetchers();
  const busy = navigation.state !== "idle" || fetchers.some((f) => f.state !== "idle");
  const [round, setRound] = useState(0);
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (wasBusy.current && !busy) setRound((n) => n + 1);
    wasBusy.current = busy;
  }, [busy]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const frame = requestAnimationFrame(() => {
      if (onScreen(el)) return;
      if (toastId.current) dismissToast(toastId.current);
      toastId.current = showToast({ tone, text: el.textContent ?? text, target: el });
    });
    // Once the message itself comes into view, the pop-up isn't needed.
    const watch = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && toastId.current) {
        dismissToast(toastId.current);
        toastId.current = null;
      }
    });
    watch.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      watch.disconnect();
    };
  }, [tone, text, round]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () => () => {
      if (toastId.current) dismissToast(toastId.current);
    },
    [],
  );

  return (
    <p ref={ref} role={tone === "error" ? "alert" : "status"} className={cn("rounded-lg px-3 py-2 text-sm font-medium", TONE[tone].inline, className)}>
      {children}
    </p>
  );
}

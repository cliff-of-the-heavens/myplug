import { useEffect, useRef } from "react";
import { useRevalidator, useRouteLoaderData } from "react-router";
import type { loader as rootLoader } from "~/root";

export function useOptionalUser() {
  return useRouteLoaderData<typeof rootLoader>("root")?.user ?? null;
}

/** Inside the admin session's 30-minute idle limit, so a page left open can't keep it alive. */
const ADMIN_POLL_IDLE_MS = 25 * 60_000;

/** Re-runs loaders on an interval while the tab is visible (used for chat). */
export function usePolling(ms: number) {
  const { revalidate, state } = useRevalidator();
  const isAdmin = useOptionalUser()?.role === "admin";
  const lastInput = useRef(Date.now());

  useEffect(() => {
    const seen = () => {
      lastInput.current = Date.now();
    };
    window.addEventListener("pointerdown", seen);
    window.addEventListener("keydown", seen);
    return () => {
      window.removeEventListener("pointerdown", seen);
      window.removeEventListener("keydown", seen);
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      if (isAdmin && Date.now() - lastInput.current > ADMIN_POLL_IDLE_MS) return;
      if (document.visibilityState === "visible" && state === "idle") revalidate();
    }, ms);
    return () => clearInterval(id);
  }, [ms, revalidate, state, isAdmin]);
}

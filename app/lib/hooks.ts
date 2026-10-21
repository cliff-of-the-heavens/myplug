import { useEffect } from "react";
import { useRevalidator, useRouteLoaderData } from "react-router";
import type { loader as rootLoader } from "~/root";

export function useOptionalUser() {
  return useRouteLoaderData<typeof rootLoader>("root")?.user ?? null;
}

/** Re-runs loaders on an interval while the tab is visible (used for chat). */
export function usePolling(ms: number) {
  const { revalidate, state } = useRevalidator();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible" && state === "idle") revalidate();
    }, ms);
    return () => clearInterval(id);
  }, [ms, revalidate, state]);
}

import { previewAlertEmail } from "~/lib/alerts.server";
import { requireAdmin } from "~/lib/auth.server";
import { escapeHtml } from "~/lib/email.server";
import { isUuid } from "~/lib/utils";
import type { Route } from "./+types/admin.alert-preview";

/** Shows an alert's email as customers receive it (with a sample address). */
export async function loader({ request, params }: Route.LoaderArgs) {
  await requireAdmin(request);
  const email = isUuid(params.id) ? await previewAlertEmail(params.id) : null;
  if (!email) return new Response("Alert not found", { status: 404 });
  const banner = `<div style="font:13px Arial;padding:8px 12px;background:#222;color:#fff">Subject: ${escapeHtml(email.subject)}</div>`;
  return new Response(banner + email.html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // The preview only needs inline styles and images.
      "Content-Security-Policy": "default-src 'none'; img-src * data:; style-src 'unsafe-inline'",
    },
  });
}

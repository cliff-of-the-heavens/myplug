/**
 * Outgoing email. Every email is sent by MyPlug from EMAIL_FROM; merchants never
 * send email themselves and never see recipients' addresses.
 *
 * Uses Resend (https://resend.com) when RESEND_API_KEY is set. Without it, emails
 * are only logged, so development and the demo work without a provider.
 */

export type Email = {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
};

export type SendResult = { ok: true } | { ok: false; error: string };

export const EMAIL_PROVIDER_CONFIGURED = !!process.env.RESEND_API_KEY;

const FROM = process.env.EMAIL_FROM ?? "MyPlug <alerts@myplug.local>";

/** Absolute base URL for links in emails (no request is available when a background job sends them). */
export function appUrl() {
  const url =
    process.env.APP_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:5173");
  return url.replace(/\/$/, "");
}

/** Sends up to 100 emails in one request. Results are in the same order as the input. */
export async function sendEmails(emails: Email[]): Promise<SendResult[]> {
  if (!emails.length) return [];

  if (!EMAIL_PROVIDER_CONFIGURED) {
    for (const e of emails) console.info(`[email not sent: RESEND_API_KEY missing] to=${e.to} subject="${e.subject}"`);
    return emails.map(() => ({ ok: true }));
  }

  try {
    const res = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(emails.map((e) => ({ from: FROM, ...e }))),
    });
    if (!res.ok) {
      const error = `Resend ${res.status}: ${(await res.text()).slice(0, 300)}`;
      return emails.map(() => ({ ok: false, error }));
    }
    return emails.map(() => ({ ok: true }));
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return emails.map(() => ({ ok: false, error }));
  }
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

import { appUrl, escapeHtml as e } from "./email.server";

/** The site's colours as plain hex, because email apps don't understand its CSS. */
export const EMAIL_COLORS = {
  coral: "#f7511f",
  yellow: "#ffd32e",
  mint: "#d3f8ef",
  deepTeal: "#004b48",
  ink: "#181928",
  muted: "#6f6a78",
  page: "#fff4ec",
};
const c = EMAIL_COLORS;

export type EmailContent = {
  preview: string; // the grey line after the subject in an inbox
  title: string;
  eyebrow?: string; // small label above the title
  greeting?: string; // the person's name
  paragraphs?: string[];
  code?: string; // a one-time code, shown large
  html?: string; // extra content; the caller must have escaped it
  button?: { label: string; href: string };
  note?: string; // small print under the button
  footer?: string; // replaces the standard footer; the caller must have escaped it
};

/**
 * MyPlug's email design. It uses tables and inline styles because that's all email apps
 * reliably support, and PNG for the logo because many of them block SVG.
 */
export function renderEmail(m: EmailContent) {
  const base = appUrl();
  const paragraph = (text: string) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${c.ink}">${e(text)}</p>`;

  const code = m.code
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 18px"><tr><td align="center" bgcolor="${c.mint}" style="background:${c.mint};border-radius:14px;padding:22px 12px">
<div style="font-family:'Courier New',Courier,monospace;font-size:36px;font-weight:bold;letter-spacing:10px;color:${c.deepTeal};padding-left:10px">${e(m.code)}</div>
</td></tr></table>`
    : "";

  const button = m.button
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:10px 0 6px"><tr><td align="center">
<a href="${e(m.button.href)}" style="display:inline-block;background:${c.coral};color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;padding:13px 28px;border-radius:999px">${e(m.button.label)}</a>
</td></tr></table>`
    : "";

  const footer =
    m.footer ??
    `MyPlug will never ask for your password or payment details by email.<br><a href="${e(base)}" style="color:${c.muted}">Visit MyPlug</a>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${e(m.title)}</title></head>
<body style="margin:0;padding:0;background:${c.page};font-family:Arial,Helvetica,sans-serif;color:${c.ink}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${e(m.preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${c.page}" style="background:${c.page}"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="max-width:540px;background:#ffffff;border-radius:20px;overflow:hidden">
<tr><td bgcolor="${c.coral}" style="background-color:${c.coral};background-image:linear-gradient(115deg,#ff8b22 0%,#ff326f 45%,#d52db5 75%,#8140f4 100%);padding:22px 28px">
<a href="${e(base)}" style="text-decoration:none;color:#ffffff"><img src="${e(base)}/icons/icon-192.png?v=2" width="40" height="40" alt="" style="vertical-align:middle;border-radius:11px;border:0"><span style="vertical-align:middle;font-size:24px;font-weight:bold;color:#ffffff;padding-left:10px;letter-spacing:-.5px">MyPlug</span></a>
</td></tr>
<tr><td height="5" bgcolor="${c.yellow}" style="background:${c.yellow};font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:30px 28px 24px">
${m.eyebrow ? `<span style="display:inline-block;background:${c.mint};color:${c.deepTeal};font-size:12px;font-weight:bold;letter-spacing:.04em;text-transform:uppercase;padding:5px 12px;border-radius:999px;margin-bottom:12px">${e(m.eyebrow)}</span>` : ""}
<h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:${c.ink}">${e(m.title)}</h1>
${m.greeting ? paragraph(`Hi ${m.greeting},`) : ""}
${(m.paragraphs ?? []).map(paragraph).join("")}
${code}${m.html ?? ""}${button}
${m.note ? `<p style="margin:14px 0 0;font-size:13px;line-height:1.5;color:${c.muted}">${e(m.note)}</p>` : ""}
</td></tr>
<tr><td style="padding:16px 28px 22px;border-top:1px solid #f1e8e1;font-size:12px;line-height:1.6;color:${c.muted}">${footer}</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

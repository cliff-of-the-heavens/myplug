import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "~/db/client.server";
import { appUrl, sendEmails } from "./email.server";
import { renderEmail } from "./email-template.server";

const { notifications, users } = schema;

export type Notice = { title: string; body?: string; href?: string };

/**
 * Tells people something happened: an in-app notification straight away (the bell in
 * the header), plus an email when `email` is set (for things that need action or are
 * security-relevant, like a pickup being confirmed).
 */
export async function notify(userIds: (string | null | undefined)[], notice: Notice, { email = false } = {}) {
  const ids = [...new Set(userIds.filter((id): id is string => !!id))];
  if (!ids.length) return;
  await db.insert(notifications).values(ids.map((userId) => ({ userId, title: notice.title, body: notice.body ?? null, href: notice.href ?? null })));
  if (!email) return;

  const recipients = await db
    .select({ email: users.email, name: users.name })
    .from(users)
    .where(and(inArray(users.id, ids), eq(users.status, "active")));
  const link = notice.href ? `${appUrl()}${notice.href}` : appUrl();
  try {
    await sendEmails(
      recipients.map((r) => ({
        to: r.email,
        subject: `MyPlug: ${notice.title}`,
        text: [`Hi ${r.name},`, "", notice.title, notice.body ?? "", "", `Open MyPlug: ${link}`].join("\n"),
        html: renderEmail({
          preview: notice.body ?? notice.title,
          title: notice.title,
          greeting: r.name,
          paragraphs: notice.body ? [notice.body] : [],
          button: { label: "Open MyPlug", href: link },
        }),
      })),
    );
  } catch (e) {
    console.error("Notification email failed", e); // the in-app notification is already saved
  }
}

export async function unreadNotifications(userId: string) {
  const [{ n }] = await db
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return n;
}

export function listNotifications(userId: string, limit = 50) {
  return db.query.notifications.findMany({
    where: eq(notifications.userId, userId),
    orderBy: desc(notifications.createdAt),
    limit,
  });
}

export async function markAllRead(userId: string) {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
}

/** Notifies every active admin (e.g. a review flagged for checking, an ad request). */
export async function notifyAdmins(notice: Notice, opts: { email?: boolean } = {}) {
  const admins = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.status, "active")));
  await notify(admins.map((a) => a.id), notice, opts);
}

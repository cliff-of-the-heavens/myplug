import { desc, sql } from "drizzle-orm";
import { ImageIcon, WandSparklesIcon } from "lucide-react";
import { NavLink, Outlet, useParams } from "react-router";
import { Container } from "~/components/page";
import { db, schema } from "~/db/client.server";
import { requireUser } from "~/lib/auth.server";
import { timeAgo } from "~/lib/format";
import { participantFilter, readColumn } from "~/lib/messaging.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/messages";

export const meta: Route.MetaFunction = () => [{ title: "Messages · MyPlug" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const c = schema.conversations;
  const readAt = readColumn(user);

  const rows = await db.query.conversations.findMany({
    where: participantFilter(user),
    orderBy: desc(c.lastMessageAt),
    limit: 100,
    with: {
      customer: { columns: { name: true } },
      store: { columns: { name: true } },
      messages: { orderBy: desc(schema.messages.createdAt), limit: 1, columns: { body: true, imageUrl: true } },
    },
    extras: {
      unread: sql<boolean>`(${readAt} is null or ${c.lastMessageAt} > ${readAt})`.as("unread"),
    },
  });

  const isMerchant = user.role === "merchant";
  return {
    conversations: rows.map((r) => ({
      id: r.id,
      title: isMerchant ? r.customer.name : r.store.name,
      subject: r.subject,
      special: r.isSpecialOrder || !!r.requestId,
      last: r.messages[0] ?? null,
      lastAt: r.lastMessageAt,
      unread: r.unread,
    })),
  };
}

export default function MessagesLayout({ loaderData }: Route.ComponentProps) {
  const { conversations } = loaderData;
  const { id } = useParams();

  return (
    <Container className="py-4 md:py-8">
      <div className="grid h-[calc(100dvh-13rem)] min-h-[28rem] overflow-hidden rounded-2xl border bg-card md:h-[calc(100dvh-14rem)] md:grid-cols-[20rem_1fr]">
        <aside className={cn("flex min-h-0 flex-col border-r", id && "hidden md:flex")}>
          <h1 className="border-b px-4 py-3 text-lg font-extrabold">Messages</h1>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {conversations.length === 0 ? (
              <li className="p-6 text-center text-sm text-muted-foreground">
                No conversations yet. Message a merchant from any product page.
              </li>
            ) : null}
            {conversations.map((c) => (
              <li key={c.id}>
                <NavLink
                  to={c.id}
                  className={({ isActive }) =>
                    cn("flex gap-3 border-b px-4 py-3 hover:bg-muted/60", isActive && "bg-secondary/70")
                  }
                >
                  <span className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary font-bold text-secondary-foreground">
                    {c.title.charAt(0).toUpperCase()}
                    {c.unread ? <span className="absolute top-0 right-0 size-3 rounded-full border-2 border-card bg-primary" /> : null}
                  </span>
                  <div className="grid min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className={cn("truncate text-sm", c.unread ? "font-extrabold" : "font-semibold")}>{c.title}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(c.lastAt)}</span>
                    </div>
                    <span className="flex items-center gap-1 truncate text-xs font-medium text-accent">
                      {c.special ? <WandSparklesIcon className="size-3 shrink-0" /> : null}
                      {c.subject}
                    </span>
                    <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                      {c.last?.imageUrl ? <ImageIcon className="size-3 shrink-0" /> : null}
                      {c.last ? c.last.body || "Photo" : "No messages yet"}
                    </span>
                  </div>
                </NavLink>
              </li>
            ))}
          </ul>
        </aside>
        <section className={cn("min-h-0", !id && "hidden md:block")}>
          <Outlet />
        </section>
      </div>
    </Container>
  );
}

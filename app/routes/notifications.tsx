import { BellIcon } from "lucide-react";
import { Link } from "react-router";
import { Container, EmptyState, PageHeader } from "~/components/page";
import { requireUser } from "~/lib/auth.server";
import { timeAgo } from "~/lib/format";
import { usePolling } from "~/lib/hooks";
import { listNotifications, markAllRead } from "~/lib/notify.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/notifications";

export const meta: Route.MetaFunction = () => [{ title: "Notifications · MyPlug" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const items = await listNotifications(user.id);
  // Opening the page counts as reading them; this list still highlights the ones that were new.
  await markAllRead(user.id);
  return { items };
}

export default function Notifications({ loaderData }: Route.ComponentProps) {
  const { items } = loaderData;
  usePolling(10_000);

  return (
    <Container className="max-w-2xl py-8">
      <PageHeader title="Notifications" />
      {items.length === 0 ? (
        <EmptyState icon={BellIcon} title="Nothing yet">
          Order updates, pickups and approvals will appear here.
        </EmptyState>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {items.map((n) => {
            const body = (
              <>
                <p className={cn("text-sm", !n.readAt && "font-bold")}>{n.title}</p>
                {n.body ? <p className="text-sm text-muted-foreground">{n.body}</p> : null}
                <p className="text-xs text-muted-foreground">{timeAgo(n.createdAt)}</p>
              </>
            );
            return (
              <li key={n.id} className={cn("relative px-4 py-3", !n.readAt && "bg-primary/5")}>
                {!n.readAt ? <span className="absolute top-4 left-1.5 size-2 rounded-full bg-primary" /> : null}
                {n.href ? (
                  <Link to={n.href} className="grid gap-0.5 hover:text-primary">
                    {body}
                  </Link>
                ) : (
                  <div className="grid gap-0.5">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Container>
  );
}

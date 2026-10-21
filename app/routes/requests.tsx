import { and, desc, eq, type SQL } from "drizzle-orm";
import { ImagePlusIcon, MessagesSquareIcon } from "lucide-react";
import { Link } from "react-router";
import { Container, EmptyState, PageHeader } from "~/components/page";
import { SafeImage } from "~/components/safe-image";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { db, schema } from "~/db/client.server";
import { getUser } from "~/lib/auth.server";
import { money, timeAgo } from "~/lib/format";
import type { Route } from "./+types/requests";

export const meta: Route.MetaFunction = () => [{ title: "Requests · MyPlug" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await getUser(request);
  const mine = new URL(request.url).searchParams.get("mine") === "1" && user?.role === "customer";
  const r = schema.requests;

  const where: SQL | undefined = mine ? eq(r.customerId, user!.id) : and(eq(r.status, "open"));
  const requests = await db.query.requests.findMany({
    where,
    orderBy: desc(r.createdAt),
    limit: 60,
    with: {
      customer: { columns: { name: true } },
      conversations: { columns: { id: true } },
    },
  });

  return {
    mine,
    requests: requests.map((q) => ({
      id: q.id,
      title: q.title,
      description: q.description,
      imageUrl: q.imageUrl,
      imageHidden: q.imageHidden,
      budgetCents: q.budgetCents,
      status: q.status,
      createdAt: q.createdAt,
      by: q.customer.name.split(" ")[0],
      responses: q.conversations.length,
    })),
  };
}

export default function Requests({ loaderData }: Route.ComponentProps) {
  const { requests, mine } = loaderData;
  return (
    <Container className="py-8">
      <PageHeader
        title={mine ? "My requests" : "Customer requests"}
        description={
          mine
            ? "Things you've asked merchants to make or find."
            : "Customers post photos of what they want. Merchants: reply to win the order."
        }
        actions={
          <Button asChild>
            <Link to="/requests/new">
              <ImagePlusIcon /> Post a request
            </Link>
          </Button>
        }
      />
      {requests.length ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {requests.map((q) => (
            <Link
              key={q.id}
              to={`/requests/${q.id}`}
              className="group overflow-hidden rounded-2xl border bg-card transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg"
            >
              <SafeImage src={q.imageUrl} hidden={q.imageHidden} alt={q.title} className="aspect-[4/3]" />
              <div className="grid gap-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="line-clamp-1 font-bold group-hover:text-primary">{q.title}</h2>
                  {q.status !== "open" ? <Badge variant="muted">{q.status}</Badge> : null}
                </div>
                <p className="line-clamp-2 text-sm text-muted-foreground">{q.description}</p>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {q.by} · {timeAgo(q.createdAt)}
                  </span>
                  <span className="flex items-center gap-2">
                    {q.budgetCents ? <Badge variant="highlight">Budget {money(q.budgetCents)}</Badge> : null}
                    <span className="flex items-center gap-1">
                      <MessagesSquareIcon className="size-3.5" /> {q.responses}
                    </span>
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState icon={ImagePlusIcon} title={mine ? "You haven't posted any requests" : "No open requests"}>
          Post a photo of what you need and merchants will message you.
        </EmptyState>
      )}
    </Container>
  );
}

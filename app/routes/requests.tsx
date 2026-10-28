import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { ImagePlusIcon, MapPinIcon, MessagesSquareIcon, WrenchIcon } from "lucide-react";
import { Link } from "react-router";
import { StickySubmenu, SUBMENU_CHIP } from "~/components/site-header";
import { getCategories } from "~/lib/catalog.server";
import { HANDYMAN_GROUP } from "~/lib/handyman";
import { cn } from "~/lib/utils";
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
  const url = new URL(request.url);
  const mine = url.searchParams.get("mine") === "1" && user?.role === "customer";
  const r = schema.requests;
  // Handyman jobs: one trade (?trade=), or every trade a handyman works in (?jobs=mine)
  const trades = (await getCategories()).filter((c) => c.group === HANDYMAN_GROUP);
  const myTrades =
    url.searchParams.get("jobs") === "mine" && user?.isTradesperson && user.storeId
      ? ((await db.query.stores.findFirst({ where: eq(schema.stores.id, user.storeId), columns: { trades: true } }))?.trades ?? [])
      : null;
  const tradeSlug = url.searchParams.get("trade");
  const tradeIds = myTrades
    ? trades.filter((t) => myTrades.includes(t.slug)).map((t) => t.id)
    : trades.filter((t) => t.slug === tradeSlug).map((t) => t.id);
  const filterTrade = !!myTrades || !!tradeIds.length;

  const where: SQL | undefined = mine
    ? eq(r.customerId, user!.id)
    : and(eq(r.status, "open"), filterTrade ? (tradeIds.length ? inArray(r.categoryId, tradeIds) : sql`false`) : undefined);
  const requests = await db.query.requests.findMany({
    where,
    orderBy: desc(r.createdAt),
    limit: 60,
    with: {
      customer: { columns: { name: true } },
      conversations: { columns: { id: true } },
      category: { columns: { name: true, group: true } },
    },
  });

  return {
    mine,
    myJobs: !!myTrades,
    trade: myTrades ? null : tradeSlug,
    trades: trades.map((t) => ({ slug: t.slug, name: t.name })),
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
      tradeName: q.category?.group === HANDYMAN_GROUP ? q.category.name : null,
      location: q.location,
    })),
  };
}

export default function Requests({ loaderData }: Route.ComponentProps) {
  const { requests, mine, myJobs, trade, trades } = loaderData;
  const chip = (to: string, label: string, active: boolean) => (
    <Link
      key={label}
      to={to}
      className={cn("shrink-0 rounded-full border-2 px-3 py-1 text-sm font-medium transition-colors", active ? SUBMENU_CHIP.active : SUBMENU_CHIP.idle)}
    >
      {label}
    </Link>
  );
  return (
    <>
    <Container className="pt-8">
      <PageHeader
        title={mine ? "My requests" : myJobs ? "Jobs in my trades" : trade ? `${trades.find((t) => t.slug === trade)?.name ?? "Handyman"} jobs` : "Customer requests"}
        description={
          mine
            ? "Things you've asked merchants to make or find."
            : myJobs
              ? "Open jobs customers posted in the trades on your profile. Reply with a quote to win the work."
              : "Customers post photos of what they want, or jobs that need a handyman. Reply to win the work."
        }
        actions={
          <Button asChild>
            <Link to="/requests/new">
              <ImagePlusIcon /> Post a request
            </Link>
          </Button>
        }
      />
    </Container>
    {mine ? null : (
      <StickySubmenu className="mb-4">
        <Container className="scrollbar-none flex gap-2 overflow-x-auto py-2">
          {chip("/requests", "Everything", !trade && !myJobs)}
          {trades.map((t) => chip(`/requests?trade=${t.slug}`, t.name, trade === t.slug))}
        </Container>
      </StickySubmenu>
    )}
    <Container className="pb-8">
      {requests.length ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {requests.map((q) => (
            <Link
              key={q.id}
              to={`/requests/${q.id}`}
              className="group overflow-hidden rounded-2xl border bg-card transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg"
            >
              {q.imageUrl ? (
                <SafeImage src={q.imageUrl} hidden={q.imageHidden} alt={q.title} className="aspect-[4/3]" />
              ) : (
                <div className="flex aspect-[4/3] items-center justify-center bg-primary/5">
                  <WrenchIcon className="size-12 text-primary/40" />
                </div>
              )}
              <div className="grid gap-2 p-4">
                {q.tradeName ? (
                  <p className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant="accent">{q.tradeName}</Badge>
                    {q.location ? (
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <MapPinIcon className="size-3.5" /> {q.location}
                      </span>
                    ) : null}
                  </p>
                ) : null}
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
        <EmptyState icon={ImagePlusIcon} title={mine ? "You haven't posted any requests" : myJobs || trade ? "No open jobs here" : "No open requests"}>
          {myJobs ? "We'll notify you as soon as a customer posts a job in your trades." : "Post a photo of what you need and merchants will message you."}
        </EmptyState>
      )}
    </Container>
    </>
  );
}

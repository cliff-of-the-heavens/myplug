import { desc, eq } from "drizzle-orm";
import { CheckIcon, MessageCircleIcon, StoreIcon, XIcon } from "lucide-react";
import { data, Form, Link, redirect } from "react-router";
import { AuthLink } from "~/components/auth-dialog";
import { Container } from "~/components/page";
import { ReportButton } from "~/components/report-button";
import { SafeImage } from "~/components/safe-image";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { db, schema } from "~/db/client.server";
import { getUser, requireUser } from "~/lib/auth.server";
import { money, timeAgo } from "~/lib/format";
import { useOptionalUser } from "~/lib/hooks";
import { findOrCreateConversation } from "~/lib/messaging.server";
import type { Route } from "./+types/requests.detail";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data ? `${data.req.title} · Requests · MyPlug` : "Request · MyPlug" }];
}

async function loadRequest(id: string) {
  const req = await db.query.requests.findFirst({
    where: eq(schema.requests.id, id),
    with: { customer: { columns: { id: true, name: true } } },
  });
  if (!req) throw data("Request not found", { status: 404 });
  return req;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const [user, req] = await Promise.all([getUser(request), loadRequest(params.id)]);
  const isOwner = user?.id === req.customerId;

  // The requester sees every merchant that replied; a merchant sees their own thread.
  const responses = isOwner
    ? await db.query.conversations.findMany({
        where: eq(schema.conversations.requestId, req.id),
        orderBy: desc(schema.conversations.lastMessageAt),
        with: { store: { columns: { name: true, slug: true } } },
      })
    : [];
  const myThread =
    user?.storeId
      ? await db.query.conversations.findFirst({
          where: (c, { and, eq }) => and(eq(c.requestId, req.id), eq(c.storeId, user.storeId!)),
          columns: { id: true },
        })
      : null;

  return { req: { ...req, customerName: req.customer.name.split(" ")[0] }, isOwner, responses, myThread };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireUser(request);
  const req = await loadRequest(params.id);
  const intent = (await request.formData()).get("intent");

  if (intent === "respond") {
    if (user.role !== "merchant" || !user.storeId) throw data("Only merchants can respond.", { status: 403 });
    if (user.storeStatus !== "approved") throw data("Your store needs to be approved first.", { status: 403 });
    if (req.status !== "open") throw data("This request is closed.", { status: 400 });
    const convo = await findOrCreateConversation({
      customerId: req.customerId,
      storeId: user.storeId,
      requestId: req.id,
      subject: `Request: ${req.title}`,
      isSpecialOrder: true,
    });
    return redirect(`/messages/${convo.id}`);
  }

  if (intent === "fulfilled" || intent === "closed" || intent === "open") {
    if (user.id !== req.customerId) throw data("Not your request.", { status: 403 });
    await db.update(schema.requests).set({ status: intent }).where(eq(schema.requests.id, req.id));
    return { ok: true };
  }

  throw data("Unknown action", { status: 400 });
}

export default function RequestDetail({ loaderData }: Route.ComponentProps) {
  const { req, isOwner, responses, myThread } = loaderData;
  const user = useOptionalUser();

  return (
    <Container className="max-w-5xl py-8">
      <div className="grid gap-8 md:grid-cols-[1.1fr_1fr]">
        <div className="grid content-start gap-2">
          <SafeImage src={req.imageUrl} hidden={req.imageHidden} alt={req.title} className="aspect-square rounded-2xl border" imgClassName="object-contain" />
          {!isOwner ? <ReportButton targetType="request" targetId={req.id} label="Report image" className="justify-self-end" /> : null}
        </div>

        <div className="grid content-start gap-5">
          <div className="grid gap-2">
            <div className="flex flex-wrap gap-2">
              <Badge variant={req.status === "open" ? "success" : "muted"}>{req.status}</Badge>
              {req.budgetCents ? <Badge variant="highlight">Budget {money(req.budgetCents)}</Badge> : null}
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">{req.title}</h1>
            <p className="text-sm text-muted-foreground">
              Requested by {req.customerName} · {timeAgo(req.createdAt)}
            </p>
          </div>
          <p className="whitespace-pre-line">{req.description}</p>

          {user?.role === "merchant" ? (
            myThread ? (
              <Button asChild size="lg" variant="accent">
                <Link to={`/messages/${myThread.id}`}>
                  <MessageCircleIcon /> Continue conversation
                </Link>
              </Button>
            ) : req.status === "open" ? (
              <Form method="post">
                <Button type="submit" name="intent" value="respond" size="lg" variant="accent" className="w-full">
                  <MessageCircleIcon /> Message {req.customerName} — I can do this
                </Button>
              </Form>
            ) : null
          ) : null}

          {!user ? (
            <Button asChild variant="outline">
              <AuthLink mode="login">Sign in as a merchant to respond</AuthLink>
            </Button>
          ) : null}

          {isOwner ? (
            <>
              <Form method="post" className="flex flex-wrap gap-2">
                {req.status === "open" ? (
                  <>
                    <Button type="submit" name="intent" value="fulfilled" variant="secondary" size="sm">
                      <CheckIcon /> Mark fulfilled
                    </Button>
                    <Button type="submit" name="intent" value="closed" variant="outline" size="sm">
                      <XIcon /> Close request
                    </Button>
                  </>
                ) : (
                  <Button type="submit" name="intent" value="open" variant="outline" size="sm">
                    Re-open request
                  </Button>
                )}
              </Form>
              <Card>
                <CardHeader>
                  <CardTitle>Merchant replies ({responses.length})</CardTitle>
                </CardHeader>
                <CardContent>
                  {responses.length ? (
                    <ul className="grid gap-2">
                      {responses.map((r) => (
                        <li key={r.id}>
                          <Link to={`/messages/${r.id}`} className="flex items-center gap-3 rounded-lg border p-3 hover:border-primary/40">
                            <StoreIcon className="size-5 text-accent" />
                            <span className="flex-1 font-semibold">{r.store.name}</span>
                            <span className="text-xs text-muted-foreground">{timeAgo(r.lastMessageAt)}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">No replies yet. Merchants will message you here.</p>
                  )}
                </CardContent>
              </Card>
            </>
          ) : null}
        </div>
      </div>
    </Container>
  );
}

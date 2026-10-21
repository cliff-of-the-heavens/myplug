import { desc, eq } from "drizzle-orm";
import { DownloadIcon, LibraryIcon, PlayIcon } from "lucide-react";
import { Form, Link, useNavigation } from "react-router";
import { Container, EmptyState, FormError, PageHeader } from "~/components/page";
import { SafeImage } from "~/components/safe-image";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { db, schema } from "~/db/client.server";
import { requireCustomer } from "~/lib/auth.server";
import { offerTerms } from "~/lib/digital";
import { DigitalError, grantState, startAccess, type GrantState } from "~/lib/digital.server";
import { date } from "~/lib/format";
import { str } from "~/lib/utils";
import type { Route } from "./+types/account.library";

export const meta: Route.MetaFunction = () => [{ title: "My library · MyPlug" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireCustomer(request);
  const grants = await db.query.digitalGrants.findMany({
    where: eq(schema.digitalGrants.userId, user.id),
    orderBy: desc(schema.digitalGrants.createdAt),
    with: {
      product: { columns: { id: true, title: true, imageUrl: true, imageHidden: true, mediaType: true } },
      order: { columns: { id: true, number: true } },
    },
  });
  return { grants: grants.map((g) => ({ ...g, state: grantState(g) })) };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireCustomer(request);
  const form = await request.formData();
  const grantId = str(form.get("grantId"));
  const purpose = form.get("intent") === "download" ? "download" : "stream";
  try {
    return { grantId, purpose, url: await startAccess(user.id, grantId, purpose) };
  } catch (e) {
    if (e instanceof DigitalError) return { error: e.message };
    throw e;
  }
}

const STATE: Record<GrantState, { label: string; tone: "success" | "warning" | "muted" | "destructive" }> = {
  awaiting_payment: { label: "Waiting for payment confirmation", tone: "warning" },
  active: { label: "Ready", tone: "success" },
  expired: { label: "Expired", tone: "muted" },
  used_up: { label: "All views used", tone: "muted" },
};

export default function Library({ loaderData, actionData }: Route.ComponentProps) {
  const { grants } = loaderData;
  const busy = useNavigation().state !== "idle";
  const opened = actionData && "url" in actionData ? actionData : null;

  return (
    <Container className="max-w-4xl py-8">
      <PageHeader title="My library" description="Videos, music and documents you've bought." />
      <FormError error={actionData && "error" in actionData ? actionData.error : null} />
      {grants.length === 0 ? (
        <EmptyState icon={LibraryIcon} title="Nothing here yet">
          Digital products you buy appear here. <Link to="/search?kind=digital" className="font-semibold text-primary">Browse downloads</Link>
        </EmptyState>
      ) : (
        <div className="mt-4 grid gap-4">
          {grants.map((g) => {
            const s = STATE[g.state];
            const isOpen = opened?.grantId === g.id;
            return (
              <Card key={g.id}>
                <CardContent className="grid gap-3 pt-5">
                  <div className="flex flex-wrap items-center gap-3">
                    <SafeImage src={g.product.imageUrl} hidden={g.product.imageHidden} alt="" className="size-14 rounded-lg" />
                    <div className="grid flex-1 gap-0.5">
                      <Link to={`/p/${g.product.id}`} className="font-bold hover:text-primary">{g.product.title}</Link>
                      <p className="text-xs text-muted-foreground">
                        {g.label} · {offerTerms(g, g.product.mediaType)}
                        {g.expiresAt ? ` · until ${date(g.expiresAt, true)}` : ""}
                        {g.mode === "stream" && g.maxViews ? ` · ${g.viewsUsed}/${g.maxViews} views used` : ""}
                      </p>
                    </div>
                    <Badge variant={s.tone}>{s.label}</Badge>
                  </div>
                  {g.state === "awaiting_payment" ? (
                    <p className="text-sm text-muted-foreground">
                      Pay the seller and report it on <Link to={`/account/orders/${g.order.id}`} className="font-semibold text-primary">order {g.order.number}</Link>.
                    </p>
                  ) : g.state === "active" ? (
                    <Form method="post" className="flex flex-wrap gap-2">
                      <input type="hidden" name="grantId" value={g.id} />
                      <Button type="submit" name="intent" value="stream" size="sm" disabled={busy}>
                        <PlayIcon /> {g.product.mediaType === "document" ? "Read" : g.product.mediaType === "audio" ? "Listen" : "Watch"}
                        {g.mode === "stream" && g.maxViews ? " (uses 1 view)" : ""}
                      </Button>
                      {g.mode === "download" ? (
                        <Button type="submit" name="intent" value="download" size="sm" variant="outline" disabled={busy}>
                          <DownloadIcon /> Download
                        </Button>
                      ) : null}
                    </Form>
                  ) : null}
                  {isOpen && opened.purpose === "stream" ? (
                    g.product.mediaType === "video" ? (
                      <video src={opened.url} controls autoPlay controlsList="nodownload" className="w-full rounded-xl bg-black" />
                    ) : g.product.mediaType === "audio" ? (
                      <audio src={opened.url} controls autoPlay controlsList="nodownload" className="w-full" />
                    ) : (
                      <iframe src={opened.url} title={g.product.title} className="h-[70vh] w-full rounded-xl border" />
                    )
                  ) : null}
                  {isOpen && opened.purpose === "download" ? (
                    <a href={opened.url} className="w-fit rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
                      Your download is ready: click to save
                    </a>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </Container>
  );
}

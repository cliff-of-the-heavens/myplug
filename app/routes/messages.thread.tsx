import { asc, eq } from "drizzle-orm";
import { ArrowLeftIcon, ImagePlusIcon, SendIcon, WandSparklesIcon, XIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { data, Link, useFetcher } from "react-router";
import { IMAGE_TYPES, useFilePreview, useImageDrop } from "~/components/image-dropzone";
import { ReportButton } from "~/components/report-button";
import { SafeImage } from "~/components/safe-image";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { db, schema } from "~/db/client.server";
import { requireUser } from "~/lib/auth.server";
import { date, money } from "~/lib/format";
import { usePolling } from "~/lib/hooks";
import { getConversationFor, sendMessage } from "~/lib/messaging.server";
import { uploadImage, UploadError } from "~/lib/upload.server";
import { cn, str } from "~/lib/utils";
import type { Route } from "./+types/messages.thread";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const convo = await getConversationFor(user, params.id);
  if (!convo) throw data("Conversation not found", { status: 404 });

  const messages = await db.query.messages.findMany({
    where: eq(schema.messages.conversationId, convo.id),
    orderBy: asc(schema.messages.createdAt),
    limit: 500,
  });

  // Mark as read for this side
  await db
    .update(schema.conversations)
    .set(convo.viewerSide === "merchant" ? { merchantReadAt: new Date() } : { customerReadAt: new Date() })
    .where(eq(schema.conversations.id, convo.id));

  return { convo, messages, me: user.id };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireUser(request);
  const convo = await getConversationFor(user, params.id);
  if (!convo) throw data("Conversation not found", { status: 404 });

  const form = await request.formData();
  const body = str(form.get("body")).slice(0, 4000);
  let imageUrl: string | null = null;
  try {
    imageUrl = await uploadImage(form.get("image"), "messages");
  } catch (e) {
    if (e instanceof UploadError) return { error: e.message };
    throw e;
  }
  if (!body && !imageUrl) return { error: "Write a message or attach a photo." };

  await sendMessage({ conversationId: convo.id, senderId: user.id, side: convo.viewerSide, body, imageUrl });
  return { ok: true };
}

function Composer() {
  const fetcher = useFetcher<typeof action>();
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, show] = useFilePreview();
  const drop = useImageDrop(inputRef, show);
  const sending = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && "ok" in fetcher.data) {
      formRef.current?.reset();
      show(null);
      drop.setError(null);
    }
  }, [fetcher.state, fetcher.data]);

  const error = drop.error ?? (fetcher.data && "error" in fetcher.data ? fetcher.data.error : null);

  return (
    <fetcher.Form
      ref={formRef}
      method="post"
      encType="multipart/form-data"
      className="relative grid gap-2 border-t p-3"
      {...drop.handlers}
    >
      {drop.dragging ? (
        <div className="pointer-events-none absolute inset-1 z-10 grid place-items-center rounded-xl border-2 border-dashed border-primary bg-primary/10 text-sm font-bold text-primary backdrop-blur-[2px]">
          Drop image to attach
        </div>
      ) : null}
      {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
      {preview ? (
        <div className="relative w-fit">
          <img src={preview} alt="" className="h-20 rounded-lg border object-cover" />
          <button
            type="button"
            aria-label="Remove photo"
            className="absolute -top-2 -right-2 rounded-full bg-foreground p-0.5 text-background"
            onClick={() => {
              if (inputRef.current) inputRef.current.value = "";
              show(null);
            }}
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      ) : null}
      <div className="flex items-end gap-2">
        <label
          title="Attach a photo (or drag one here)"
          className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-primary"
        >
          <ImagePlusIcon className="size-5" />
          <span className="sr-only">Attach photo</span>
          <input
            ref={inputRef}
            type="file"
            name="image"
            accept={IMAGE_TYPES.join(",")}
            className="sr-only"
            onChange={drop.onInputChange}
          />
        </label>
        <textarea
          name="body"
          rows={1}
          placeholder="Write a message..."
          className="max-h-32 min-h-10 flex-1 resize-none rounded-2xl border-2 border-input bg-background px-4 py-2 text-sm outline-none focus:border-primary"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <Button type="submit" size="icon" disabled={sending} aria-label="Send">
          <SendIcon />
        </Button>
      </div>
    </fetcher.Form>
  );
}

export default function Thread({ loaderData }: Route.ComponentProps) {
  const { convo, messages, me } = loaderData;
  const bottomRef = useRef<HTMLDivElement>(null);
  usePolling(5000);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const other = convo.viewerSide === "merchant" ? convo.customer.name : convo.store.name;
  const context = convo.product ?? convo.request;
  const contextHref = convo.product ? `/p/${convo.product.id}` : convo.request ? `/requests/${convo.request.id}` : null;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b px-3 py-2.5">
        <Button asChild variant="ghost" size="icon-sm" className="md:hidden">
          <Link to="/messages" aria-label="Back">
            <ArrowLeftIcon />
          </Link>
        </Button>
        <div className="grid min-w-0 flex-1">
          <span className="truncate font-bold">{other}</span>
          <span className="truncate text-xs text-muted-foreground">{convo.subject}</span>
        </div>
        {convo.isSpecialOrder ? (
          <Badge variant="accent">
            <WandSparklesIcon /> Special order
          </Badge>
        ) : null}
      </header>

      {context && contextHref ? (
        <Link to={contextHref} className="flex items-center gap-3 border-b bg-muted/40 px-4 py-2 hover:bg-muted">
          <SafeImage src={context.imageUrl} hidden={context.imageHidden} alt="" className="size-10 shrink-0 rounded-lg" />
          <span className="truncate text-sm font-medium">{context.title}</span>
          {convo.product ? <span className="ml-auto text-sm font-bold">{money(convo.product.priceCents, convo.store.currency)}</span> : null}
        </Link>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(var(--border)_1px,transparent_1px)] [background-size:18px_18px] p-4">
        <div className="grid gap-3">
          {messages.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {convo.isSpecialOrder
                ? "Describe what you'd like — sizes, colours, quantities — and attach reference photos."
                : "Say hello 👋"}
            </p>
          ) : null}
          {messages.map((m) => {
            const mine = m.senderId === me;
            return (
              <div key={m.id} className={cn("flex max-w-[80%] flex-col gap-1", mine ? "items-end justify-self-end" : "items-start")}>
                {m.imageUrl ? (
                  <div className="grid gap-1">
                    {m.imageHidden ? (
                      <SafeImage src={null} hidden alt="" className="size-48 rounded-2xl" />
                    ) : (
                      <a href={m.imageUrl} target="_blank" rel="noreferrer">
                        <img src={m.imageUrl} alt="Attached" className="max-h-64 rounded-2xl border object-cover" />
                      </a>
                    )}
                    {!mine ? <ReportButton targetType="message" targetId={m.id} label="Report image" /> : null}
                  </div>
                ) : null}
                {m.body ? (
                  <p
                    className={cn(
                      "rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap shadow-sm",
                      mine ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm border bg-card",
                    )}
                  >
                    {m.body}
                  </p>
                ) : null}
                <span className="text-[10px] text-muted-foreground">{date(m.createdAt, true)}</span>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </div>

      <Composer />
    </div>
  );
}

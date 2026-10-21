import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "~/db/client.server";
import type { SessionUser } from "./auth.server";

const { conversations, messages } = schema;

/** Conversations the user takes part in, as customer or as the store's merchant. */
export function participantFilter(user: SessionUser) {
  return user.role === "merchant" && user.storeId
    ? eq(conversations.storeId, user.storeId)
    : eq(conversations.customerId, user.id);
}

/** Which "read at" column belongs to this user's side of a conversation. */
export function readColumn(user: SessionUser) {
  return user.role === "merchant" ? conversations.merchantReadAt : conversations.customerReadAt;
}

export async function unreadCount(user: SessionUser) {
  if (user.role === "admin") return 0;
  const readAt = readColumn(user);
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(conversations)
    .where(and(participantFilter(user), or(isNull(readAt), sql`${conversations.lastMessageAt} > ${readAt}`)));
  return n;
}

/** Loads a conversation, returning null if the user isn't part of it. */
export async function getConversationFor(user: SessionUser, id: string) {
  const convo = await db.query.conversations.findFirst({
    where: eq(conversations.id, id),
    with: {
      customer: { columns: { id: true, name: true } },
      store: { columns: { id: true, name: true, slug: true, ownerId: true, currency: true } },
      product: { columns: { id: true, title: true, imageUrl: true, imageHidden: true, priceCents: true } },
      request: { columns: { id: true, title: true, imageUrl: true, imageHidden: true } },
    },
  });
  if (!convo) return null;
  const isCustomer = convo.customerId === user.id;
  const isMerchant = !!user.storeId && convo.storeId === user.storeId;
  if (!isCustomer && !isMerchant) return null;
  return { ...convo, viewerSide: isMerchant ? ("merchant" as const) : ("customer" as const) };
}

export async function sendMessage(input: {
  conversationId: string;
  senderId: string;
  side: "customer" | "merchant";
  body: string;
  imageUrl: string | null;
}) {
  const now = new Date();
  await db.insert(messages).values({
    conversationId: input.conversationId,
    senderId: input.senderId,
    body: input.body,
    imageUrl: input.imageUrl,
    createdAt: now,
  });
  await db
    .update(conversations)
    .set({
      lastMessageAt: now,
      ...(input.side === "merchant" ? { merchantReadAt: now } : { customerReadAt: now }),
    })
    .where(eq(conversations.id, input.conversationId));
}

/** Finds the existing thread between a customer and a store about a product/request, or starts one. */
export async function findOrCreateConversation(input: {
  customerId: string;
  storeId: string;
  subject: string;
  productId?: string | null;
  requestId?: string | null;
  isSpecialOrder?: boolean;
}) {
  const existing = await db.query.conversations.findFirst({
    where: and(
      eq(conversations.customerId, input.customerId),
      eq(conversations.storeId, input.storeId),
      input.requestId ? eq(conversations.requestId, input.requestId) : isNull(conversations.requestId),
      input.productId ? eq(conversations.productId, input.productId) : isNull(conversations.productId),
      eq(conversations.isSpecialOrder, input.isSpecialOrder ?? false),
    ),
  });
  if (existing) return existing;

  const [created] = await db
    .insert(conversations)
    .values({
      customerId: input.customerId,
      storeId: input.storeId,
      subject: input.subject,
      productId: input.productId ?? null,
      requestId: input.requestId ?? null,
      isSpecialOrder: input.isSpecialOrder ?? false,
    })
    .onConflictDoNothing()
    .returning();
  // A concurrent request may have created it first (unique on request+store).
  return (
    created ??
    (await db.query.conversations.findFirst({
      where: and(eq(conversations.requestId, input.requestId!), eq(conversations.storeId, input.storeId)),
    }))!
  );
}

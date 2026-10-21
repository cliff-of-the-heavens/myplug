import { and, eq, isNotNull, lte, sql } from "drizzle-orm";
import { db, schema } from "~/db/client.server";
import type { PaymentTiming, PlanDeliveryPrefs, PlanFrequency } from "~/db/schema";
import { addDays, FREQUENCIES, isDateStr, nextOccurrence, today, type DateStr } from "./dates";
import { createDeliveryTx, deliveryFromPrefs, notifyInvitedCouriers } from "./delivery.server";
import { createOrderTx, OrderError, referenceNumber } from "./orders.server";

const { recurringPlans, planPrepayments, products, stores } = schema;

/** Customer sets up a repeating order, e.g. 2 loaves every weekday. */
export async function createPlan(input: {
  customerId: string;
  productId: string;
  quantity: number;
  frequency: PlanFrequency;
  startOn: string;
  endOn: string | null;
  paymentTiming: PaymentTiming;
  shippingAddress: string;
  notes?: string;
  deliveryPrefs?: PlanDeliveryPrefs;
}) {
  if (!FREQUENCIES.includes(input.frequency)) throw new OrderError("Choose how often to deliver.");
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 999) throw new OrderError("Choose a quantity.");
  if (!isDateStr(input.startOn) || input.startOn <= today()) throw new OrderError("The first delivery must be from tomorrow onwards.");
  if (input.endOn && (!isDateStr(input.endOn) || input.endOn < input.startOn)) throw new OrderError("The end date must be after the start date.");

  const product = await db.query.products.findFirst({
    where: eq(products.id, input.productId),
    with: { store: { columns: { currency: true, status: true } } },
  });
  if (!product?.isActive || product.kind !== "product" || product.store.status !== "approved") {
    throw new OrderError("This product can't be ordered on repeat.");
  }

  const [plan] = await db
    .insert(recurringPlans)
    .values({
      number: referenceNumber("RP"),
      customerId: input.customerId,
      storeId: product.storeId,
      productId: product.id,
      title: product.title,
      quantity: input.quantity,
      frequency: input.frequency,
      startOn: input.startOn,
      endOn: input.endOn,
      nextRunOn: nextOccurrence(input.frequency, input.startOn, input.startOn),
      paymentTiming: input.paymentTiming,
      currency: product.store.currency,
      shippingAddress: input.shippingAddress,
      notes: input.notes || null,
      deliveryPrefs: input.deliveryPrefs ?? null,
    })
    .returning();
  return plan;
}

/** The next delivery day after `day`, or null once the plan's end date is passed. */
function advance(plan: { frequency: PlanFrequency; startOn: DateStr; endOn: DateStr | null }, day: DateStr) {
  const next = nextOccurrence(plan.frequency, addDays(day, 1), plan.startOn);
  return plan.endOn && next > plan.endOn ? null : next;
}

/**
 * Creates today's order for every active plan that's due (run daily by the scheduled job).
 * Each plan is locked while it runs, so two runs at once can't create the same delivery twice.
 * Missed days (e.g. the job didn't run) are skipped rather than delivered late.
 */
export async function runDuePlans(day: DateStr = today()) {
  const due = await db
    .select({ id: recurringPlans.id })
    .from(recurringPlans)
    .where(and(eq(recurringPlans.status, "active"), isNotNull(recurringPlans.nextRunOn), lte(recurringPlans.nextRunOn, day)))
    .limit(500);

  const result = { created: 0, skipped: 0 };
  for (const { id } of due) {
    let createdOrderId: string | null = null;
    await db.transaction(async (tx) => {
      const [plan] = await tx.select().from(recurringPlans).where(eq(recurringPlans.id, id)).for("update", { skipLocked: true });
      if (!plan || plan.status !== "active" || !plan.nextRunOn || plan.nextRunOn > day) return;

      // Only deliver on a day the plan is actually scheduled for.
      const runsToday = nextOccurrence(plan.frequency, day, plan.startOn) === day && (!plan.endOn || day <= plan.endOn);
      let lastError: string | null = null;
      let creditCents = plan.creditCents;

      const [store] = await tx.select({ status: stores.status }).from(stores).where(eq(stores.id, plan.storeId));
      if (!runsToday) {
        lastError = null;
      } else if (!plan.productId || store?.status !== "approved") {
        lastError = "The product or store is no longer available.";
      } else {
        try {
          const [product] = await tx.select({ priceCents: products.priceCents }).from(products).where(eq(products.id, plan.productId));
          const total = (product?.priceCents ?? 0) * plan.quantity;
          // Prepaid plans pay each delivery from their credit when there's enough.
          const fromCredit = plan.paymentTiming === "prepaid" && total > 0 && creditCents >= total;
          const { order } = await createOrderTx(tx, {
            customerId: plan.customerId,
            productId: plan.productId,
            quantity: plan.quantity,
            shippingAddress: plan.shippingAddress,
            notes: plan.notes ?? undefined,
            paymentTiming: plan.paymentTiming,
            bookingDate: day,
            planId: plan.id,
            paidFromCredit: fromCredit ? `Prepaid credit (${plan.number})` : undefined,
            createDelivery: plan.deliveryPrefs
              ? (t, orderId) => createDeliveryTx(t, orderId, deliveryFromPrefs(plan.deliveryPrefs!, plan.shippingAddress))
              : undefined,
          });
          createdOrderId = order.id;
          if (fromCredit) creditCents -= total;
          else if (plan.paymentTiming === "prepaid") lastError = "Not enough prepaid credit: today's delivery is waiting for payment.";
          result.created++;
        } catch (e) {
          if (!(e instanceof OrderError)) throw e;
          lastError = `Skipped ${day}: ${e.message}`;
          result.skipped++;
        }
      }

      const nextRunOn = advance(plan, day);
      await tx
        .update(recurringPlans)
        .set({
          nextRunOn,
          status: nextRunOn ? plan.status : "ended",
          creditCents,
          lastRunAt: new Date(),
          lastError,
          updatedAt: new Date(),
        })
        .where(eq(recurringPlans.id, plan.id));
    });
    if (createdOrderId) await notifyInvitedCouriers(createdOrderId); // a usual courier asked directly
  }
  return result;
}

/** Customer pauses, resumes or cancels their plan. */
export async function setPlanStatus(customerId: string, planId: string, action: "pause" | "resume" | "cancel") {
  const plan = await db.query.recurringPlans.findFirst({
    where: and(eq(recurringPlans.id, planId), eq(recurringPlans.customerId, customerId)),
  });
  if (!plan || plan.status === "cancelled" || plan.status === "ended") throw new OrderError("This plan can't be changed.");
  if (action === "resume") {
    // Pick up from the next scheduled day after today.
    const next = nextOccurrence(plan.frequency, addDays(today(), 1), plan.startOn);
    const nextRunOn = plan.endOn && next > plan.endOn ? null : next;
    await db
      .update(recurringPlans)
      .set({ status: nextRunOn ? "active" : "ended", nextRunOn, updatedAt: new Date() })
      .where(eq(recurringPlans.id, plan.id));
  } else {
    await db
      .update(recurringPlans)
      .set({ status: action === "pause" ? "paused" : "cancelled", updatedAt: new Date() })
      .where(eq(recurringPlans.id, plan.id));
  }
}

/** Customer reports money paid in advance; it becomes credit once the merchant confirms it. */
export async function submitPrepayment(input: { customerId: string; planId: string; amountCents: number; reference: string; proofUrl: string | null }) {
  const plan = await db.query.recurringPlans.findFirst({
    where: and(eq(recurringPlans.id, input.planId), eq(recurringPlans.customerId, input.customerId)),
  });
  if (!plan || plan.status === "cancelled" || plan.status === "ended") throw new OrderError("This plan is no longer running.");
  if (!input.amountCents || input.amountCents <= 0) throw new OrderError("Enter the amount you paid.");
  if (!input.reference && !input.proofUrl) throw new OrderError("Enter the payment reference or attach proof of payment.");
  await db.insert(planPrepayments).values({
    planId: plan.id,
    amountCents: input.amountCents,
    reference: input.reference.slice(0, 120) || null,
    proofUrl: input.proofUrl,
  });
}

/** Merchant confirms (adds to credit) or rejects a reported prepayment. */
export async function reviewPrepayment(storeId: string, prepaymentId: string, approve: boolean) {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: planPrepayments.id, planId: planPrepayments.planId, amountCents: planPrepayments.amountCents })
      .from(planPrepayments)
      .innerJoin(recurringPlans, eq(recurringPlans.id, planPrepayments.planId))
      .where(and(eq(planPrepayments.id, prepaymentId), eq(recurringPlans.storeId, storeId), eq(planPrepayments.status, "submitted")))
      .for("update");
    if (!row) throw new OrderError("This payment was already reviewed.");
    await tx
      .update(planPrepayments)
      .set({ status: approve ? "confirmed" : "rejected", reviewedAt: new Date() })
      .where(eq(planPrepayments.id, row.id));
    if (approve) {
      await tx
        .update(recurringPlans)
        .set({ creditCents: sql`${recurringPlans.creditCents} + ${row.amountCents}`, updatedAt: new Date() })
        .where(eq(recurringPlans.id, row.planId));
    }
  });
}

import type { DeliveryMethod, HandoverType, SecondCheck } from "~/db/schema";

/** Delivery labels, shared by the server and the order/courier pages. */

export const HANDOVER_TYPES: HandoverType[] = ["door", "gate", "reception", "in_person", "delegate"];

export const HANDOVER_LABEL: Record<HandoverType, string> = {
  door: "Leave at the door",
  gate: "Leave at the gate",
  reception: "Leave at reception",
  in_person: "Hand to me in person",
  delegate: "Hand to someone else (delegate)",
};

export const METHOD_LABEL: Record<DeliveryMethod, string> = {
  merchant: "Delivered by the store",
  merchant_courier: "Store's courier (paid by the store)",
  courier: "Courier chosen by the customer",
  collection: "Collection from the store",
};

export const SECOND_CHECK_LABEL: Record<SecondCheck, string> = {
  none: "No extra check",
  phone: "Store must call me before handing over",
  app: "I approve the pickup in the app / by email",
};

export const MAX_QUOTE_INVITES = 5;

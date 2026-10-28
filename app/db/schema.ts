import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  primaryKey,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// All money is stored as integer minor units (cents/tambala) to avoid floating point errors.

export const userRole = pgEnum("user_role", ["customer", "merchant", "courier", "admin"]);
export const userStatus = pgEnum("user_status", ["active", "suspended"]);

export const orderStatus = pgEnum("order_status", [
  "pending", // placed by customer, awaiting merchant
  "confirmed", // merchant accepted
  "processing", // being packed / made
  "shipped", // handed to courier
  "out_for_delivery",
  "delivered",
  "cancelled",
]);

export const deliveryStatus = pgEnum("delivery_status", [
  "awaiting_dispatch",
  "in_transit",
  "delivered",
  "failed",
  "returned",
]);

export const billStatus = pgEnum("bill_status", [
  "unpaid",
  "paid", // bill honored
  "overdue",
  "defaulted", // bill not honored
  "void",
]);

export const storeStatus = pgEnum("store_status", [
  "pending", // signed up, waiting for an admin to approve
  "approved", // can sell; products are listed
  "rejected", // application declined
  "suspended", // switched off by an admin
  "archived", // inactive for too long; restored when the merchant signs in again
]);

/** Physical goods are ordered; services (DJs, decor, cakes...) are booked for a date. */
export const productKind = pgEnum("product_kind", ["product", "service", "digital", "property"]);

/** Digital products: what kind of file is sold. */
export const mediaType = pgEnum("media_type", ["video", "audio", "document"]);
/** How a digital product is sold: owned as a download, or watched/listened to online. */
export const offerMode = pgEnum("offer_mode", ["download", "stream"]);

/** Who delivers a store's orders. */
export const storeDeliveryMode = pgEnum("store_delivery_mode", [
  "merchant", // the store delivers itself
  "merchant_courier", // the store's chosen courier delivers; the store pays
  "customer", // the customer collects or arranges (and pays) a courier
]);
/** How one order gets to the customer. */
export const deliveryMethod = pgEnum("delivery_method", ["merchant", "merchant_courier", "courier", "collection"]);
/** Where/how the parcel is handed over at the destination. */
export const handoverType = pgEnum("handover_type", ["door", "gate", "reception", "in_person", "delegate"]);
/** How the person collecting proves they're the right one. */
export const verifyMethod = pgEnum("verify_method", ["code", "phrase"]);
/** Optional extra check with the customer before the item is released. */
export const secondCheck = pgEnum("second_check", ["none", "phone", "app"]);
export const quoteStatus = pgEnum("quote_status", ["invited", "quoted", "declined", "accepted", "closed"]);
export const reviewStatus = pgEnum("review_status", ["pending", "approved", "rejected", "suspended"]);
export const licenseKind = pgEnum("license_kind", ["primary", "other"]);
export const licenseStatus = pgEnum("license_status", ["pending", "verified", "rejected"]);
/** Store deals: automatic sales (timed, store-wide or per item) and promo codes entered at checkout. */
export const dealKind = pgEnum("deal_kind", ["sale", "code"]);
export const reviewTarget = pgEnum("review_target", ["product", "store", "courier"]);
/** visible: shown; flagged: the merchant/courier asked an admin to check it (still shown); hidden: taken down. */
export const reviewVisibility = pgEnum("review_visibility", ["visible", "flagged", "hidden"]);
/** Banner ad campaigns (distinct from product boosts in "promotions"). */
export const adCampaignStatus = pgEnum("ad_campaign_status", ["requested", "awaiting_payment", "payment_submitted", "approved", "rejected", "cancelled"]);
export const passStatus = pgEnum("pass_status", ["requested", "payment_submitted", "approved", "rejected"]);
export const couponStatus = pgEnum("coupon_status", ["pending", "active", "used", "expired", "void"]);

/** When the customer pays: after delivery (billed with terms) or up front. */
export const paymentTiming = pgEnum("payment_timing", ["on_delivery", "prepaid"]);

export const planFrequency = pgEnum("plan_frequency", ["daily", "weekdays", "weekly"]);
export const planStatus = pgEnum("plan_status", ["active", "paused", "cancelled", "ended"]);
export const prepaymentStatus = pgEnum("prepayment_status", ["submitted", "confirmed", "rejected"]);

export const alertType = pgEnum("alert_type", ["new_product", "restock", "discount"]);
export const deliveryState = pgEnum("alert_delivery_status", ["pending", "sending", "sent", "skipped", "failed"]);

export const promotionTier = pgEnum("promotion_tier", ["boost", "featured", "premium"]);

/** An advert is only shown once an admin has approved it (after payment). */
export const promotionStatus = pgEnum("promotion_status", [
  "pending_quote", // custom request: admin needs to set placement and price
  "awaiting_payment", // billed: merchant needs to pay
  "payment_submitted", // merchant sent a payment reference/proof
  "approved", // admin authorised: runs from startsAt to endsAt
  "rejected",
  "cancelled", // withdrawn by the merchant before approval
]);

export const requestStatus = pgEnum("request_status", ["open", "fulfilled", "closed"]);

export const reportTarget = pgEnum("report_target", ["product", "message", "request", "store"]);
export const reportStatus = pgEnum("report_status", ["open", "actioned", "dismissed"]);

/** Money in minor units. bigint because kwacha amounts outgrow a 32-bit integer (max ~MK 21m). */
const money = (name: string) => bigint(name, { mode: "number" });

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/* ----------------------------------------------------------------- users */

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  phone: text("phone"),
  role: userRole("role").notNull().default("customer"),
  status: userStatus("status").notNull().default("active"),
  emailAlerts: boolean("email_alerts").notNull().default(true), // master switch for stock/discount alert emails
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }).notNull().defaultNow(), // for inactivity archiving
  termsVersion: text("terms_version"), // version of the terms of use the user accepted
  termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
  passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }), // sessions from before this are signed out
  adFreeUntil: timestamp("ad_free_until", { withTimezone: true }), // paid to hide side/inline banner ads
  ...timestamps,
});

export const stores = pgTable("stores", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  logoUrl: text("logo_url"),
  currency: text("currency").notNull().default("MWK"), // ISO 4217; all of the store's prices are in this currency
  status: storeStatus("status").notNull().default("pending"),
  alertsBlocked: boolean("alerts_blocked").notNull().default(false), // admin can stop a store sending alerts
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  registrationNumber: text("registration_number"), // business registration number
  deliveryMode: storeDeliveryMode("delivery_mode").notNull().default("merchant"),
  preferredCourierId: uuid("preferred_courier_id").references((): AnyPgColumn => couriers.id, { onDelete: "set null" }),
  pickupAddress: text("pickup_address"), // where couriers and collectors pick up orders
  // Gift coupons customers can buy from this store and give to anyone
  couponsEnabled: boolean("coupons_enabled").notNull().default(false),
  couponMinCents: money("coupon_min_cents"),
  couponMaxCents: money("coupon_max_cents"),
  couponValidityDays: integer("coupon_validity_days").notNull().default(365),
  deletionWarnedAt: timestamp("deletion_warned_at", { withTimezone: true }), // owner emailed before automatic deletion
  // Listing plan: how many items the store may list (null = the admin's default band)
  listingBandId: uuid("listing_band_id").references((): AnyPgColumn => listingBands.id, { onDelete: "set null" }),
  bandPaidUntil: timestamp("band_paid_until", { withTimezone: true }), // paid bands fall back to the default after this
  reviewNote: text("review_note"), // admin's reason when rejecting/suspending
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  // Handymen: a tradesperson's store is their profile (registration number optional, ID required)
  isTradesperson: boolean("is_tradesperson").notNull().default(false),
  trades: text("trades").array().notNull().default(sql`'{}'::text[]`), // trade category slugs; matching jobs are sent to them
  serviceArea: text("service_area"), // towns/districts they work in
  workReferences: text("work_references"), // past clients and jobs, shown on the profile
  ...timestamps,
});

/* -------------------------------------------------------------- catalogue */

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  icon: text("icon"), // lucide icon name
  // Plain text (not the product_kind enum) so migrations can add categories for new kinds.
  kind: text("kind").$type<ProductKind>().notNull().default("product"),
  group: text("category_group"), // categories with their own main menu tab, e.g. "handyman" trades
});

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    priceCents: money("price_cents").notNull(),
    compareAtCents: money("compare_at_cents"), // "was" price for deals
    quantity: integer("quantity").notNull().default(0),
    // false = continuous supply: always in stock, quantity is ignored and never decremented
    trackStock: boolean("track_stock").notNull().default(true),
    kind: productKind("kind").notNull().default("product"),
    dailyCapacity: integer("daily_capacity"), // services: confirmed bookings allowed per day
    references: text("references"), // services: past clients, events, testimonials
    mediaType: mediaType("media_type"), // digital products
    mediaKey: text("media_key"), // digital: the full file, in private storage (never sent to browsers)
    mediaName: text("media_name"),
    previewUrl: text("preview_url"), // digital: a public sample (trailer, first pages, clip)
    imageUrl: text("image_url"),
    imageHidden: boolean("image_hidden").notNull().default(false), // moderation
    isActive: boolean("is_active").notNull().default(true),
    // Products: hide the listing automatically once it sells out (then delete it after the admin's retention period)
    archiveWhenSoldOut: boolean("archive_when_sold_out").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }), // hidden from shoppers; deleted after the retention period
    // Real estate (kind = "property")
    listingType: text("listing_type").$type<ListingType>(), // land | house | rental
    priceType: text("price_type").$type<PriceType>(), // negotiable | fixed | reserve
    reservePriceCents: money("reserve_price_cents"), // reserve listings: lowest price accepted (never shown to buyers)
    biddingEndsAt: timestamp("bidding_ends_at", { withTimezone: true }), // reserve listings: when offers close
    biddingNoticeAt: timestamp("bidding_notice_at", { withTimezone: true }), // merchant told that bidding closed
    titleDeed: boolean("title_deed"), // land and houses for sale: is a title deed available?
    propertyFeatures: jsonb("property_features").$type<PropertyFeatures>(),
    autoDetails: jsonb("auto_details").$type<AutoDetails>(), // Auto category: vehicle spec sheet or spare-part details
    soldAt: timestamp("sold_at", { withTimezone: true }), // property sold or let to the accepted offer
    ...timestamps,
  },
  (t) => [
    index("products_store_idx").on(t.storeId),
    index("products_category_idx").on(t.categoryId),
    index("products_kind_idx").on(t.kind, t.isActive),
  ],
);

/** Extra photos: a product gallery, or a service provider's portfolio of past work. */
export const productImages = pgTable(
  "product_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    section: text("section"), // houses: "interior" | "exterior"
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("product_images_product_idx").on(t.productId, t.position)],
);

/** Paid ads / extras. Active promotions raise a product's weight in the randomised feed. */
export const promotions = pgTable(
  "promotions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    number: text("number").notNull().unique(), // e.g. AD-7K2Q9A, used as the payment reference
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    tier: promotionTier("tier"), // null until an admin quotes a custom request
    isCustom: boolean("is_custom").notNull().default(false),
    days: integer("days").notNull(),
    status: promotionStatus("status").notNull().default("awaiting_payment"),
    requestNote: text("request_note"), // what the merchant asked for (custom adverts)
    adminNote: text("admin_note"), // shown to the merchant
    amountCents: money("amount_paid_cents"), // amount billed (MWK); null until quoted
    paymentReference: text("payment_reference"),
    proofUrl: text("proof_url"),
    paymentSubmittedAt: timestamp("payment_submitted_at", { withTimezone: true }),
    reviewedById: uuid("reviewed_by_id").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    startsAt: timestamp("starts_at", { withTimezone: true }), // set on approval
    endsAt: timestamp("ends_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("promotions_product_idx").on(t.productId),
    index("promotions_window_idx").on(t.startsAt, t.endsAt),
    index("promotions_status_idx").on(t.status),
  ],
);

/** Advertised ad packages. Admins set the weekly price; the tier decides feed placement. */
export const adBands = pgTable("ad_bands", {
  tier: promotionTier("tier").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  weeklyCents: money("weekly_cents").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
});

/** A customer following a store for email alerts, with the alert types they chose. */
export const storeSubscriptions = pgTable(
  "store_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    newProducts: boolean("new_products").notNull().default(true),
    restocks: boolean("restocks").notNull().default(true),
    discounts: boolean("discounts").notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex("store_subscriptions_user_store_idx").on(t.userId, t.storeId), index("store_subscriptions_store_idx").on(t.storeId)],
);

/** An alert a merchant sent about one product. Emails go out from MyPlug, never from the merchant. */
export const stockAlerts = pgTable(
  "stock_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    type: alertType("type").notNull(),
    message: text("message"), // optional plain-text note from the merchant
    recipientCount: integer("recipient_count").notNull().default(0),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("stock_alerts_store_idx").on(t.storeId, t.createdAt)],
);

/** The products featured in an alert (one alert can show several). */
export const stockAlertItems = pgTable(
  "stock_alert_items",
  {
    alertId: uuid("alert_id")
      .notNull()
      .references(() => stockAlerts.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.alertId, t.productId] }), index("stock_alert_items_product_idx").on(t.productId)],
);

/** One email per recipient, so sending can resume and opt-outs are honoured until the last moment. */
export const alertDeliveries = pgTable(
  "alert_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    alertId: uuid("alert_id")
      .notNull()
      .references(() => stockAlerts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: deliveryState("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    claimedAt: timestamp("claimed_at", { withTimezone: true }), // when a sender picked it up (status "sending")
    error: text("error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("alert_deliveries_alert_user_idx").on(t.alertId, t.userId), index("alert_deliveries_status_idx").on(t.status)],
);

/** A registered courier. Must be approved by an admin (identity checked) before taking jobs. */
export const couriers = pgTable("couriers", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(), // person or courier company
  phone: text("phone").notNull(),
  vehicle: text("vehicle"),
  plateNumber: text("plate_number"),
  nationalIdNumber: text("national_id_number"),
  facePhotoKey: text("face_photo_key"), // private storage
  idDocumentKey: text("id_document_key"), // private storage
  bio: text("bio"),
  status: reviewStatus("status").notNull().default("pending"),
  reviewNote: text("review_note"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  ...timestamps,
});

/** A courier's estimated price for delivering to an area. */
export const courierRates = pgTable(
  "courier_rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    courierId: uuid("courier_id")
      .notNull()
      .references(() => couriers.id, { onDelete: "cascade" }),
    area: text("area").notNull(), // area or city name, matched case-insensitively
    estimateCents: money("estimate_cents").notNull(),
  },
  (t) => [uniqueIndex("courier_rates_courier_area_idx").on(t.courierId, t.area)],
);

/** Saved delivery addresses. */
export const addresses = pgTable(
  "addresses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text("label").notNull(), // "Home", "Office"...
    recipientName: text("recipient_name").notNull(),
    phone: text("phone").notNull(),
    line1: text("line1").notNull(), // street / plot / building
    area: text("area").notNull(),
    city: text("city").notNull(),
    landmark: text("landmark"),
    isDefault: boolean("is_default").notNull().default(false),
    ...timestamps,
  },
  (t) => [index("addresses_user_idx").on(t.userId)],
);

/** In-app notifications (also emailed for important events). */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body"),
    href: text("href"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.readAt, t.createdAt)],
);

/** Business registration certificate (primary) and other licences, vetted by an admin. */
export const businessLicenses = pgTable(
  "business_licenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    kind: licenseKind("kind").notNull().default("other"),
    name: text("name").notNull(), // e.g. "Certificate of Incorporation", "Food handling licence"
    number: text("number"),
    issuer: text("issuer"), // e.g. "Registrar General", "Lilongwe City Council"
    issuedOn: date("issued_on", { mode: "string" }),
    expiresOn: date("expires_on", { mode: "string" }), // the verified tag lapses after this date
    documentKey: text("document_key"), // private storage; shown to customers only if allowed
    status: licenseStatus("status").notNull().default("pending"),
    showToCustomers: boolean("show_to_customers").notNull().default(false),
    reviewNote: text("review_note"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("business_licenses_store_idx").on(t.storeId)],
);

/** Price options for a digital product, e.g. "Download" or "Watch online for 48 hours". */
export const digitalOffers = pgTable("digital_offers", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  mode: offerMode("mode").notNull(),
  priceCents: money("price_cents").notNull(),
  accessDays: integer("access_days"), // null = no time limit
  maxViews: integer("max_views"), // streaming: null = unlimited plays
  position: integer("position").notNull().default(0),
});

/** A customer's right to a digital product, created by an order and activated once paid. */
export const digitalGrants = pgTable(
  "digital_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .unique()
      .references(() => orders.id, { onDelete: "cascade" }),
    label: text("label").notNull(), // offer snapshot
    mode: offerMode("mode").notNull(),
    accessDays: integer("access_days"),
    maxViews: integer("max_views"),
    viewsUsed: integer("views_used").notNull().default(0),
    downloads: integer("downloads").notNull().default(0),
    activatedAt: timestamp("activated_at", { withTimezone: true }), // set when the order is paid
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("digital_grants_user_idx").on(t.userId)],
);

/** A customer's saved products and stores. */
export const favourites = pgTable(
  "favourites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "cascade" }),
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("favourites_user_product_idx").on(t.userId, t.productId),
    uniqueIndex("favourites_user_store_idx").on(t.userId, t.storeId),
  ],
);

/** Shopping cart lines (signed-in customers). */
export const cartItems = pgTable(
  "cart_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull().default(1),
    ...timestamps,
  },
  (t) => [uniqueIndex("cart_items_user_product_idx").on(t.userId, t.productId)],
);

/**
 * A store deal. "sale": a percentage off applied automatically (all items, or chosen ones),
 * optionally between two dates: timed deals, end-of-month promotions, general or per-item
 * discounts. "code": a promo code customers enter at checkout.
 */
export const deals = pgTable(
  "deals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    kind: dealKind("kind").notNull(),
    name: text("name").notNull(),
    code: text("code"), // promo codes: upper-case, unique per store
    percentOff: integer("percent_off"), // 1-90
    amountOffCents: money("amount_off_cents"), // promo codes only: fixed amount off
    allProducts: boolean("all_products").notNull().default(true),
    minSpendCents: money("min_spend_cents"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    maxUses: integer("max_uses"), // promo codes: in total
    perCustomerLimit: integer("per_customer_limit"), // promo codes: per customer
    usesCount: integer("uses_count").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [index("deals_store_idx").on(t.storeId, t.kind), uniqueIndex("deals_store_code_idx").on(t.storeId, t.code)],
);

/** Products a deal applies to (when not all products). */
export const dealProducts = pgTable(
  "deal_products",
  {
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.dealId, t.productId] }), index("deal_products_product_idx").on(t.productId)],
);

/** A gift coupon bought from a store; whoever holds the code can spend it there, online or in person. */
export const coupons = pgTable(
  "coupons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(), // e.g. GIFT-7K2Q-9A4M-XW3D
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    purchaserId: uuid("purchaser_id").references(() => users.id, { onDelete: "set null" }),
    orderId: uuid("order_id").references((): AnyPgColumn => orders.id, { onDelete: "set null" }), // the purchase
    initialCents: money("initial_cents").notNull(),
    balanceCents: money("balance_cents").notNull(),
    currency: text("currency").notNull().default("MWK"),
    recipientName: text("recipient_name"),
    message: text("message"),
    status: couponStatus("status").notNull().default("pending"), // active once the purchase is paid
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("coupons_store_idx").on(t.storeId), index("coupons_purchaser_idx").on(t.purchaserId)],
);

/** Every use of a coupon: at online checkout or at the shop counter. */
export const couponRedemptions = pgTable("coupon_redemptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  couponId: uuid("coupon_id")
    .notNull()
    .references(() => coupons.id, { onDelete: "cascade" }),
  orderId: uuid("order_id").references((): AnyPgColumn => orders.id, { onDelete: "set null" }),
  amountCents: money("amount_cents").notNull(),
  channel: text("channel").notNull(), // "online" | "in_store"
  staffId: uuid("staff_id").references(() => users.id, { onDelete: "set null" }), // merchant who redeemed it in store
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One-time password reset links. Only a hash of the token is stored. */
export const passwordResets = pgTable(
  "password_resets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("password_resets_user_idx").on(t.userId, t.createdAt)],
);

/**
 * A customer's rating (1-5) and comment on a product, store or courier from one of their orders.
 * targetKey ("product:<id>", "store:<id>", "courier:<id>") makes it one review per thing per order.
 */
export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    target: reviewTarget("target").notNull(),
    targetKey: text("target_key").notNull(),
    productId: uuid("product_id").references(() => products.id, { onDelete: "cascade" }),
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "cascade" }),
    courierId: uuid("courier_id").references((): AnyPgColumn => couriers.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    rating: integer("rating").notNull(),
    comment: text("comment"), // obscene words are masked before saving
    status: reviewVisibility("status").notNull().default("visible"),
    flagReason: text("flag_reason"), // why the merchant/courier asked for it to be checked
    flaggedById: uuid("flagged_by_id").references(() => users.id, { onDelete: "set null" }),
    flaggedAt: timestamp("flagged_at", { withTimezone: true }),
    reply: text("reply"), // the merchant's public reply
    adminNote: text("admin_note"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("reviews_order_target_idx").on(t.orderId, t.targetKey),
    index("reviews_product_idx").on(t.productId, t.status),
    index("reviews_store_idx").on(t.storeId, t.status),
    index("reviews_courier_idx").on(t.courierId, t.status),
    index("reviews_status_idx").on(t.status),
  ],
);

/**
 * Community votes on a tradesperson: anyone signed in (not just past customers) can vote up or
 * down once, with an optional comment. Comments are moderated like reviews.
 */
export const storeVotes = pgTable(
  "store_votes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    value: integer("value").notNull(), // +1 or -1
    comment: text("comment"), // obscene words are masked before saving
    status: reviewVisibility("status").notNull().default("visible"),
    flagReason: text("flag_reason"), // why the tradesperson asked for it to be checked
    flaggedAt: timestamp("flagged_at", { withTimezone: true }),
    reply: text("reply"), // the tradesperson's public reply
    adminNote: text("admin_note"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("store_votes_store_user_idx").on(t.storeId, t.userId), index("store_votes_status_idx").on(t.status)],
);

/** Where banner ads can appear, with the creative specs and weekly price (admin-editable). */
export const adPlacements = pgTable("ad_placements", {
  key: text("key").primaryKey(), // hero, home_banner, sidebar, category_top
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  width: integer("width").notNull(), // recommended creative size, px
  height: integer("height").notNull(),
  maxKb: integer("max_kb").notNull(),
  formats: text("formats").notNull().default("jpg,png,webp"),
  weeklyCents: money("weekly_cents").notNull(),
  maxActive: integer("max_active").notNull().default(3), // ads rotating in this spot at once
  hideableWithPass: boolean("hideable_with_pass").notNull().default(true), // hidden for ad-free pass holders
  isActive: boolean("is_active").notNull().default(true),
  position: integer("position").notNull().default(0),
});

/** A banner ad booking, from a registered member or an outside advertiser the admin enters. */
export const adCampaigns = pgTable(
  "ad_campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    number: text("number").notNull().unique(), // BA-XXXXXX, the payment reference
    placementKey: text("placement_key")
      .notNull()
      .references(() => adPlacements.key),
    advertiserId: uuid("advertiser_id").references(() => users.id, { onDelete: "set null" }), // registered member
    advertiserName: text("advertiser_name").notNull(),
    advertiserEmail: text("advertiser_email").notNull(),
    advertiserPhone: text("advertiser_phone"),
    company: text("company"),
    title: text("title").notNull(), // internal name
    headline: text("headline"), // short text shown with the image (alt text too)
    linkUrl: text("link_url"), // where a click goes: a MyPlug page or an external https site
    creativeUrl: text("creative_url"),
    creativeWidth: integer("creative_width"),
    creativeHeight: integer("creative_height"),
    weeks: integer("weeks").notNull(),
    requestedStart: date("requested_start", { mode: "string" }),
    notes: text("notes"), // what the advertiser asked for
    status: adCampaignStatus("status").notNull().default("requested"),
    amountCents: money("amount_cents"),
    paymentReference: text("payment_reference"),
    proofUrl: text("proof_url"),
    paymentSubmittedAt: timestamp("payment_submitted_at", { withTimezone: true }),
    adminNote: text("admin_note"),
    reviewedById: uuid("reviewed_by_id").references(() => users.id, { onDelete: "set null" }),
    startsAt: timestamp("starts_at", { withTimezone: true }), // set on approval
    endsAt: timestamp("ends_at", { withTimezone: true }),
    clicks: integer("clicks").notNull().default(0),
    ...timestamps,
  },
  (t) => [index("ad_campaigns_live_idx").on(t.placementKey, t.status, t.startsAt, t.endsAt), index("ad_campaigns_advertiser_idx").on(t.advertiserId)],
);

/** One-time upload link (plus passcode) sent to an outside advertiser to supply their creative. */
export const adUploadLinks = pgTable("ad_upload_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id")
    .notNull()
    .references(() => adCampaigns.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  passcodeHash: text("passcode_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A paid pass to hide side and in-page banner ads for a number of days. */
export const adFreePasses = pgTable("ad_free_passes", {
  id: uuid("id").primaryKey().defaultRandom(),
  number: text("number").notNull().unique(), // AF-XXXXXX
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  days: integer("days").notNull(),
  amountCents: money("amount_cents").notNull(),
  status: passStatus("status").notNull().default("requested"),
  paymentReference: text("payment_reference"),
  proofUrl: text("proof_url"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type { AutoDetails } from "../lib/auto";
import type { AutoDetails } from "../lib/auto";
export type ListingType = "land" | "house" | "rental";
export type PriceType = "negotiable" | "fixed" | "reserve";
export type PropertyFeatures = {
  location?: string;
  plotSize?: string; // e.g. "50 x 30 m" or "1 acre"
  bedrooms?: number;
  bathrooms?: number;
  backupPower?: boolean; // solar / inverter / generator
  waterTank?: boolean;
  masterEnsuite?: boolean;
  separateDining?: boolean; // dining room separate from the lounge
  parking?: boolean;
  furnished?: boolean;
  securityWall?: boolean; // wall/fence and gate
  borehole?: boolean;
  servantsQuarters?: boolean;
  other?: string;
};

/**
 * A customer's offer on a property (or bid, for reserve-price listings). One per customer per
 * listing; raising a bid updates it. The merchant accepts one, which marks the property sold.
 */
export const propertyOffers = pgTable(
  "property_offers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    amountCents: money("amount_cents").notNull(),
    message: text("message"),
    status: text("status").$type<"pending" | "accepted" | "declined" | "withdrawn" | "lost">().notNull().default("pending"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("property_offers_product_customer_idx").on(t.productId, t.customerId), index("property_offers_product_idx").on(t.productId, t.status)],
);

/** Store plans by number of listings, set by the admin (e.g. Starter 25 free, Growth 150 for a monthly fee). */
export const listingBands = pgTable("listing_bands", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  maxItems: integer("max_items"), // null = unlimited
  monthlyCents: money("monthly_cents").notNull().default(0),
  isDefault: boolean("is_default").notNull().default(false), // what every store gets without paying
  isActive: boolean("is_active").notNull().default(true),
  position: integer("position").notNull().default(0),
});

/** A merchant asking (and paying) for a bigger listing plan. */
export const bandRequests = pgTable(
  "band_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    number: text("number").notNull().unique(), // LP-XXXXXX, the payment reference
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    bandId: uuid("band_id")
      .notNull()
      .references(() => listingBands.id, { onDelete: "cascade" }),
    months: integer("months").notNull(),
    amountCents: money("amount_cents").notNull(),
    status: text("status").$type<"requested" | "payment_submitted" | "approved" | "rejected">().notNull().default("requested"),
    paymentReference: text("payment_reference"),
    proofUrl: text("proof_url"),
    adminNote: text("admin_note"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("band_requests_store_idx").on(t.storeId, t.status)],
);

/**
 * Site analytics, kept as small counters rather than one row per visit. `metric` is e.g.
 * "pageviews", "visitors", "store_views", "product_views", "ad_views", "ad_ms", "ad_clicks";
 * `subject` is the store, product or ad it's about ("" for site-wide totals).
 * Daily rows are rolled into analytics_monthly after the admin's retention period.
 */
export const analyticsDaily = pgTable(
  "analytics_daily",
  {
    day: date("day", { mode: "string" }).notNull(),
    metric: text("metric").notNull(),
    subject: text("subject").notNull().default(""),
    count: bigint("count", { mode: "number" }).notNull().default(0),
    ms: bigint("ms", { mode: "number" }).notNull().default(0), // time on screen (ads)
  },
  (t) => [primaryKey({ columns: [t.day, t.metric, t.subject] })],
);

export const analyticsMonthly = pgTable(
  "analytics_monthly",
  {
    month: date("month", { mode: "string" }).notNull(), // first day of the month
    metric: text("metric").notNull(),
    subject: text("subject").notNull().default(""),
    count: bigint("count", { mode: "number" }).notNull().default(0),
    ms: bigint("ms", { mode: "number" }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.month, t.metric, t.subject] })],
);

/** Anonymous visitor ids seen each day, only to count unique visitors (kept 2 days). */
export const analyticsVisitors = pgTable(
  "analytics_visitors",
  {
    day: date("day", { mode: "string" }).notNull(),
    visitorId: text("visitor_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.day, t.visitorId] })],
);

/** Which stores each visitor frequents, per month (signed-in visitors are linked to their account). */
export const visitorStoreMonthly = pgTable(
  "visitor_store_monthly",
  {
    month: date("month", { mode: "string" }).notNull(),
    visitorKey: text("visitor_key").notNull(), // "u:<userId>" or "a:<anonymous id>"
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    visits: integer("visits").notNull().default(0),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.month, t.visitorKey, t.storeId] }), index("visitor_store_monthly_store_idx").on(t.storeId, t.month)],
);

/** Small key/value store for admin-editable platform settings. */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ----------------------------------------------------------------- orders */

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    number: text("number").notNull().unique(), // human-friendly e.g. MP-7K2Q9
    customerId: uuid("customer_id")
      .notNull()
      .references(() => users.id),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id),
    status: orderStatus("status").notNull().default("pending"),
    totalCents: money("total_cents").notNull(), // after discounts
    subtotalCents: money("subtotal_cents"), // items at their (sale) prices, before promo codes
    discountCents: money("discount_cents").notNull().default(0), // promo code discount
    promoCode: text("promo_code"),
    couponCents: money("coupon_cents").notNull().default(0), // part of the total paid with a gift coupon
    currency: text("currency").notNull().default("MWK"), // snapshot of the store's currency when ordered
    paymentTiming: paymentTiming("payment_timing").notNull().default("on_delivery"),
    bookingDate: date("booking_date", { mode: "string" }), // services: the day booked
    planId: uuid("plan_id").references((): AnyPgColumn => recurringPlans.id, { onDelete: "set null" }), // recurring orders
    shippingAddress: text("shipping_address").notNull(),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [
    index("orders_customer_idx").on(t.customerId),
    index("orders_store_idx").on(t.storeId),
    index("orders_booking_idx").on(t.storeId, t.bookingDate),
    index("orders_plan_idx").on(t.planId),
  ],
);

export const orderItems = pgTable("order_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
  title: text("title").notNull(), // snapshot at time of order
  unitPriceCents: money("unit_price_cents").notNull(),
  quantity: integer("quantity").notNull(),
});

/** Order tracking timeline: one row per status change. */
export const orderEvents = pgTable(
  "order_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    status: orderStatus("status").notNull(),
    note: text("note"),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("order_events_order_idx").on(t.orderId)],
);

export const deliveries = pgTable("deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id")
    .notNull()
    .unique()
    .references(() => orders.id, { onDelete: "cascade" }),
  status: deliveryStatus("status").notNull().default("awaiting_dispatch"),
  courier: text("courier"),
  trackingNumber: text("tracking_number"),
  dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  receivedBy: text("received_by"),
  method: deliveryMethod("method").notNull().default("merchant"),
  recipientName: text("recipient_name"),
  recipientPhone: text("recipient_phone"),
  area: text("area"), // suburb/area, used to match couriers
  city: text("city"),
  handover: handoverType("handover").notNull().default("in_person"),
  delegateName: text("delegate_name"),
  delegatePhone: text("delegate_phone"),
  courierId: uuid("courier_id").references((): AnyPgColumn => couriers.id, { onDelete: "set null" }),
  feeCents: money("fee_cents"), // agreed delivery price
  feePaidBy: text("fee_paid_by"), // "merchant" | "customer"
  pickupAt: timestamp("pickup_at", { withTimezone: true }), // null = any time
  // Someone who isn't a registered courier collecting for the customer
  collectorName: text("collector_name"),
  collectorPhone: text("collector_phone"),
  collectorIdNumber: text("collector_id_number"),
  collectorPhotoKey: text("collector_photo_key"), // private storage
  verifyMethod: verifyMethod("verify_method").notNull().default("code"),
  handoverCode: text("handover_code"), // shown to the customer; the collector quotes it at pickup
  phraseHash: text("phrase_hash"), // customer's secret phrase, hashed
  verifyAttempts: integer("verify_attempts").notNull().default(0),
  secondCheck: secondCheck("second_check").notNull().default("none"),
  approvalRequestedAt: timestamp("approval_requested_at", { withTimezone: true }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvalDeniedAt: timestamp("approval_denied_at", { withTimezone: true }),
  codeVerifiedAt: timestamp("code_verified_at", { withTimezone: true }),
  pickedUpAt: timestamp("picked_up_at", { withTimezone: true }),
  pickupVerifiedById: uuid("pickup_verified_by_id").references(() => users.id, { onDelete: "set null" }),
  ...timestamps,
});

/** Audit trail of every step of a delivery: who did what, when. */
export const deliveryLogs = pgTable(
  "delivery_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deliveryId: uuid("delivery_id")
      .notNull()
      .references(() => deliveries.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    detail: text("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("delivery_logs_delivery_idx").on(t.deliveryId, t.createdAt)],
);

/** A courier asked to deliver an order: invited, then quotes; the customer accepts one. */
export const courierQuotes = pgTable(
  "courier_quotes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deliveryId: uuid("delivery_id")
      .notNull()
      .references(() => deliveries.id, { onDelete: "cascade" }),
    courierId: uuid("courier_id")
      .notNull()
      .references((): AnyPgColumn => couriers.id, { onDelete: "cascade" }),
    status: quoteStatus("status").notNull().default("invited"),
    direct: boolean("direct").notNull().default(false), // asked directly (no bidding), or the store's courier
    estimateCents: money("estimate_cents"), // from the courier's area price list, at invitation time
    quoteCents: money("quote_cents"), // the courier's confirmed price
    note: text("note"),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("courier_quotes_delivery_courier_idx").on(t.deliveryId, t.courierId), index("courier_quotes_courier_idx").on(t.courierId, t.status)],
);

/** A bill raised against an order; tracks whether the customer honoured it. */
export const bills = pgTable("bills", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id")
    .notNull()
    .unique()
    .references(() => orders.id, { onDelete: "cascade" }),
  amountCents: money("amount_cents").notNull(),
  status: billStatus("status").notNull().default("unpaid"),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  paymentReference: text("payment_reference"),
  // Customer-reported payment (e.g. a prepayment), checked by the merchant before marking paid
  submittedReference: text("submitted_reference"),
  proofUrl: text("proof_url"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  ...timestamps,
});

/** Delivery choices a repeat order applies to each delivery it creates. */
export type PlanDeliveryPrefs = {
  method: "merchant" | "merchant_courier" | "courier" | "collection";
  courierId?: string | null; // customer's usual courier (asked directly each day)
  handover: "door" | "gate" | "reception" | "in_person" | "delegate";
  delegateName?: string | null;
  delegatePhone?: string | null;
  recipientName: string;
  recipientPhone: string;
  area: string;
  city: string;
};

/** A repeating order, e.g. bread every weekday. Each delivery becomes its own order and bill. */
export const recurringPlans = pgTable(
  "recurring_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    number: text("number").notNull().unique(), // e.g. RP-7K2Q9A
    customerId: uuid("customer_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    title: text("title").notNull(), // product title snapshot
    quantity: integer("quantity").notNull(),
    frequency: planFrequency("frequency").notNull(),
    startOn: date("start_on", { mode: "string" }).notNull(),
    endOn: date("end_on", { mode: "string" }),
    nextRunOn: date("next_run_on", { mode: "string" }),
    status: planStatus("status").notNull().default("active"),
    paymentTiming: paymentTiming("payment_timing").notNull().default("on_delivery"),
    creditCents: money("credit_cents").notNull().default(0), // confirmed prepayments not yet used
    currency: text("currency").notNull().default("MWK"),
    shippingAddress: text("shipping_address").notNull(),
    notes: text("notes"),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    lastError: text("last_error"), // e.g. skipped a day because the item was out of stock
    deliveryPrefs: jsonb("delivery_prefs").$type<PlanDeliveryPrefs>(), // copied onto each delivery
    ...timestamps,
  },
  (t) => [index("recurring_plans_due_idx").on(t.status, t.nextRunOn), index("recurring_plans_store_idx").on(t.storeId)],
);

/** Money a customer paid in advance into a recurring plan's credit. */
export const planPrepayments = pgTable("plan_prepayments", {
  id: uuid("id").primaryKey().defaultRandom(),
  planId: uuid("plan_id")
    .notNull()
    .references(() => recurringPlans.id, { onDelete: "cascade" }),
  amountCents: money("amount_cents").notNull(),
  reference: text("reference"),
  proofUrl: text("proof_url"),
  status: prepaymentStatus("status").notNull().default("submitted"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* -------------------------------------------- customer requests & messaging */

/** A customer posts an image ("can anyone make/source this?") that merchants can respond to. */
export const requests = pgTable("requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull(),
  imageUrl: text("image_url"),
  imageHidden: boolean("image_hidden").notNull().default(false),
  budgetCents: money("budget_cents"),
  categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }), // jobs: the trade needed
  location: text("location"), // jobs: where the work is
  status: requestStatus("status").notNull().default("open"),
  ...timestamps,
});

/** A private thread between one customer and one store, optionally about a product or request. */
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    requestId: uuid("request_id").references(() => requests.id, { onDelete: "set null" }),
    subject: text("subject").notNull(),
    isSpecialOrder: boolean("is_special_order").notNull().default(false),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    customerReadAt: timestamp("customer_read_at", { withTimezone: true }),
    merchantReadAt: timestamp("merchant_read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("conversations_customer_idx").on(t.customerId),
    index("conversations_store_idx").on(t.storeId),
    // One thread per store per request
    uniqueIndex("conversations_request_store_uq")
      .on(t.requestId, t.storeId)
      .where(sql`${t.requestId} is not null`),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull().default(""),
    imageUrl: text("image_url"),
    imageHidden: boolean("image_hidden").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId, t.createdAt)],
);

/* -------------------------------------------------------------- moderation */

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reporterId: uuid("reporter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetType: reportTarget("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    reason: text("reason").notNull(),
    details: text("details"),
    status: reportStatus("status").notNull().default("open"),
    reviewedById: uuid("reviewed_by_id").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    resolutionNote: text("resolution_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("reports_target_idx").on(t.targetType, t.targetId),
    // A user can only report the same thing once
    uniqueIndex("reports_reporter_target_uq").on(t.reporterId, t.targetType, t.targetId),
  ],
);

/* --------------------------------------------------------------- relations */

export const usersRelations = relations(users, ({ one, many }) => ({
  store: one(stores, { fields: [users.id], references: [stores.ownerId] }),
  courier: one(couriers, { fields: [users.id], references: [couriers.userId] }),
  orders: many(orders),
}));

export const storesRelations = relations(stores, ({ one, many }) => ({
  owner: one(users, { fields: [stores.ownerId], references: [users.id] }),
  products: many(products),
  subscriptions: many(storeSubscriptions),
  licenses: many(businessLicenses),
  preferredCourier: one(couriers, { fields: [stores.preferredCourierId], references: [couriers.id] }),
  listingBand: one(listingBands, { fields: [stores.listingBandId], references: [listingBands.id] }),
  votes: many(storeVotes),
}));

export const storeVotesRelations = relations(storeVotes, ({ one }) => ({
  store: one(stores, { fields: [storeVotes.storeId], references: [stores.id] }),
  user: one(users, { fields: [storeVotes.userId], references: [users.id] }),
}));

export const storeSubscriptionsRelations = relations(storeSubscriptions, ({ one }) => ({
  user: one(users, { fields: [storeSubscriptions.userId], references: [users.id] }),
  store: one(stores, { fields: [storeSubscriptions.storeId], references: [stores.id] }),
}));

export const stockAlertsRelations = relations(stockAlerts, ({ one, many }) => ({
  store: one(stores, { fields: [stockAlerts.storeId], references: [stores.id] }),
  items: many(stockAlertItems),
  deliveries: many(alertDeliveries),
}));

export const stockAlertItemsRelations = relations(stockAlertItems, ({ one }) => ({
  alert: one(stockAlerts, { fields: [stockAlertItems.alertId], references: [stockAlerts.id] }),
  product: one(products, { fields: [stockAlertItems.productId], references: [products.id] }),
}));

export const couriersRelations = relations(couriers, ({ one, many }) => ({
  user: one(users, { fields: [couriers.userId], references: [users.id] }),
  rates: many(courierRates),
}));

export const courierRatesRelations = relations(courierRates, ({ one }) => ({
  courier: one(couriers, { fields: [courierRates.courierId], references: [couriers.id] }),
}));

export const courierQuotesRelations = relations(courierQuotes, ({ one }) => ({
  delivery: one(deliveries, { fields: [courierQuotes.deliveryId], references: [deliveries.id] }),
  courier: one(couriers, { fields: [courierQuotes.courierId], references: [couriers.id] }),
}));

export const deliveryLogsRelations = relations(deliveryLogs, ({ one }) => ({
  delivery: one(deliveries, { fields: [deliveryLogs.deliveryId], references: [deliveries.id] }),
  actor: one(users, { fields: [deliveryLogs.actorId], references: [users.id] }),
}));

export const businessLicensesRelations = relations(businessLicenses, ({ one }) => ({
  store: one(stores, { fields: [businessLicenses.storeId], references: [stores.id] }),
}));

export const digitalOffersRelations = relations(digitalOffers, ({ one }) => ({
  product: one(products, { fields: [digitalOffers.productId], references: [products.id] }),
}));

export const digitalGrantsRelations = relations(digitalGrants, ({ one }) => ({
  product: one(products, { fields: [digitalGrants.productId], references: [products.id] }),
  order: one(orders, { fields: [digitalGrants.orderId], references: [orders.id] }),
}));

export const favouritesRelations = relations(favourites, ({ one }) => ({
  product: one(products, { fields: [favourites.productId], references: [products.id] }),
  store: one(stores, { fields: [favourites.storeId], references: [stores.id] }),
}));

export const cartItemsRelations = relations(cartItems, ({ one }) => ({
  product: one(products, { fields: [cartItems.productId], references: [products.id] }),
}));

export const dealsRelations = relations(deals, ({ one, many }) => ({
  store: one(stores, { fields: [deals.storeId], references: [stores.id] }),
  products: many(dealProducts),
}));

export const dealProductsRelations = relations(dealProducts, ({ one }) => ({
  deal: one(deals, { fields: [dealProducts.dealId], references: [deals.id] }),
  product: one(products, { fields: [dealProducts.productId], references: [products.id] }),
}));

export const couponsRelations = relations(coupons, ({ one, many }) => ({
  store: one(stores, { fields: [coupons.storeId], references: [stores.id] }),
  order: one(orders, { fields: [coupons.orderId], references: [orders.id] }),
  redemptions: many(couponRedemptions),
}));

export const couponRedemptionsRelations = relations(couponRedemptions, ({ one }) => ({
  coupon: one(coupons, { fields: [couponRedemptions.couponId], references: [coupons.id] }),
  order: one(orders, { fields: [couponRedemptions.orderId], references: [orders.id] }),
}));

export const reviewsRelations = relations(reviews, ({ one }) => ({
  product: one(products, { fields: [reviews.productId], references: [products.id] }),
  store: one(stores, { fields: [reviews.storeId], references: [stores.id] }),
  courier: one(couriers, { fields: [reviews.courierId], references: [couriers.id] }),
  customer: one(users, { fields: [reviews.customerId], references: [users.id] }),
  order: one(orders, { fields: [reviews.orderId], references: [orders.id] }),
}));

export const adCampaignsRelations = relations(adCampaigns, ({ one, many }) => ({
  placement: one(adPlacements, { fields: [adCampaigns.placementKey], references: [adPlacements.key] }),
  advertiser: one(users, { fields: [adCampaigns.advertiserId], references: [users.id] }),
  uploadLinks: many(adUploadLinks),
}));

export const adUploadLinksRelations = relations(adUploadLinks, ({ one }) => ({
  campaign: one(adCampaigns, { fields: [adUploadLinks.campaignId], references: [adCampaigns.id] }),
}));

export const adFreePassesRelations = relations(adFreePasses, ({ one }) => ({
  user: one(users, { fields: [adFreePasses.userId], references: [users.id] }),
}));

export const propertyOffersRelations = relations(propertyOffers, ({ one }) => ({
  product: one(products, { fields: [propertyOffers.productId], references: [products.id] }),
  customer: one(users, { fields: [propertyOffers.customerId], references: [users.id] }),
}));

export const bandRequestsRelations = relations(bandRequests, ({ one }) => ({
  store: one(stores, { fields: [bandRequests.storeId], references: [stores.id] }),
  band: one(listingBands, { fields: [bandRequests.bandId], references: [listingBands.id] }),
}));

export const productImagesRelations = relations(productImages, ({ one }) => ({
  product: one(products, { fields: [productImages.productId], references: [products.id] }),
}));

export const recurringPlansRelations = relations(recurringPlans, ({ one, many }) => ({
  customer: one(users, { fields: [recurringPlans.customerId], references: [users.id] }),
  store: one(stores, { fields: [recurringPlans.storeId], references: [stores.id] }),
  product: one(products, { fields: [recurringPlans.productId], references: [products.id] }),
  orders: many(orders),
  prepayments: many(planPrepayments),
}));

export const planPrepaymentsRelations = relations(planPrepayments, ({ one }) => ({
  plan: one(recurringPlans, { fields: [planPrepayments.planId], references: [recurringPlans.id] }),
}));

export const alertDeliveriesRelations = relations(alertDeliveries, ({ one }) => ({
  alert: one(stockAlerts, { fields: [alertDeliveries.alertId], references: [stockAlerts.id] }),
  user: one(users, { fields: [alertDeliveries.userId], references: [users.id] }),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  store: one(stores, { fields: [products.storeId], references: [stores.id] }),
  category: one(categories, { fields: [products.categoryId], references: [categories.id] }),
  promotions: many(promotions),
  images: many(productImages),
  offers: many(digitalOffers),
  propertyOffers: many(propertyOffers),
}));

export const promotionsRelations = relations(promotions, ({ one }) => ({
  product: one(products, { fields: [promotions.productId], references: [products.id] }),
  reviewedBy: one(users, { fields: [promotions.reviewedById], references: [users.id] }),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  customer: one(users, { fields: [orders.customerId], references: [users.id] }),
  store: one(stores, { fields: [orders.storeId], references: [stores.id] }),
  items: many(orderItems),
  events: many(orderEvents),
  delivery: one(deliveries, { fields: [orders.id], references: [deliveries.orderId] }),
  bill: one(bills, { fields: [orders.id], references: [bills.orderId] }),
  plan: one(recurringPlans, { fields: [orders.planId], references: [recurringPlans.id] }),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  product: one(products, { fields: [orderItems.productId], references: [products.id] }),
}));

export const orderEventsRelations = relations(orderEvents, ({ one }) => ({
  order: one(orders, { fields: [orderEvents.orderId], references: [orders.id] }),
}));

export const deliveriesRelations = relations(deliveries, ({ one, many }) => ({
  order: one(orders, { fields: [deliveries.orderId], references: [orders.id] }),
  courier: one(couriers, { fields: [deliveries.courierId], references: [couriers.id] }),
  quotes: many(courierQuotes),
  logs: many(deliveryLogs),
}));

export const billsRelations = relations(bills, ({ one }) => ({
  order: one(orders, { fields: [bills.orderId], references: [orders.id] }),
}));

export const requestsRelations = relations(requests, ({ one, many }) => ({
  customer: one(users, { fields: [requests.customerId], references: [users.id] }),
  category: one(categories, { fields: [requests.categoryId], references: [categories.id] }),
  conversations: many(conversations),
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  customer: one(users, { fields: [conversations.customerId], references: [users.id] }),
  store: one(stores, { fields: [conversations.storeId], references: [stores.id] }),
  product: one(products, { fields: [conversations.productId], references: [products.id] }),
  request: one(requests, { fields: [conversations.requestId], references: [requests.id] }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, { fields: [messages.conversationId], references: [conversations.id] }),
  sender: one(users, { fields: [messages.senderId], references: [users.id] }),
}));

export type User = typeof users.$inferSelect;
export type Store = typeof stores.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderStatus = (typeof orderStatus.enumValues)[number];
export type DeliveryStatus = (typeof deliveryStatus.enumValues)[number];
export type BillStatus = (typeof billStatus.enumValues)[number];
export type PromotionTier = (typeof promotionTier.enumValues)[number];
export type PromotionStatus = (typeof promotionStatus.enumValues)[number];
export type StoreStatus = (typeof storeStatus.enumValues)[number];
export type Promotion = typeof promotions.$inferSelect;
export type AlertType = (typeof alertType.enumValues)[number];
export type ProductKind = (typeof productKind.enumValues)[number];
export type PlanFrequency = (typeof planFrequency.enumValues)[number];
export type PaymentTiming = (typeof paymentTiming.enumValues)[number];
export type RecurringPlan = typeof recurringPlans.$inferSelect;
export type DeliveryMethod = (typeof deliveryMethod.enumValues)[number];
export type HandoverType = (typeof handoverType.enumValues)[number];
export type StoreDeliveryMode = (typeof storeDeliveryMode.enumValues)[number];
export type SecondCheck = (typeof secondCheck.enumValues)[number];
export type MediaType = (typeof mediaType.enumValues)[number];
export type Delivery = typeof deliveries.$inferSelect;
export type Deal = typeof deals.$inferSelect;
export type Coupon = typeof coupons.$inferSelect;
export type ReviewTarget = (typeof reviewTarget.enumValues)[number];
export type AdCampaign = typeof adCampaigns.$inferSelect;
export type AdPlacement = typeof adPlacements.$inferSelect;
export type ReportTarget = (typeof reportTarget.enumValues)[number];

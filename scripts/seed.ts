// Seeds categories, an admin, demo merchants/customers, products, promotions and orders.
// Usage: npm run db:seed   (safe to re-run: skips if the admin already exists)
import "dotenv/config";
import bcrypt from "bcryptjs";
import { eq, like } from "drizzle-orm";
import { db, schema } from "../app/db/client.server";
import { placeOrder, updateOrderStatus } from "../app/lib/orders.server";
import { TERMS_VERSION } from "../app/lib/terms";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@myplug.local";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "admin12345";
const DEMO_PASSWORD = "password123";

const CATEGORIES = [
  ["Electronics", "electronics", "smartphone"],
  ["Fashion", "fashion", "shirt"],
  ["Home & Living", "home", "sofa"],
  ["Beauty", "beauty", "sparkles"],
  ["Sports", "sports", "dumbbell"],
  ["Baby & Kids", "baby", "baby"],
  ["Groceries", "groceries", "basket"],
  ["Gaming", "gaming", "gamepad"],
  ["Auto", "auto", "car"],
  ["Crafts & Custom", "crafts", "palette"],
] as const;

const MERCHANTS = [
  {
    name: "Thandi Mokoena",
    email: "thandi@demo.myplug",
    store: "Thandi's Threads",
    slug: "thandis-threads",
    description: "Hand-finished African print fashion. Custom sizing on request.",
    products: [
      ["Ankara wrap dress", "fashion", 8990000, 11990000, 12],
      ["Shweshwe bucket hat", "fashion", 2490000, null, 30],
      ["Custom tailored blazer", "fashion", 18990000, null, 3],
      ["Beaded statement earrings", "crafts", 1590000, 1990000, 0],
    ],
  },
  {
    name: "Sipho Dlamini",
    email: "sipho@demo.myplug",
    store: "Plug Electronics",
    slug: "plug-electronics",
    description: "Phones, audio and accessories with same-week delivery.",
    products: [
      ["Wireless earbuds Pro", "electronics", 7990000, 9990000, 40],
      ["65W fast charger", "electronics", 3490000, null, 55],
      ["Bluetooth party speaker", "electronics", 12990000, 15990000, 8],
      ["Wireless gaming controller", "gaming", 6990000, null, 15],
      ["Dash cam 4K", "auto", 14990000, null, 4],
    ],
  },
  {
    name: "Lerato Nkosi",
    email: "lerato@demo.myplug",
    store: "Glow & Grace",
    slug: "glow-and-grace",
    description: "Small-batch skincare made with marula and rooibos.",
    products: [
      ["Marula face oil 30ml", "beauty", 3290000, null, 25],
      ["Rooibos body butter", "beauty", 1990000, 2490000, 60],
      ["Gift box: self-care set", "beauty", 6990000, 8490000, 5],
      ["Soy candle — fynbos", "home", 2290000, null, 0],
    ],
  },
  {
    name: "Johan van Wyk",
    email: "johan@demo.myplug",
    store: "Karoo Kitchen & Home",
    slug: "karoo-kitchen-home",
    description: "Handmade furniture, kitchenware and pantry goods.",
    products: [
      ["Kiaat serving board", "home", 5490000, null, 10],
      ["Biltong slicer", "home", 3990000, 4490000, 18],
      ["Homemade rusks 1kg", "groceries", 1290000, null, 100],
      ["Kids' wooden puzzle set", "baby", 2990000, null, 9],
      ["Yoga mat — eco cork", "sports", 4990000, 5990000, 14],
    ],
  },
] as const;

async function main() {
  if (await db.query.users.findFirst({ where: eq(schema.users.email, ADMIN_EMAIL) })) {
    console.log("Already seeded — nothing to do.");
    return;
  }

  console.log("Seeding categories...");
  const cats = await db
    .insert(schema.categories)
    .values(CATEGORIES.map(([name, slug, icon]) => ({ name, slug, icon })))
    .onConflictDoNothing()
    .returning();
  const catId = Object.fromEntries(cats.map((c) => [c.slug, c.id]));

  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  await db.insert(schema.users).values({
    email: ADMIN_EMAIL,
    name: "MyPlug Admin",
    role: "admin",
    passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 10),
  });

  const [customer] = await db
    .insert(schema.users)
    .values({ email: "customer@demo.myplug", name: "Naledi Customer", role: "customer", passwordHash: hash })
    .returning();

  console.log("Seeding merchants & products...");
  const productIds: string[] = [];
  for (const m of MERCHANTS) {
    const [owner] = await db
      .insert(schema.users)
      .values({ email: m.email, name: m.name, role: "merchant", passwordHash: hash })
      .returning();
    const [store] = await db
      .insert(schema.stores)
      .values({ ownerId: owner.id, name: m.store, slug: m.slug, description: m.description, status: "approved" })
      .returning();
    for (const [title, cat, price, was, qty] of m.products) {
      const [p] = await db
        .insert(schema.products)
        .values({
          storeId: store.id,
          categoryId: catId[cat],
          title,
          description: `${title} from ${m.store}. ${m.description}`,
          priceCents: price,
          compareAtCents: was,
          quantity: qty,
          trackStock: title !== "Homemade rusks 1kg", // made continuously: always in stock
          imageUrl: `https://picsum.photos/seed/${encodeURIComponent(title)}/600/600`,
        })
        .returning();
      productIds.push(p.id);
    }
  }

  console.log("Seeding a service provider...");
  const serviceCats = Object.fromEntries((await db.select().from(schema.categories)).map((c) => [c.slug, c.id]));
  const [eventsOwner] = await db
    .insert(schema.users)
    .values({ email: "events@demo.myplug", name: "Kondwani Mwale", role: "merchant", passwordHash: hash })
    .returning();
  const [eventsStore] = await db
    .insert(schema.stores)
    .values({ ownerId: eventsOwner.id, name: "Mwale Events & Cakes", slug: "mwale-events", status: "approved", description: "DJ, decor and celebration cakes." })
    .returning();
  for (const [title, cat, price, capacity] of [
    ["Wedding & party DJ", "djs-music", 35000000, 1],
    ["Event decor & draping", "decor-events", 60000000, 2],
    ["Custom celebration cakes", "cakes-baking", 8500000, 3],
  ] as const) {
    await db.insert(schema.products).values({
      storeId: eventsStore.id,
      categoryId: serviceCats[cat],
      title,
      priceCents: price,
      kind: "service",
      dailyCapacity: capacity,
      trackStock: false,
      imageUrl: `https://picsum.photos/seed/${encodeURIComponent(title)}/600/600`,
    });
  }

  console.log("Seeding a handyman...");
  const [fixitOwner] = await db
    .insert(schema.users)
    .values({ email: "fixit@demo.myplug", name: "Blessings Phiri", role: "merchant", phone: "+265 99 555 0202", passwordHash: hash })
    .returning();
  const [fixitStore] = await db
    .insert(schema.stores)
    .values({
      ownerId: fixitOwner.id,
      name: "Phiri Fix-It Electronics",
      slug: "phiri-fixit",
      status: "approved",
      description: "Fridges, TVs, phones and solar inverters repaired at your home.",
      isTradesperson: true,
      trades: ["electronics-repair", "electrical"],
      serviceArea: "Lilongwe: Area 47, Area 49 and Kanengo",
      workReferences: "Rewired Kumbali Lodge staff houses (2025)",
    })
    .returning();
  for (const [title, cat, price] of [
    ["Fridge & freezer repair (call-out)", "electronics-repair", 1500000],
    ["House wiring & fault finding", "electrical", 2500000],
  ] as const) {
    await db.insert(schema.products).values({
      storeId: fixitStore.id,
      categoryId: serviceCats[cat],
      title,
      priceCents: price,
      kind: "service",
      dailyCapacity: 3,
      trackStock: false,
      imageUrl: `https://picsum.photos/seed/${encodeURIComponent(title)}/600/600`,
    });
  }

  console.log("Seeding a courier...");
  const [courierUser] = await db
    .insert(schema.users)
    .values({ email: "courier@demo.myplug", name: "Grace Swift", role: "courier", phone: "+265 99 700 1111", passwordHash: hash })
    .returning();
  // Demo only: approved without identity documents. Real couriers upload a face photo and ID first.
  const [courier] = await db
    .insert(schema.couriers)
    .values({ userId: courierUser.id, name: "Swift Riders", phone: "+265 99 700 1111", vehicle: "Motorbike", status: "approved" })
    .returning();
  await db.insert(schema.courierRates).values([
    { courierId: courier.id, area: "Area 10", estimateCents: 300000 },
    { courierId: courier.id, area: "Lilongwe", estimateCents: 500000 },
  ]);

  console.log("Seeding promotions...");
  const now = new Date();
  const week = new Date(Date.now() + 7 * 86_400_000);
  const approved = { status: "approved" as const, days: 7, approvedAt: now, startsAt: now, endsAt: week };
  await db.insert(schema.promotions).values([
    { ...approved, number: "AD-DEMO01", productId: productIds[0], tier: "premium", amountCents: 5000000 },
    { ...approved, number: "AD-DEMO02", productId: productIds[4], tier: "featured", amountCents: 2500000 },
    { ...approved, number: "AD-DEMO03", productId: productIds[10], tier: "featured", amountCents: 2500000 },
    { ...approved, number: "AD-DEMO04", productId: productIds[14], tier: "boost", amountCents: 1000000 },
  ]);

  // A new merchant waiting for approval, to try the admin flow
  const [applicant] = await db
    .insert(schema.users)
    .values({ email: "chikondi@demo.myplug", name: "Chikondi Banda", role: "merchant", passwordHash: hash })
    .returning();
  await db.insert(schema.stores).values({
    ownerId: applicant.id,
    name: "Lilongwe Leather Co.",
    slug: "lilongwe-leather-co",
    description: "Handmade leather bags, belts and sandals.",
  });

  console.log("Seeding orders...");
  const address = "12 Jacaranda Street\nMelville, Johannesburg 2092";
  const o1 = await placeOrder({ customerId: customer.id, productId: productIds[4], quantity: 1, shippingAddress: address });
  const o2 = await placeOrder({ customerId: customer.id, productId: productIds[1], quantity: 2, shippingAddress: address });
  await placeOrder({ customerId: customer.id, productId: productIds[9], quantity: 1, shippingAddress: address });

  const sipho = await db.query.stores.findFirst({ where: eq(schema.stores.slug, "plug-electronics") });
  const thandi = await db.query.stores.findFirst({ where: eq(schema.stores.slug, "thandis-threads") });
  for (const status of ["confirmed", "processing", "shipped", "delivered"] as const) {
    await updateOrderStatus({
      orderId: o1.id,
      storeId: sipho!.id,
      status,
      actorId: sipho!.ownerId,
      courier: "The Courier Guy",
      trackingNumber: "TCG123456",
      receivedBy: "Naledi",
    });
  }
  await db
    .update(schema.bills)
    .set({ status: "paid", paidAt: new Date(), paymentReference: "EFT-0001" })
    .where(eq(schema.bills.orderId, o1.id));
  await updateOrderStatus({ orderId: o2.id, storeId: thandi!.id, status: "confirmed", actorId: thandi!.ownerId });

  // Demo accounts have accepted the current Terms of Use (real users accept at sign-up or on next visit).
  await db.update(schema.users).set({ termsVersion: TERMS_VERSION, termsAcceptedAt: new Date() }).where(like(schema.users.email, "%@demo.myplug"));

  console.log(`
Done! Demo accounts (password "${DEMO_PASSWORD}"):
  customer@demo.myplug   (customer)
  thandi@demo.myplug     (merchant)
  sipho@demo.myplug      (merchant)
  chikondi@demo.myplug   (merchant, store awaiting approval)
  events@demo.myplug     (service provider: DJ, decor, cakes)
  courier@demo.myplug    (courier)
Admin: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}  — change this password!`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

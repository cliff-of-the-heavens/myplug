// Prepares a fresh production database: the product categories and your admin account.
// No demo shops, products or customers. Run it after `npm run db:migrate`.
//
//   npm run setup -- --email you@example.com --name "Your Name"
//
// You're asked for the password (it isn't shown or saved in your shell history). You can also
// pass ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME as environment variables. Safe to re-run:
// existing categories are kept, and an existing account is never changed.
import "dotenv/config";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, schema } from "../app/db/client.server";
import { TERMS_VERSION } from "../app/lib/terms";

// Service and real estate categories come with the migrations; these are the product ones.
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

const MIN_ADMIN_PASSWORD = 12;

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

/** Reads a line without echoing it (for the password). */
function askHidden(question: string): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk, _enc, done) {
      if (!muted) process.stdout.write(chunk);
      done();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    muted = true;
  });
}

async function main() {
  const email = (arg("email") ?? process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const name = (arg("name") ?? process.env.ADMIN_NAME ?? "MyPlug Admin").trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Give the admin's email: npm run setup -- --email you@example.com");

  console.log("Adding product categories...");
  const added = await db
    .insert(schema.categories)
    .values(CATEGORIES.map(([n, slug, icon]) => ({ name: n, slug, icon, kind: "product" as const })))
    .onConflictDoNothing()
    .returning({ id: schema.categories.id });
  console.log(`  ${added.length} added, ${CATEGORIES.length - added.length} already there.`);

  const existing = await db.query.users.findFirst({ where: eq(schema.users.email, email), columns: { id: true, role: true } });
  if (existing) {
    console.log(`An account for ${email} already exists (${existing.role}); it was left unchanged.`);
    return;
  }

  let password = process.env.ADMIN_PASSWORD ?? "";
  if (!password) {
    if (!process.stdin.isTTY) throw new Error("Run this in a terminal to type the password, or set ADMIN_PASSWORD.");
    password = await askHidden(`Password for ${email} (at least ${MIN_ADMIN_PASSWORD} characters): `);
    const again = await askHidden("Type it again: ");
    if (password !== again) throw new Error("The passwords didn't match. Nothing was created.");
  }
  if (password.length < MIN_ADMIN_PASSWORD) throw new Error(`Use at least ${MIN_ADMIN_PASSWORD} characters for the admin password. Nothing was created.`);

  await db.insert(schema.users).values({
    email,
    name,
    role: "admin",
    passwordHash: await bcrypt.hash(password, 10),
    termsVersion: TERMS_VERSION,
    termsAcceptedAt: new Date(),
  });
  console.log(`Admin created: ${email}. Sign in on your site, then set payment instructions and storage under Admin.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`\n${e instanceof Error ? e.message : e}`);
    process.exit(1);
  });

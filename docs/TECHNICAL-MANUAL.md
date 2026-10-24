# MyPlug Technical Manual

For whoever deploys, runs and maintains MyPlug. Step-by-step deployment is in [`DEPLOYMENT.md`](../DEPLOYMENT.md);
this manual explains how the system fits together and how to fix problems.

- [1. Architecture](#1-architecture)
- [2. Configuration](#2-configuration)
- [3. Database](#3-database)
- [4. Files and images](#4-files-and-images)
- [5. Email](#5-email)
- [6. The daily job](#6-the-daily-job)
- [7. Analytics](#7-analytics)
- [8. Security](#8-security)
- [9. Performance](#9-performance)
- [10. Local development, demo and tests](#10-local-development-demo-and-tests)
- [11. Routine operations](#11-routine-operations)
- [12. Troubleshooting](#12-troubleshooting)

---

## 1. Architecture

| Layer | Technology |
| --- | --- |
| Web framework | React Router v7 (framework mode, server rendering), TypeScript |
| Styling | Tailwind CSS v4, shadcn-style components (Radix UI) |
| Hosting | Vercel serverless functions (`@vercel/react-router` adapter) |
| Database | Neon Postgres, via Drizzle ORM and `@neondatabase/serverless` (WebSocket pool, so transactions work) |
| Files | Vercel Blob, or any FTP/FTPS server; private files in private Blob / a deny-all FTP folder |
| Email | Resend HTTP API |
| Images | `sharp` (optional optimisation to WebP) |
| Scheduled work | Vercel Cron, one daily job (`/api/cron/daily`) |
| PWA | `public/manifest.webmanifest`, `public/sw.js` (installable, offline page) |

**Source layout:**

```
app/
  routes.ts            every URL and the file that handles it
  routes/              pages and API endpoints (loader = read, action = write)
  components/          shared UI
  lib/*.server.ts      server-only logic (database, email, storage, payments flows)
  lib/*.ts             code shared by server and browser (labels, validation, formatting)
  db/schema.ts         every table (Drizzle)
drizzle/               SQL migrations, applied in order (0000 ... 0010)
scripts/setup.ts       production setup: product categories + admin
scripts/seed.ts        demo data (local only)
docs/                  manuals and marketing materials
vercel.json            the daily cron job
```

Rule of thumb: anything in a `*.server.ts` file must never be imported by browser code. The build fails
with "Server-only module referenced by client" if it is. Shared constants go in a plain `.ts` file.

**Money** is stored as whole minor units (tambala) in `bigint` columns. Each store has a currency (set by
admins, default MWK); orders store the currency they were placed in.

---

## 2. Configuration

### Environment variables (Vercel → Settings → Environment Variables)

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Neon connection string. Use the **pooled** one (host contains `-pooler`). Set by the Neon integration |
| `SESSION_SECRET` | 32+ random characters. Signs session cookies and encrypts the saved FTP password. **Don't change it casually** (everyone is signed out and the FTP password must be re-entered) |
| `APP_URL` | Public site address, used in emails |
| `CRON_SECRET` | Vercel sends it as `Authorization: Bearer …` to the cron endpoints; requests without it get 401 |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob (set by the Blob integration). Not needed when using FTP |
| `RESEND_API_KEY`, `EMAIL_FROM` | Email. Without them, emails are only written to the logs |
| `REPORT_AUTO_HIDE_THRESHOLD` | Reports that auto-hide an image (default 3) |

### Admin settings (stored in the `settings` table)

Everything else is set in the admin portal and cached in memory for up to a minute per server instance:
payment instructions, storage (Blob/FTP), image optimisation, analytics retention, listing retention,
inactive-store rules, alert limits, ad prices, listing plans, photos per listing, the obscene-word lists.

---

## 3. Database

### Migrations

`drizzle/*.sql` files are applied in order by `npm run db:migrate` (Drizzle records applied ones in
`drizzle.__drizzle_migrations`). Some migrations also insert starting data (categories, ad spots, bands,
listing plans, settings).

| Migration | Adds |
| --- | --- |
| 0000–0003 | Core marketplace, approvals, ad billing, stock modes, alerts |
| 0004 | Services, bookings, repeat orders, service categories |
| 0005 | Addresses, couriers, delivery security, digital products, business licences |
| 0006 | Cart, deals, gift coupons, favourites |
| 0007 | Password resets |
| 0008 | Reviews, banner ad platform, ad-free passes |
| 0009 | Real Estate (property kind, offers), archiving |
| 0010 | Vehicle/part details, listing plans, analytics tables |

**To change the schema:** edit `app/db/schema.ts`, run `npm run db:generate -- --name what_changed`, review
the SQL, commit it, then run `npm run db:migrate` against production.

> Postgres can't use a new enum value in the same transaction that adds it. If a migration adds an enum
> value, don't insert rows using it in the same migration.

### Important tables

| Table | Holds |
| --- | --- |
| `users`, `stores`, `couriers` | Accounts; `stores.status` (pending/approved/archived/suspended), `stores.listing_band_id` |
| `products` | All listings; `kind` = product/service/digital/property; `auto_details`, `property_features` (JSON) |
| `orders`, `order_items`, `bills`, `deliveries` | Orders and their payment and delivery |
| `property_offers` | Offers/bids on property |
| `reviews` | Ratings; `status` visible/flagged/hidden |
| `promotions`, `ad_campaigns`, `ad_placements` | Product boosts and banner ads |
| `listing_bands`, `band_requests` | Store plans and upgrade requests |
| `analytics_daily`, `analytics_monthly`, `analytics_visitors`, `visitor_store_monthly` | Analytics counters |
| `settings` | Admin settings (key/value) |

### Backups and restores

Neon keeps point-in-time history (length depends on your plan): Neon console → **Restore**. For your own
copy: `pg_dump "$DATABASE_URL" > backup.sql`; restore with `psql "$DATABASE_URL" < backup.sql`.

---

## 4. Files and images

- **Public files** (product photos, logos, banners): `storeFile()` in `app/lib/storage.server.ts` writes to
  Blob, or to the FTP folder, and returns `publicBaseUrl/<name>`.
- **Private files** (courier face photos, ID documents, licences, digital products): stored privately and
  served only through `/files/...` and `/media/...` after a permission check.
- **FTP on another domain:** *Admin → System settings → File storage → FTP*: host, port, encryption (none /
  explicit FTPS / implicit FTPS), username, password, remote folder, and the **public base URL** where that
  folder is served over HTTPS (e.g. `https://images.example.com/myplug`). Browsers can't show `ftp://`
  links, so the folder must also be served by a web server. **Test connection** uploads a file, fetches it
  over HTTPS and deletes it. Add a deny-all rule (e.g. `.htaccess`: `Require all denied`) on the private
  sub-folder.
- **Switching storage** only affects new uploads; existing files keep their URLs.
- **Upload limits:** 4 MB per image (Vercel's request limit is 4.5 MB). Galleries upload one photo per
  request. Digital products upload straight from the browser to Blob (up to 2 GB).
- **Image optimisation** (`app/lib/image-optimize.server.ts`): when on, public photos are rotated (EXIF),
  resized to the maximum width and saved as WebP at the chosen quality. GIFs and files that wouldn't get
  smaller are kept as they are, and a failure stores the original. Banners, ID documents and proofs are never
  changed. `sharp` is loaded only when an image is optimised.

---

## 5. Email

`app/lib/email.server.ts` sends through Resend's batch API from `EMAIL_FROM`. Verify your domain in Resend
(SPF, DKIM records in your DNS) or emails go to spam or are refused. Merchants can never send arbitrary
email: alerts use one fixed template, and links in the merchant's note are removed. Every alert email has
one-click unsubscribe.

---

## 6. The daily job

`/api/cron/daily` (03:00 UTC, see `vercel.json`) runs, in order:

1. `runDuePlans()`: today's repeat-order deliveries.
2. `runRetention()`: archive / warn / delete inactive stores.
3. `runListingCleanup()`: "bidding closed" notices; archive sold property (next day) and sold-out products;
   restore restocked ones; delete archived listings past their retention period.
4. `rollupAnalytics()`: move daily counters older than the retention period into monthly totals; delete
   old detail.
5. Send waiting alert emails (up to ~40 seconds; the rest go the next day).

It returns JSON with counts from each step. Run it by hand from *Admin → System settings → Run the daily
jobs now*, or:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://your-site/api/cron/daily
```

The Hobby plan allows one cron run per day. On Pro, add `/api/cron/alerts` every 15 minutes.

---

## 7. Analytics

Designed so it can't slow the site:

- **No work during page rendering.** The browser (`app/components/tracker.tsx`) queues events in memory and
  sends one batch with `navigator.sendBeacon` when the page is hidden or closed, or every 30 seconds.
- **Counters, not logs.** `/api/t` turns a batch into at most three upserts: one multi-row upsert into
  `analytics_daily`, one into `visitor_store_monthly` (who visits which store), and one insert to count a
  new unique visitor (only on the visitor's first batch of the day).
- **Skipped:** bots (by user agent), visitors with Do Not Track or Global Privacy Control, and everything
  when analytics is switched off.
- **Ad viewability:** a banner view counts when at least half of it is visible for a second, with the tab
  in view (IntersectionObserver). Time on screen is capped at 5 minutes per batch. Clicks are counted in
  the `/ad/:id` redirect.
- **Retention** (*Admin → Analytics → Settings*): day-by-day detail (default 90 days), then rolled into
  `analytics_monthly`; who-visits-which-store (default 12 months); monthly totals (default 36 months).
- Visitor ids are random values in the browser's local storage. Signed-in visitors' store visits are
  linked to their account and shown only to admins. The Terms of Use disclose this.

---

## 8. Security

- Passwords hashed with bcrypt. Sessions are signed cookies (`httpOnly`, `sameSite=lax`, `secure` in
  production). Changing a password invalidates other sessions.
- Password reset tokens: single use, one hour, only a hash stored, three requests per hour.
- Merchants never see customers' email addresses. Reviewers show by first name.
- The secret reserve price on property is never sent to anyone but the seller.
- Upload links for advertisers: random token (hash stored), bcrypt-hashed 6-digit passcode, 5 attempts.
- All money calculations (sale prices, promo codes, coupons) are done on the server inside transactions;
  stock, promo limits and coupons are locked so they can't be overspent under load.
- Private files are served only after permission checks.
- Have a Malawian lawyer review the Terms, and check registration requirements under the Data Protection
  Act 2024 (you store ID documents).

---

## 9. Performance

- Serverless functions scale with traffic; the pooled Neon connection string shares connections.
- Categories and settings are cached in memory briefly; indexes cover the feed, search, bookings, alert
  queue, moderation queue and analytics keys.
- Slow work (emails, repeat orders, clean-up) runs in the daily job, not in page requests.
- Images come from Blob or your file server, not the app; turn on image optimisation to shrink them.
- Before a big launch, load-test a preview deployment, e.g.
  `npx autocannon -c 50 -d 30 https://<preview-url>/`, and watch Neon's monitoring.

---

## 10. Local development, demo and tests

```bash
npm install
cp .env.example .env    # set DATABASE_URL (a Neon dev branch) and SESSION_SECRET
npm run db:migrate
npm run db:seed         # demo data (never in production)
npm run dev             # http://localhost:5173
npm run typecheck
npm run build
```

**In-memory demo (no database needed):** the git-ignored `.demo/` folder contains an in-memory Postgres
(PGlite) with rich demo data:

```bash
SESSION_SECRET=demo-secret-0123456789abcdef0123456789 DATABASE_URL=demo \
  ./node_modules/.bin/react-router dev --config vite.demo.config.ts --port 5173 --strictPort
```

Demo logins (password `password123`): `customer@demo.myplug`, `thandi@demo.myplug` (fashion),
`sipho@demo.myplug` (electronics), `kwathu@demo.myplug` (real estate), `motors@demo.myplug` (vehicles and
parts), `swift@demo.myplug` (courier), `admin@myplug.local` (admin). Data resets on every restart.

**Tests** (from `.demo/`): `../node_modules/.bin/tsx --tsconfig tsconfig.json featuresN.ts` for N = (none),
2, 3, 4, 5, 6. Each runs against a fresh in-memory database with all migrations applied.

> **Note:** the demo and tests need `node_modules/@electric-sql` to point at `.demo/node_modules/@electric-sql`
> (a Windows junction). `npm install` in the project removes it. Restore it with:
> `cd .demo && npm ci && cd .. && cmd /c "mklink /J node_modules\@electric-sql .demo\node_modules\@electric-sql"`

---

## 11. Routine operations

| Task | How |
| --- | --- |
| Deploy new code | Push to `main`; Vercel builds and deploys |
| New migration in the update | `npm run db:migrate` with the production `DATABASE_URL` in `.env` |
| Roll back code | Vercel → Deployments → earlier deployment → Promote to Production |
| Add an admin | `npm run setup -- --email new-admin@example.com --name "Name"` |
| Change Terms of Use | Edit `app/routes/terms.tsx`, bump `TERMS_VERSION` in `app/lib/terms.ts`; everyone re-accepts |
| Add a currency | `CURRENCIES` in `app/lib/format.ts` |
| Add product categories | Insert into `categories` (kind `product`), or extend `scripts/setup.ts` and re-run it |
| Rotate `CRON_SECRET` | Change it in Vercel and redeploy |
| Check logs | Vercel → Project → Logs (filter by `/api/cron/daily`, errors) |

---

## 12. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Site shows an error right after deploy; logs say `DATABASE_URL is not set` | Neon not connected to this environment | Vercel → Storage → connect Neon to Production; redeploy |
| `SESSION_SECRET must be set and at least 32 characters long` | Missing or short secret | Add a 32+ character `SESSION_SECRET`; redeploy |
| Pages error with `relation "..." does not exist` | Migrations not run on this database | `npm run db:migrate` against production |
| Can't sign in to admin | No admin yet, or wrong database | `npm run setup -- --email ...` against the production `DATABASE_URL` |
| Image upload: "File storage is not configured" | No Blob token and FTP not set | Connect Blob, or fill in FTP in System settings |
| FTP "Test connection" fails | Wrong host/port/mode, firewall, or public URL doesn't serve the folder | Try explicit FTPS on 21, check the public URL in a browser, check passive ports are open |
| Images broken after changing `SESSION_SECRET` | FTP password can't be decrypted | Re-enter the FTP password and save |
| Upload fails "Files must be 4 MB or smaller" | Vercel request limit | Use smaller photos, or turn on image optimisation (it runs after upload, so the original must still be under 4 MB) |
| No emails arrive | `RESEND_API_KEY` missing, domain not verified, or in spam | Set the key, verify the domain (SPF/DKIM) in Resend, check Resend's logs |
| Password reset says "check your email" but nothing comes | Same as above; or the email isn't registered (the form doesn't reveal that) | Check Resend logs |
| Repeat orders / clean-up not happening | Cron not running or `CRON_SECRET` mismatch | Vercel → Settings → Cron Jobs; check the job's logs; run it by hand |
| Deploy fails: cron schedule not allowed | A job runs more than once a day on Hobby | Keep only the daily job in `vercel.json` |
| Build fails: "Server-only module referenced by client" | A page component imports from a `.server.ts` file | Move the shared constant/function to a plain `.ts` file |
| Merchant can't add listings | Plan limit reached | They upgrade (Store plan) or archive listings; or admin raises their plan |
| Analytics page empty | Analytics switched off, Do Not Track browsers, or no traffic yet | Check *Admin → Analytics → Settings*; data appears as visitors browse |
| Ads not showing | Not approved, outside dates, spot switched off, or the viewer has an ad-free pass | Check the ad in *Admin → Banner ads* and the spot in *Spots, prices & hero panel* |
| Slow pages under load | Unpooled connection string, or Neon compute asleep / too small | Use the `-pooler` URL; raise Neon compute or autoscaling |
| Demo or tests: `Cannot find package '@electric-sql/pglite'` | `npm install` removed the demo link | See the note in section 10 |

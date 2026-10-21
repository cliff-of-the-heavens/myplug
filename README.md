# MyPlug

A lively multi-merchant marketplace: customers browse and order from local merchants, track deliveries,
chat with sellers, and post photos of things they want made or sourced.

**Stack:** React Router v7 framework mode (the successor to Remix) · Neon Postgres + Drizzle ORM ·
Tailwind v4 + shadcn/ui components · Vercel Blob for images · deployed on Vercel · installable PWA.

## Requirements → where they live

| # | Requirement | Implementation |
|---|-------------|----------------|
| 1 | Customer & merchant auth | `app/lib/auth.server.ts` (bcrypt + signed cookie sessions, roles `customer` / `merchant` / `admin`), `/login`, `/register` |
| 2 | Merchants advertise & take orders | Seller dashboard `/sell` (products, orders, store), `/sell/promote` for paid ads |
| 3 | Quantity, in/out of stock, price, order button | `products` table; stock badge derived from quantity; order box on `/p/:id` |
| 4 | Order tracking | `order_events` timeline + progress tracker on `/account/orders/:id` and `/sell/orders/:id` |
| 5 | Deliveries made, bills honoured or not | `deliveries` and `bills` tables; bill states `unpaid → paid` (honoured) / `overdue` / `defaulted` (not honoured); totals on `/sell` |
| 6 | Only logged-in customers order; everyone browses | All storefront pages are public; order/message actions call `requireCustomer` |
| 7 | Amazon/Walmart/Takealot-style landing | `app/routes/home.tsx`: hero, category tiles, sponsored shelf, deals, recommended grid |
| 8 | Randomised feed prioritising paid ads/extras | `app/lib/catalog.server.ts` — weighted random sampling (see below) |
| 9 | Customer ↔ merchant chat & special orders with text + images | `/messages` (polling every 5s), "Ask a question" / "Special order" on product pages |
| 10 | Customers post an image, merchants talk directly to them | `/requests` board → merchant clicks "I can do this" → private thread |
| 11 | Reporting & takedown of inappropriate images | Report button on every image → auto-hide → `/admin` moderation queue (see below) |
| 12 | Web-app ready | `public/manifest.webmanifest`, `public/sw.js` (offline fallback), icons, mobile tab bar, safe-area support |
| 13 | Sign in / sign up as pop-ups | `app/components/auth-dialog.tsx`; pages that need an account open it via `/?auth=login&redirectTo=...` |
| 14 | Admin portal: approve merchants, manage customers | `/admin` (overview, merchants, customers, account detail); stores start `pending` and can't sell until approved |
| 15 | Ads billed by admin, paid with proof, live only after approval | `/sell/promote` (bands or custom request → invoice → reference + proof upload), `/admin/ads` (quote, verify, approve), `/admin/ads/settings` (band prices, payment details) |
| 16 | "Always in stock" for continuous supply | `products.track_stock`; choose *Always in stock* in the product form (no count, never sells out, orders don't reduce stock) |
| 17 | Email alerts: new stock, restocks, discounts (several products per alert, link to see more) | Customers follow a store and pick alert types; merchants send from the product form or `/sell/alerts`; admin limits at `/admin/alerts`; one-click unsubscribe |
| 18 | Repeat orders (e.g. daily bread) | `recurring_plans`; "Deliver on repeat" on product pages; each delivery becomes its own order and bill (`app/lib/recurring.server.ts`), created by the daily job |
| 19 | Payment due after delivery, or prepayment | `orders.payment_timing`; pay-after bills fall due 7 days after delivery; prepaid orders can't be dispatched until paid; repeat orders can hold prepaid credit |
| 20 | Services (DJs, decor, cakes…) with portfolio & references | `products.kind = service`, service categories, `product_images` gallery, references text |
| 21 | Bookings with a daily limit; customers can see bookings | `daily_capacity`; a day is closed once confirmed bookings fill it; public availability calendar + anonymous track record on the service page |
| 22 | Store images on another server (FTP) | Admin → System settings: Vercel Blob, FTP/FTPS or local (`app/lib/storage.server.ts`) |
| 23 | Handle load; archive inactive stores, delete after a year (adjustable) | caching, indexes, daily job; Admin → System settings → Inactive stores (`app/lib/retention.server.ts`) |
| 24 | Saved delivery addresses; handover options (door, gate, reception, in person, delegate) | `addresses`, `/account/addresses`; checkout picks a saved address or adds one |
| 25 | Couriers: registration with face photo & ID, area price estimates, admin approval | `couriers`, `courier_rates`, `/courier`, `/courier/profile`, `/admin/couriers` |
| 26 | Who delivers: store, store's courier (store pays), or customer (collect / bid / usual courier) | `stores.delivery_mode`; `courier_quotes` (bidding closes when one is accepted) |
| 27 | Pickup security: code or secret phrase, collector ID/photo, optional phone/app approval, logs, instant alerts | `app/lib/delivery.server.ts`, `delivery_logs`, `notifications` (bell + email) |
| 28 | Digital products (video, audio, PDF) with previews; download / stream; time- and view-limited | `digital_offers`, `digital_grants`, `/account/library`, signed `/media/:id` links |
| 29 | Business registration number, licences, admin-verified badge that lapses on expiry | `business_licenses`, `/sell/business`, admin Merchants page, green badge on store/product |
| 30 | Terms of Use accepted at sign-up (and by existing users once) | `/terms`, `users.terms_version`, `app/lib/terms.ts` |

## Getting started

```bash
npm install
cp .env.example .env          # fill in DATABASE_URL (Neon) and SESSION_SECRET
npm run db:migrate            # creates the tables from drizzle/0000_init.sql
npm run db:seed               # categories, admin, demo merchants/products/orders
npm run dev
```

Demo logins after seeding (password `password123`): `customer@demo.myplug`, `thandi@demo.myplug`,
`sipho@demo.myplug`, `events@demo.myplug` (service provider), `courier@demo.myplug` (courier), and
`chikondi@demo.myplug` (a store waiting for approval). Admin: `admin@myplug.local` / `admin12345`. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD`
before seeding production. Demo product photos are random placeholders from picsum.photos.

After changing `app/db/schema.ts`, run `npm run db:generate` then `npm run db:migrate`.

## Deploying to Vercel

1. Push to GitHub and import the repo in Vercel (the framework is detected automatically;
   `@vercel/react-router` is already configured in `react-router.config.ts`).
2. **Storage → Neon**: adds `DATABASE_URL`.
3. **Storage → Blob**: adds `BLOB_READ_WRITE_TOKEN`. Without it, image uploads fail in production; in
   local dev they fall back to `public/uploads`.
4. Add `SESSION_SECRET` (e.g. `openssl rand -hex 32`), plus `RESEND_API_KEY`, `EMAIL_FROM` (a sender on a
   domain verified in Resend), `APP_URL` (your site's URL, for links in emails) and `CRON_SECRET`.
5. Run `npm run db:migrate` (and `db:seed` once) against the production `DATABASE_URL`.

## Currency and images

- **Currency.** Each store picks its currency under *Seller → Store settings*; new stores default to
  **MWK (Malawian Kwacha, shown as "MK")**. Prices are stored in minor units (tambala/cents) in `bigint`
  columns, because kwacha amounts outgrow a 32-bit integer. Each order records the currency it was placed in,
  so changing the store's currency later doesn't relabel past orders. Changing it doesn't convert prices
  either; merchants should update them. Ad prices in `app/routes/sell.promote.tsx` are in MWK. Add more
  currencies to `CURRENCIES` in `app/lib/format.ts`.
- **Drag & drop.** Every image field (product photo, store logo, request photo, chat attachment) accepts
  a dropped image as well as a click, checking type and the 4 MB limit before upload
  (`app/components/image-dropzone.tsx`).

## Merchant approval and the admin portal

New merchant accounts get a store with status **pending**. Until an admin approves it, the merchant can sign
in but every `/sell` page redirects to `/sell/pending`, and the store and its products are hidden from
shoppers. The admin portal at `/admin` covers:

- **Merchants**: approve or reject applications (a reason is required to reject), suspend a store (its
  products disappear and the owner is signed out) and reactivate it.
- **Customers**: search, see orders, requests and unpaid/defaulted bills, suspend and reactivate.
- **Account detail** (`/admin/users/:id`): everything about one customer or merchant, for when you need to
  step in.
- **Adverts and Bands & payment** (below) and the existing **Moderation** queue.

## Adverts: billing, proof of payment, approval

1. The merchant picks an **advertised band** (Boost / Featured / Premium at a weekly price the admin sets)
   and gets an invoice straight away, *or* sends a **custom request** describing what they want. The admin
   then sets the placement, duration and price, which bills the merchant.
2. The merchant pays using the instructions set by the admin (bank / mobile money, with the advert number
   such as `AD-7K2Q9A` as the reference), then submits the transaction reference and/or uploads proof
   (PDF or image).
3. The admin checks the payment under **Adverts → To verify** and either approves it, which starts the
   advert immediately for its paid number of days, or sends it back with a note.
   *Paid another way* approves an unpaid invoice, e.g. for cash.
4. Only approved adverts within their dates affect the feed or appear in Sponsored picks (`liveAd` in
   `app/lib/ads.server.ts`). Admins can stop a running advert early.

Ad prices are in MWK. Changing a band's price only affects new invoices. To take payments online later
(e.g. PayChangu, Paystack, Stripe), call `approveAd()` from the provider's payment webhook.

## Email alerts

- **Customers** tap *Get alerts* on a store or product page and choose *New arrivals*, *Back in stock*
  and/or *Discounts*. They can change their choices, unfollow, or switch off every alert at
  `/account/alerts`. Every email has one-click unsubscribe links (from that store, or from everything)
  that work without signing in, and the `List-Unsubscribe` headers let mail apps show their own button.
- **Merchants** send an alert when saving a product (product form), or later from `/sell/alerts`, for
  example after restocking from the products list. They see subscriber **counts only**, never names or
  addresses.
- **No spoofing.** MyPlug sends every email from its own address (`EMAIL_FROM`) using one fixed template.
  A merchant can only add a short plain-text note, and links in it are removed, so an alert can't be used
  to send customers to a look-alike site. Opt-outs are checked again just before each email is sent.
- **Admin limits** (`/admin/alerts`): switch alerts off for everyone, set alerts per store per 7 days
  (default 3), the wait before the same alert for a product (default 7 days; new-arrival alerts are once
  per product), and the minimum discount for discount alerts (default 10%). Admins can also pause one
  store's alerts and preview any email that was sent. Restock alerts need the item in stock, and discount
  alerts need a real discount.
- **Sending** uses [Resend](https://resend.com) (`RESEND_API_KEY`). Without a key, emails are only logged
  on the server. The first 100 go out immediately, and `/api/cron/alerts` (Vercel Cron, see `vercel.json`;
  protected by `CRON_SECRET`) sends the rest and retries failures. Every-15-minutes crons need a Vercel Pro
  plan; on Hobby, change the schedule to daily.

## Services and bookings

A listing is either a **product** (ordered and delivered) or a **service** (booked for a date). Service
categories (DJs & Music, Decor & Events, Cakes & Baking, Photography & Video, Catering, Hair & Makeup) are
created by the migration. Providers add a portfolio (up to 8 photos, dragged in together and uploaded one
by one) and a *References & past work* section.

- Each service has **bookings per day**. Customers request a date. When the provider confirms a booking
  and that fills the day, the day closes: nobody can request it any more, and other pending requests for it
  are declined automatically so those customers can choose another date. Slots are checked inside a locked
  transaction, so two confirmations can't overbook a day.
- To avoid being duped, customers see the provider's **availability calendar** (free, partly booked and
  full days) and an anonymous **booking record**: bookings completed, completed in the last year,
  upcoming confirmed bookings, cancellations, and how long they've been on MyPlug. Customer names are never
  shown.
- Bookings go *Requested → Confirmed → Completed*. There are no shipping steps.

## Repeat orders and prepayment

- **Repeat orders.** On a product page, *Deliver on repeat* asks how often (every day, weekdays or
  weekly), the first delivery and an optional last delivery. The daily job (`/api/cron/daily`, 05:00
  Malawi time) creates that day's order for every due plan. Each delivery is a normal order with its own
  bill, so deliveries and payments are tracked exactly like one-off orders. Plans are locked while they run,
  so a delivery is never created twice; missed days are skipped rather than delivered late. Customers pause,
  resume or cancel under *My orders → Repeat orders*.
- **Pay after delivery** (default): the bill falls due 7 days after the order is actually delivered, or
  after the event for bookings. It then shows as overdue and can be marked *not honoured* as before.
- **Pay in advance**: available for one-off orders, bookings and repeat orders. The customer reports a
  payment (reference and/or proof). The merchant checks it and marks the bill paid, and can't dispatch a
  prepaid order (or complete a prepaid booking) before then. For repeat orders, confirmed prepayments
  become **credit** that pays each delivery automatically. When credit runs out, that day's bill waits for
  payment.

## File storage (Vercel Blob or your own FTP server)

*Admin → System settings → File storage* chooses where uploads go:

- **Vercel Blob** (needs `BLOB_READ_WRITE_TOKEN`).
- **FTP / FTPS** on any server you control. Enter the host, port, encryption, username, password, remote
  folder and the **public base URL** where that folder is served over HTTPS (browsers can't show images
  from `ftp://` links). *Test connection* uploads a file, fetches it over HTTPS and deletes it. The password
  is encrypted with a key derived from `SESSION_SECRET` (AES-256-GCM) and is never sent back to the
  browser. If you change `SESSION_SECRET`, re-enter it.
- **Local disk** (development only).

Existing files stay where they were uploaded.

## Inactive stores (archive, then delete)

*Admin → System settings → Inactive stores* (defaults: archive after 6 months, delete after 12, warn 30
days before deletion; all adjustable or switched off). A store is active when its owner signs in or uses
MyPlug, or when a customer orders from it. The daily job:

1. **archives** stores inactive for the archive period: listings are hidden and the owner is emailed.
   Signing in restores the store at once;
2. **warns** the owner by email before deletion;
3. **deletes** the account once the warning period has passed: login, name, email, phone, listings,
   gallery, ads and alert followers are removed, and repeat orders are cancelled. Orders and bills are kept,
   anonymised, because customers and the tax records still need them.

The page previews which stores each step would affect, and *Run the daily jobs now* runs them on demand.

## Handling load

- Vercel runs the app as serverless functions that scale out with traffic. Use Neon's **pooled**
  connection string (host contains `-pooler`) for `DATABASE_URL`, so many function instances share a small
  number of database connections. Neon can autoscale compute.
- Data read on nearly every request (categories, admin settings) is cached in memory per server instance
  for a short time (`app/lib/cache.server.ts`). This removes most of those database reads.
- Indexes cover the hot paths: the feed and search (`products_kind_idx`), booking slots
  (`orders_booking_idx`), due plans (`recurring_plans_due_idx`), alert queues and the moderation queue.
  Lists are paginated or capped.
- Slow work happens outside page requests: emails go out in batches of 100 from a claimed queue, and repeat
  orders and retention run in the daily job.
- Gallery photos upload one per request, which keeps each request under Vercel's 4.5 MB limit. Images
  are served from Blob or your file server's CDN, not from the app.
- Before a big launch, load-test a preview deployment (e.g. `npx autocannon -c 50 -d 30 https://<preview>/`)
  and watch Neon's dashboard. This hasn't been run against a deployed instance yet.

## Delivery, couriers and pickup security

**Addresses.** Customers save addresses (recipient, phone, street, area, city, landmark) and pick one at
checkout, or enter a new one there (saved automatically if they tick the box). Each order keeps its own
copy of the address, so editing the address book later doesn't change past orders. The customer also
chooses how the parcel is handed over on arrival: door, gate, reception, in person, or to a **delegate**
(name and phone number required).

**Who delivers** is set by each store (*Store settings*):

| Store setting | What happens | Who pays delivery |
|---|---|---|
| We deliver ourselves | The store delivers and updates the status as before | Store |
| Our courier delivers | The store picks a registered courier in advance. When the store confirms an order, that courier is asked, and their confirmed price closes it directly | Store |
| The customer arranges it | The customer either **collects** (themselves or someone they send), asks **up to 5 couriers for quotes**, or asks their **usual courier** directly (no bidding) | Customer |

**Couriers** register as such ("I deliver"), then upload a clear **face photo** and an **ID document**
and enter their national ID number. An admin compares the photo with the ID before approving them
(*Admin → Couriers*). Changing identity details sends them back for review. Couriers list **estimated
prices per area or city**, which customers see when choosing. When a request arrives, the courier confirms
the real price. With bidding, the customer accepts one quote, which closes the others. The courier
dashboard shows each job's store, pickup address and phone, pickup time, the items, the destination,
handover instructions, and the pickup code.

**Pickup time** is a set time or "any time"; the store can change it, and everyone is told.

**At pickup** the store sees who is coming: the courier's name, phone, vehicle and face photo, or for
someone collecting for the customer, their name, phone and ID number and optional photo. If there's no
photo, both the customer (at checkout) and the store are warned that a wrong pickup is more likely. Then:

1. The collector gives the **pickup code** (6 characters, generated by MyPlug) or the customer's **secret
   phrase**. The phrase is stored hashed; the store never sees the code or phrase, it types in what it's
   told. After 5 wrong attempts the pickup is locked, and the customer is alerted after 3.
2. If the customer asked for an **extra check**: either the store must **phone** the customer and tick that
   they confirmed (MyPlug can't place calls itself), or the customer **approves in the app or by email**.
   The store's page updates on its own while it waits, and refusing blocks the handover.
3. The store hands over. MyPlug logs who did what and when (`delivery_logs`), moves the order to
   *Shipped* (courier) or *Delivered* (collection), and **notifies the customer, store and courier at
   once** (in-app bell + email).

The courier marks the order delivered on arrival, noting who received it or where it was left.

Face photos, ID documents and collector photos are stored **privately** (Vercel Blob private files, a
non-public FTP folder with a deny-all rule, or `.private-uploads/` locally). They're served only through
`/files/...` after checking who's asking. ID documents are visible to admins only. The camera can't verify
a face automatically; staff compare the photo by eye.

## Digital products

A listing can be a **digital product**: video (MP4/WebM), audio (MP3/M4A/OGG/WAV) or a document (PDF).
The merchant uploads:

- the **full file**, stored privately. With Vercel Blob it uploads straight from the browser
  (`@vercel/blob/client`, up to 2 GB), avoiding the 4.5 MB request limit;
- an optional **free preview** (trailer, clip, sample pages), which is public and plays or displays on the
  product page;
- one or more **price options**: *download* or *online only*, each with an optional time limit (days)
  and, for online viewing, a play/read limit.

Buying creates a prepaid order. The customer reports payment, the merchant marks it paid, and access opens
in **My library** (time limits start then). Each time the customer opens it, one view is counted and a
signed link valid for 6 hours is created, tied to that customer. The player's seek requests reuse the
link, so seeking doesn't count as extra views. Downloads are only offered for download options. Note that
a determined buyer can still record or save what they can play; real DRM needs a specialist streaming
service.

## Business verification

Merchants give their **business registration number** when they sign up. Then, under *Business info*
(available while the store is still waiting for approval), they upload their registration certificate or
business licence (**primary**) and any other licences, with numbers, issuer and issue/expiry dates.

On the *Merchants* page, admins open each document, **verify** or reject it, and decide whether
customers may **see** it. Stores whose primary document is verified and **not expired** get a green
**Registered business** badge on their store and product pages. It disappears automatically the day the
licence expires, and editing a document sends it back for verification. Customers can open the badge to see
the registration number and the licences the admin chose to show, and can read those documents.

## Terms of Use

Everyone accepts the Terms of Use (`/terms`) when they sign up. When the version in `app/lib/terms.ts`
changes, existing users are asked to accept the new one before continuing. The terms say MyPlug is a
**linking platform** (not a party to sales, deliveries or payments, with no guarantee, escrow or
insurance), that users accept the risks of dealing with each other including fraud, that the owners are
not liable, and that information is given to the authorities when the law requires it.

The terms also include other conditions I'd recommend for this kind of business:

- minimum age of 18;
- accurate information, and identity checks for sellers and couriers;
- prohibited items and conduct;
- sellers' responsibility for licences, taxes (Malawi Revenue Authority) and consumer protection;
- couriers are independent;
- licences and resale limits for digital products;
- data protection, including what each party can see;
- a liability cap and indemnity;
- the right to suspend accounts;
- Malawian governing law.

**Have a Malawian lawyer review the terms before launch.** In particular, check consumer-protection rules,
which may limit how far liability can be excluded, and the Data Protection Act 2024. Under that Act you
may need to register as a data controller and appoint a contact person, because you store ID documents.

## How the randomised, ad-weighted feed works

Every product gets a weight: `1 + tier weight` (Boost +3, Featured +6, Premium +10), multiplied by 0.25
if it's out of stock. Postgres sorts by `-ln(random()) / weight` (Efraimidis–Spirakis weighted sampling),
so every visit gets a fresh shuffle in which paid products appear near the top far more often. Unpaid
products still get a fair chance. In testing, a single Premium item among 40 landed in the top 3 about half
the time (a uniform shuffle would do that about 7% of the time). Tune the weights in `app/lib/promotions.ts`.

## Reporting & taking down inappropriate images

What's built in:

1. **Report anywhere.** Product photos, request photos, chat images and stores all have a Report button
   (signed-in users only, one report per user per item, reporter stays anonymous).
2. **Automatic hiding.** An image is hidden immediately if it's reported as *nudity*, or once
   `REPORT_AUTO_HIDE_THRESHOLD` (default 3) different users report it. Hidden images are replaced by a
   placeholder everywhere, including the feed.
3. **Admin review queue** at `/admin`. Reports are grouped per item and sorted by number of reports.
   Previews are blurred until hovered so moderators aren't exposed to graphic content unexpectedly. The
   actions are *Take down* (hide the image; delist the product or close the request), *Take down + suspend
   user* (the account can no longer sign in), and *Dismiss & restore*.
4. **Public guidelines** at `/safety`, linked from upload forms and the footer.

Recommended additions before launch:

- **Automated screening on upload.** Hook a moderation API into `uploadImage()` in
  `app/lib/upload.server.ts` and reject or hide images before anyone sees them. Options include AWS
  Rekognition *DetectModerationLabels*, Google Cloud Vision *SafeSearch*, Azure AI Content Safety,
  Sightengine and Hive. Most cost well under a cent per image.
- **CSAM hash matching** (e.g. Microsoft PhotoDNA, or Cloudflare's CSAM scanning tool if images are served
  through Cloudflare). In South Africa the Films and Publications Act obliges platforms to report child
  sexual abuse material to the police and the Film and Publication Board. Never "just delete" it:
  preserve it and report it.
- **Delete the file itself.** A takedown currently hides the image but keeps the Blob file for evidence
  and appeals. Add a scheduled job that calls `del()` from `@vercel/blob` on content taken down more than
  N days ago.
- **Appeals and notifications.** Email the owner when content is removed, and give them a way to appeal.
- **Abuse limits.** Rate-limit uploads and reports per user (e.g. Upstash Ratelimit), and require email
  or phone verification before someone can post requests or send images.

## Not yet built (good next steps)

- **Online payments.** Customer bills are marked paid by the merchant, and ad payments are checked by an
  admin from proofs. A payment provider webhook could approve adverts automatically.
- Email and push notifications for new orders, status changes, messages, store approvals and invoices
  (merchants currently see these when they open the app).
- A multi-item cart (orders are currently one product at a time), password reset, and profile editing.
- Real-time chat (Ably, Pusher, or Neon logical replication) instead of 5-second polling.

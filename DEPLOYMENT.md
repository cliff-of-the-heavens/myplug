# Deploying MyPlug (Vercel Hobby + Neon)

Everything you need to put MyPlug online, in order. Keep this file: it's the reference if you need to
redeploy, move hosting, or recover. For day-to-day problems see `docs/TECHNICAL-MANUAL.md`.

---

## What you need

| Thing | Where | Cost |
| --- | --- | --- |
| GitHub repository | https://github.com/cliff-of-the-heavens/myplug | Free |
| Vercel account (Hobby plan) | https://vercel.com, signed in with GitHub | Free |
| Neon Postgres database | Added from inside Vercel (Storage → Neon) | Free tier to start |
| Vercel Blob (image storage) | Added from inside Vercel (Storage → Blob) | Free tier to start |
| *or* your own FTP server for images | Your hosting provider | Your hosting |
| Resend (email) | https://resend.com, with a domain you own verified | Free tier to start |
| Node.js 22 or newer | On your computer, to run the database setup | Free |

---

## 1. Import the project into Vercel

1. Go to https://vercel.com and sign in with GitHub.
2. Click **Add New → Project**, then **Import** next to `cliff-of-the-heavens/myplug`.
3. Vercel detects **React Router** on its own. Leave **Build Command**, **Output Directory** and
   **Install Command** at their defaults.
4. If it offers to deploy straight away, you can. The first deploy fails without a database; that's
   expected, and you'll redeploy in step 7.

## 2. Add the Neon database

1. In the Vercel project, open **Storage → Create Database → Neon**.
2. Choose a region close to your users (Frankfurt `eu-central-1` or Johannesburg if offered).
3. Click **Connect** to attach it to the project for **Production**, **Preview** and **Development**.
4. This creates the `DATABASE_URL` environment variable for you.

## 3. Add image storage

Choose **one**:

- **Vercel Blob** (simplest): **Storage → Create → Blob**, connect it to the project. This adds
  `BLOB_READ_WRITE_TOKEN`.
- **Your own FTP server / another domain**: skip Blob. After the first deploy, sign in as admin and fill
  in **Admin → System settings → File storage → FTP** (host, port, user, password, folder, and the public web
  address the files are served from, e.g. `https://images.yourdomain.com/myplug`). Use **Test connection**,
  then **Save**. The password is stored encrypted with your `SESSION_SECRET`.

## 4. Add environment variables

In **Settings → Environment Variables**, add these for **Production** (and Preview if you use it):

| Name | Value | Required |
| --- | --- | --- |
| `SESSION_SECRET` | A random string, 32+ characters. Generate: `openssl rand -hex 32` | Yes |
| `APP_URL` | Your site address, e.g. `https://myplug.vercel.app` (no trailing slash) | Yes |
| `CRON_SECRET` | Another random string (protects the daily job) | Yes |
| `RESEND_API_KEY` | From Resend → API Keys | For email |
| `EMAIL_FROM` | e.g. `MyPlug <no-reply@yourdomain.com>`, on a domain verified in Resend | For email |
| `REPORT_AUTO_HIDE_THRESHOLD` | Reports that auto-hide an image (default 3) | No |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Cloud Console → APIs & Services → Credentials → OAuth client ID (Web application) | For "Continue with Google" |
| `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` | developers.facebook.com → your app → Facebook Login (with the `email` permission) | For "Continue with Facebook" |

**Google and Facebook sign-in:** each button only appears once its keys are set. In each provider's settings,
add the redirect address `https://<your site>/auth/google/callback` (Google: *Authorised redirect URIs*) and
`https://<your site>/auth/facebook/callback` (Facebook: *Valid OAuth Redirect URIs*). They must match `APP_URL`
exactly. A Facebook app must be switched to **Live** before people outside your team can use it.

Without `RESEND_API_KEY`, no email is sent at all: password reset, order notices and alerts only appear in
the logs.

> **Never change `SESSION_SECRET` after launch** unless you mean to: it signs everyone out and makes the
> saved FTP password unreadable (you'd need to re-enter it).

## 5. Create the tables (from your computer)

1. Install Node.js 22+ and run `npm install` in the project folder.
2. In Neon (open it from Vercel → Storage → your database → **Open in Neon**), copy the connection string.
3. Create a file named `.env` in the project folder (it's git-ignored, never committed):

   ```
   DATABASE_URL="postgresql://...your Neon connection string..."
   ```

4. Run:

   ```bash
   npm run db:migrate
   ```

   This creates every table and the starting data: service and real estate categories, ad spots, boost
   bands, listing bands and default settings.

## 6. Create your admin account (no demo data)

In a normal terminal (the password prompt needs one):

```bash
npm run setup -- --email you@example.com --name "Your Name"
```

It asks for the password twice (at least 12 characters; it isn't shown or saved in your shell history).
It adds the product categories and **one admin account only**, with no demo shops or products. It's safe to
run again: it never changes an existing account.

> `npm run db:seed` fills the database with demo shops, products and customers. **Never run it against
> production.**

## 7. Deploy

1. In Vercel, open **Deployments**, then **⋯ → Redeploy** on the latest one (or push any commit to `main`).
2. Open your site and sign in with the admin account.

## 8. First-time admin settings

| Where | What |
| --- | --- |
| Admin → Boost bands & payment | Payment instructions (bank / mobile money) shown on every invoice |
| Admin → System settings | File storage (Blob or FTP), image optimisation, retention periods, analytics |
| Admin → Banner ads → Spots, prices & hero panel | Ad email, banner prices, ad-free price, hero panel |
| Admin → Listing bands | How many items each store plan allows, and prices |
| Admin → Merchants | Approve stores, set each store's currency and plan |
| Admin → Email alerts | Weekly alert limits for merchants |

## 9. Custom domain (optional)

1. Vercel → **Settings → Domains → Add**, follow the DNS instructions.
2. Change `APP_URL` to the new address and redeploy.

---

## The daily job

The Hobby plan allows **one scheduled run per day**, so `vercel.json` has one job: `/api/cron/daily` at
03:00 UTC (05:00 Malawi; Hobby may run it any time within that hour). Vercel calls it with
`Authorization: Bearer $CRON_SECRET`. It:

- creates today's repeat-order deliveries;
- archives inactive stores and deletes long-inactive ones (with warnings);
- archives sold property the next day and sold-out products, then deletes them after the retention period;
- tells merchants when property bidding has closed;
- sends any alert emails still waiting;
- rolls daily analytics into monthly summaries and deletes old detail.

To run it by hand: **Admin → System settings → Run the daily jobs now**.

On a **Pro** plan you can add a second job, `/api/cron/alerts` every 15 minutes, for faster large mailings:

```json
{ "path": "/api/cron/alerts", "schedule": "*/15 * * * *" }
```

---

## Updating the site later

1. Push the new code to `main`; Vercel deploys automatically.
2. If the update added a file in `drizzle/` (a migration), run against production, with the production
   `DATABASE_URL` in `.env`:

   ```bash
   npm run db:migrate
   ```

   Run it right before or right after the deploy. Migrations only add things, so running it early is safe.

## Rolling back

- **Code:** Vercel → Deployments → pick an earlier deployment → **⋯ → Promote to Production**.
- **Database:** Neon → **Branches / Restore**: restore to a point in time (the free tier keeps a short
  history). Restore into a new branch first if you're unsure.

## Backups

Neon keeps point-in-time history. For your own copy:

```bash
pg_dump "$DATABASE_URL" > myplug-backup-YYYY-MM-DD.sql
```

Images live in Blob or on your FTP server; back those up with your host's tools.

---

## Quick checklist

- [ ] Project imported in Vercel
- [ ] Neon connected (`DATABASE_URL`)
- [ ] Blob connected (`BLOB_READ_WRITE_TOKEN`) **or** FTP filled in after first deploy
- [ ] `SESSION_SECRET`, `APP_URL`, `CRON_SECRET` set
- [ ] `RESEND_API_KEY`, `EMAIL_FROM` set (domain verified in Resend)
- [ ] `npm run db:migrate` run against production
- [ ] `npm run setup -- --email ...` run (admin created)
- [ ] Redeployed, signed in as admin
- [ ] Payment instructions, storage, listing bands set

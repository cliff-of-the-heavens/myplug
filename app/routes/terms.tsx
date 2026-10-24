import { eq } from "drizzle-orm";
import { Form, Link, redirect, useNavigation } from "react-router";
import { Container, PageHeader } from "~/components/page";
import { Button } from "~/components/ui/button";
import { db, schema } from "~/db/client.server";
import { getUser, requireUser, safeRedirect } from "~/lib/auth.server";
import { TERMS_VERSION } from "~/lib/terms";
import type { Route } from "./+types/terms";

export const meta: Route.MetaFunction = () => [{ title: "Terms of Use · MyPlug" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await getUser(request);
  return { needsAccept: !!user && user.termsVersion !== TERMS_VERSION };
}

/** Records that the signed-in user accepts the current terms. */
export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();
  if (form.get("accept") !== "on") return { error: "Tick the box to accept the Terms of Use." };
  await db
    .update(schema.users)
    .set({ termsVersion: TERMS_VERSION, termsAcceptedAt: new Date() })
    .where(eq(schema.users.id, user.id));
  return redirect(safeRedirect(form.get("redirectTo"), "/"));
}

/** The terms themselves, shared by this page and the acceptance pop-up. */
function TermsText() {
  return (
    <div className="grid gap-5 text-sm leading-relaxed [&_h2]:text-base [&_h2]:font-bold [&_li]:ml-5 [&_li]:list-disc">
      <p className="rounded-xl bg-warning/20 p-3 font-medium">
        In short: MyPlug only connects customers, sellers, service providers and couriers. We don't sell, deliver or
        hold anyone's money, and we can't guarantee the people you deal with. You use MyPlug at your own risk. We help
        by verifying documents, providing pickup codes and removing bad actors, and we cooperate with the authorities
        when the law requires it.
      </p>

      <section>
        <h2>1. What MyPlug is</h2>
        <p>
          MyPlug is an online marketplace that lets people find each other. Every sale, booking, digital purchase and
          delivery is an agreement between the people involved (for example the customer and the seller, or the
          customer and the courier). MyPlug is not a party to those agreements. We are not the seller, delivery company,
          bank, escrow agent or insurer, and we offer no security or guarantee for any transaction.
        </p>
      </section>

      <section>
        <h2>2. Who can use MyPlug</h2>
        <ul>
          <li>You must be at least 18 and able to enter a binding agreement.</li>
          <li>Give accurate details and keep them up to date. One person, one account; keep your password private.</li>
          <li>
            Sellers and service providers must give their business registration number and may be asked for licences.
            Couriers must register with a photo and an identity document. We review these before approving accounts.
          </li>
        </ul>
      </section>

      <section>
        <h2>3. Risks you accept</h2>
        <ul>
          <li>
            You deal with other users at your own risk, including the risk of fraud, non-payment, non-delivery, wrong or
            faulty items, loss, theft, damage, misdelivery, or pickup by the wrong person.
          </li>
          <li>
            Tools such as "Registered business" badges, booking records, courier checks, pickup codes and secret phrases
            reduce risk but don't remove it. A badge only means we saw a document that looked valid when we checked it.
          </li>
          <li>
            Keep pickup codes and secret phrases private and only share them with the person you've sent. If you choose
            not to give a photo or ID for someone collecting for you, a wrong pickup is more likely.
          </li>
          <li>Check items, people and documents yourself before you pay or hand anything over.</li>
        </ul>
      </section>

      <section>
        <h2>4. Payments, refunds and disputes</h2>
        <ul>
          <li>
            Payments go directly between users (for example by bank transfer or mobile money). MyPlug doesn't receive or
            hold these payments, except fees for services we provide, such as adverts.
          </li>
          <li>
            Refunds, returns and cancellations are between you and the other party, under the seller's policy and the
            law. MyPlug may help by sharing the order record but isn't responsible for the outcome.
          </li>
          <li>Delivery fees agreed with couriers are paid to the courier by whoever the order shows as paying.</li>
        </ul>
      </section>

      <section>
        <h2>5. Sellers, service providers and couriers</h2>
        <ul>
          <li>
            List only items and services you're allowed to sell. Describe them honestly, honour confirmed orders and
            bookings, and keep your licences valid.
          </li>
          <li>
            You are responsible for your own taxes (including with the Malawi Revenue Authority), licences, insurance, and
            compliance with consumer protection law.
          </li>
          <li>Couriers are independent. They are not employed by MyPlug, and they are responsible for items in their care.</li>
          <li>
            Sellers of digital products confirm they own the rights to sell them. Buyers get a personal licence to view,
            listen to or download them under the option they bought, and may not copy, share or resell them.
          </li>
        </ul>
      </section>

      <section>
        <h2>6. Not allowed</h2>
        <p>
          Illegal, stolen or counterfeit goods; weapons, drugs and controlled substances; sexual content involving
          minors (always reported to the police); adult content; hate, harassment or threats; fake listings, reviews or
          documents; using MyPlug to take payments off-platform under false pretences; impersonation; and anything that
          breaks the law. We may remove content and suspend or close accounts that break these rules, without notice
          where necessary.
        </p>
      </section>

      <section>
        <h2>7. Your information</h2>
        <ul>
          <li>
            We collect what we need to run the marketplace: your account details, orders, messages, addresses, and for
            sellers and couriers, business and identity documents. We process it under Malawi's data protection law.
          </li>
          <li>
            We share only what each party needs. For example, a seller and courier see a delivery's address, recipient
            name and phone number. Sellers never see subscribers' email addresses.
          </li>
          <li>
            Identity documents and photos are visible only to MyPlug staff, and to the person handing over an item when
            they need to check who's collecting.
          </li>
          <li>Inactive stores are archived and later deleted as described on the site; sales records are kept as the law requires.</li>
          <li>
            We count visits to understand how MyPlug is used: pages viewed, which stores and listings are visited, and how long
            banner adverts are on screen and how often they're clicked. Visitors who aren't signed in get a random identifier
            stored in their browser; for signed-in users, store visits are linked to their account and seen only by MyPlug
            staff (never by sellers). Statistics are kept as daily totals and then monthly summaries, and detail is deleted
            after the periods set by MyPlug. Switch on "Do Not Track" in your browser and you won't be counted.
          </li>
        </ul>
      </section>

      <section>
        <h2>8. Working with the authorities</h2>
        <p>
          If the police, a court or a regulator requests it under the law, or where we believe it's needed to prevent
          fraud or harm, we will provide the information we hold. That includes account details, identity documents,
          order and delivery logs, and messages. We keep logs of pickups and confirmations for this purpose.
        </p>
      </section>

      <section>
        <h2>9. Liability</h2>
        <p>
          MyPlug is provided "as is". To the fullest extent allowed by law, MyPlug and its owners are not liable for any
          loss arising from transactions or contact between users, including fraud by another user, or from the site
          being unavailable. Where liability can't be excluded, it is limited to the fees you paid MyPlug in the three
          months before the claim. You agree to cover any claims against MyPlug caused by your breach of these terms or
          the law.
        </p>
      </section>

      <section>
        <h2>10. Changes and governing law</h2>
        <p>
          We may update these terms. You'll be asked to accept the new version before continuing to use MyPlug. These
          terms are governed by the laws of Malawi.
        </p>
      </section>
    </div>
  );
}

export default function Terms({ loaderData, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  return (
    <Container className="max-w-3xl py-8">
      <PageHeader title="Terms of Use" description={`Version ${TERMS_VERSION}`} />
      <TermsText />
      {loaderData.needsAccept ? (
        <Form method="post" className="mt-8 grid gap-3 rounded-2xl border-2 border-primary p-4">
          <label className="flex items-start gap-2 text-sm font-medium">
            <input type="checkbox" name="accept" required className="mt-0.5 size-4 accent-primary" />I have read and accept
            these Terms of Use, including that MyPlug is a linking platform and I use it at my own risk.
          </label>
          {actionData?.error ? <p className="text-sm text-destructive">{actionData.error}</p> : null}
          <Button type="submit" disabled={busy} className="justify-self-start">
            Accept and continue
          </Button>
        </Form>
      ) : (
        <p className="mt-8 text-sm text-muted-foreground">
          Questions? See our <Link to="/safety" className="font-semibold text-primary">community guidelines</Link>.
        </p>
      )}
    </Container>
  );
}

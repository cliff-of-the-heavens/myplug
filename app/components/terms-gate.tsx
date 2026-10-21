import { Form, Link, useLocation, useNavigation } from "react-router";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";

/** Asks a signed-in user to accept the current Terms of Use before carrying on (can't be dismissed). */
export function TermsGate() {
  const location = useLocation();
  const busy = useNavigation().formAction === "/terms";
  if (location.pathname === "/terms") return null; // the page itself has the accept form

  return (
    <Dialog open>
      <DialogContent
        className="[&>button:last-child]:hidden"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Our Terms of Use</DialogTitle>
          <DialogDescription>Please read and accept them to keep using MyPlug.</DialogDescription>
        </DialogHeader>
        <ul className="grid gap-1.5 text-sm [&_li]:ml-5 [&_li]:list-disc">
          <li>MyPlug only connects customers, sellers, service providers and couriers. It isn't a party to your deals.</li>
          <li>Payments go directly between users. MyPlug offers no guarantee, escrow or insurance.</li>
          <li>You accept the risks of dealing with other users, including fraud. MyPlug's owners aren't liable for them.</li>
          <li>We provide information to the authorities when the law requires it.</li>
        </ul>
        <Form method="post" action="/terms" className="grid gap-3">
          <input type="hidden" name="redirectTo" value={location.pathname + location.search} />
          <label className="flex items-start gap-2 text-sm font-medium">
            <input type="checkbox" name="accept" required className="mt-0.5 size-4 accent-primary" />
            <span>
              I have read and accept the{" "}
              <Link to="/terms" className="text-primary underline">
                full Terms of Use
              </Link>
              .
            </span>
          </label>
          <Button type="submit" disabled={busy}>
            Accept and continue
          </Button>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

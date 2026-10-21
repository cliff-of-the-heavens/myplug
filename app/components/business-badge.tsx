import { BadgeCheckIcon, FileTextIcon, InfoIcon } from "lucide-react";
import { formatDay } from "~/lib/dates";
import { cn } from "~/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";

export type BusinessInfo = {
  verified: boolean;
  registrationNumber: string | null;
  licenses: { id: string; kind: "primary" | "other"; name: string; number: string | null; issuer: string | null; issuedOn: string | null; expiresOn: string | null; hasDocument: boolean }[];
};

const d = (s: string) => formatDay(s, { day: "numeric", month: "short", year: "numeric" });

/** Green "Registered business" badge (or a neutral "Business info" link) that opens the business details. */
export function BusinessBadge({ storeName, info, className }: { storeName: string; info: BusinessInfo; className?: string }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
            info.verified ? "bg-success/15 text-success hover:bg-success/25" : "bg-muted text-muted-foreground hover:bg-muted/70",
            className,
          )}
        >
          {info.verified ? <BadgeCheckIcon className="size-4" /> : <InfoIcon className="size-3.5" />}
          {info.verified ? "Registered business" : "Business info"}
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {info.verified ? <BadgeCheckIcon className="size-6 text-success" /> : null} {storeName}
          </DialogTitle>
          <DialogDescription>
            {info.verified
              ? "MyPlug has checked this business's registration document, and it's within its validity dates."
              : "This business hasn't had a registration document verified by MyPlug yet. Take extra care."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-sm">
          <p>
            Registration number: <strong>{info.registrationNumber ?? "not provided"}</strong>
          </p>
          {info.licenses.length ? (
            <ul className="grid gap-2">
              {info.licenses.map((l) => (
                <li key={l.id} className="grid gap-0.5 rounded-xl border p-3">
                  <p className="flex items-center gap-1.5 font-semibold">
                    <BadgeCheckIcon className="size-4 text-success" /> {l.name}
                    {l.kind === "primary" ? <span className="text-xs font-normal text-muted-foreground">(primary)</span> : null}
                  </p>
                  <p className="text-muted-foreground">
                    {[l.number && `No. ${l.number}`, l.issuer && `issued by ${l.issuer}`, l.issuedOn && `on ${d(l.issuedOn)}`].filter(Boolean).join(" ")}
                  </p>
                  <p className="text-muted-foreground">{l.expiresOn ? `Valid until ${d(l.expiresOn)}` : "No expiry date"}</p>
                  {l.hasDocument ? (
                    <a href={`/files/license/${l.id}`} target="_blank" rel="noreferrer" className="flex w-fit items-center gap-1 font-semibold text-accent hover:underline">
                      <FileTextIcon className="size-4" /> View document
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">No licences are shown publicly.</p>
          )}
          <p className="text-xs text-muted-foreground">
            A badge reflects the documents MyPlug saw when it checked them. It isn't a guarantee: see our Terms of Use.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

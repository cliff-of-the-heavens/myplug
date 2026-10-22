import { CheckIcon, CopyIcon, MailIcon, Share2Icon, SmartphoneIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "~/lib/utils";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Input } from "./ui/input";

/**
 * Share a page (a product, a store, a gift coupon) with friends: the phone's own share sheet
 * when available, plus WhatsApp, Facebook, X, email and copy link.
 */
export function ShareButton({
  path,
  title,
  text,
  label = "Share",
  variant = "outline",
  className,
}: {
  path: string;
  title: string;
  text?: string;
  label?: string;
  variant?: "outline" | "ghost" | "secondary" | "default";
  className?: string;
}) {
  const [url, setUrl] = useState(path);
  const [copied, setCopied] = useState(false);
  const [canNativeShare, setCanNativeShare] = useState(false);

  useEffect(() => {
    setUrl(new URL(path, window.location.origin).toString());
    setCanNativeShare(typeof navigator.share === "function");
  }, [path]);

  const message = text ? `${text} ${url}` : `${title} ${url}`;
  const links = [
    { name: "WhatsApp", href: `https://wa.me/?text=${encodeURIComponent(message)}`, tone: "bg-[#25d366] text-white" },
    { name: "Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, tone: "bg-[#1877f2] text-white" },
    { name: "X", href: `https://x.com/intent/post?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text ?? title)}`, tone: "bg-foreground text-background" },
  ];

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the link is selectable in the box instead.
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant={variant} size="sm" className={className}>
          <Share2Icon /> {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share</DialogTitle>
          <DialogDescription className="line-clamp-2">{title}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {canNativeShare ? (
            <Button onClick={() => navigator.share({ title, text, url }).catch(() => {})}>
              <SmartphoneIcon /> Share from this device
            </Button>
          ) : null}
          <div className="grid grid-cols-3 gap-2">
            {links.map((l) => (
              <a key={l.name} href={l.href} target="_blank" rel="noreferrer" className={cn("rounded-full px-3 py-2 text-center text-sm font-semibold", l.tone)}>
                {l.name}
              </a>
            ))}
          </div>
          <a href={`mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(message)}`} className="flex items-center justify-center gap-2 rounded-full border-2 px-3 py-2 text-sm font-semibold hover:bg-muted">
            <MailIcon className="size-4" /> Email
          </a>
          <div className="flex gap-2">
            <Input value={url} readOnly onFocus={(e) => e.currentTarget.select()} className="h-9" />
            <Button type="button" variant="outline" size="sm" onClick={copy}>
              {copied ? <CheckIcon /> : <CopyIcon />} {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

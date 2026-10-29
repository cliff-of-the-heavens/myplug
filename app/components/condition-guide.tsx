import { InfoIcon } from "lucide-react";
import { useState } from "react";
import { conditionInfo, ITEM_CONDITIONS, type ItemCondition } from "~/lib/condition";
import { cn } from "~/lib/utils";
import { Badge } from "./ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";

/**
 * Pop-up explaining every item condition. Customers read what each one means; merchants
 * ("seller") also get advice on which to choose. The item's own condition is highlighted.
 */
export function ConditionGuide({
  current,
  audience,
  children,
}: {
  current?: ItemCondition | null;
  audience: "buyer" | "seller";
  children: React.ReactNode;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Item conditions</DialogTitle>
          <DialogDescription>
            {audience === "seller"
              ? "Choose the condition a buyer would agree with on first look. If you're unsure between two, pick the lower one, and show any wear or fault in your photos and description."
              : "What each condition on MyPlug means. If an item arrives in worse condition than described, message the seller first, then report the listing."}
          </DialogDescription>
        </DialogHeader>
        <dl className="grid gap-2">
          {ITEM_CONDITIONS.map((c) => (
            <div key={c.value} className={cn("grid gap-1 rounded-xl border p-3", c.value === current && "border-primary bg-primary/5")}>
              <dt className="flex items-center gap-2">
                <Badge variant={c.tone}>{c.label}</Badge>
                {c.value === current ? <span className="text-xs font-semibold text-primary">{audience === "seller" ? "Your choice" : "This item"}</span> : null}
              </dt>
              <dd className="text-sm">{c.meaning}</dd>
              {audience === "seller" ? <dd className="text-xs text-muted-foreground">When to use it: {c.tip}</dd> : null}
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}

/** Small round "i" that opens the guide. */
export function ConditionInfoButton({ current, audience, className }: { current?: ItemCondition | null; audience: "buyer" | "seller"; className?: string }) {
  return (
    <ConditionGuide current={current} audience={audience}>
      <button
        type="button"
        aria-label="What the item conditions mean"
        title="What the item conditions mean"
        className={cn("inline-flex size-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-primary", className)}
      >
        <InfoIcon className="size-4" />
      </button>
    </ConditionGuide>
  );
}

/** The item's condition with its meaning one tap away (product page). */
export function ConditionBadge({ condition }: { condition: ItemCondition }) {
  const c = conditionInfo(condition);
  return (
    <span className="inline-flex items-center gap-0.5">
      <Badge variant={c.tone} title={c.meaning}>
        {c.label}
      </Badge>
      <ConditionInfoButton current={condition} audience="buyer" />
    </span>
  );
}

/** Listing form: the merchant picks the item's condition, with the full guide in a pop-up. */
export function ConditionField({ initial }: { initial: ItemCondition | null }) {
  const [value, setValue] = useState<ItemCondition | "">(initial ?? "");
  const options: { value: ItemCondition | ""; label: string; text: string }[] = [
    ...ITEM_CONDITIONS.map((c) => ({ value: c.value, label: c.label, text: c.meaning })),
    { value: "", label: "Doesn't apply", text: "Food, fresh produce and other things that aren't new or used." },
  ];
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1.5 flex w-full flex-wrap items-center gap-x-2 text-sm font-semibold">
        Condition
        <ConditionGuide current={value || null} audience="seller">
          <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
            <InfoIcon className="size-3.5" /> Which one should I choose?
          </button>
        </ConditionGuide>
      </legend>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {options.map((o) => (
          <label
            key={o.value || "none"}
            className={cn(
              "flex cursor-pointer gap-2 rounded-xl border-2 p-3 text-sm transition-colors",
              value === o.value ? "border-primary bg-primary/5" : "hover:border-primary/40",
            )}
          >
            <input type="radio" name="condition" value={o.value} checked={value === o.value} onChange={() => setValue(o.value)} className="mt-0.5 accent-primary" />
            <span className="grid">
              <span className="font-semibold">{o.label}</span>
              <span className="text-xs text-muted-foreground">{o.text}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

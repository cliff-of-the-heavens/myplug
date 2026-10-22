import { useEffect, useState } from "react";
import { Input } from "./ui/input";

/** "YYYY-MM-DDTHH:mm" in the browser's time zone, for a datetime-local input. */
export function toLocalInput(d: Date | string | null | undefined) {
  if (!d) return "";
  const x = new Date(d);
  return new Date(x.getTime() - x.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

/**
 * A date-and-time picker that submits an exact moment (ISO, with time zone) as `name`.
 * A plain datetime-local value has no time zone, so a server running in UTC would read
 * 23:59 in Lilongwe as 23:59 UTC, two hours late.
 */
export function DateTimeField({
  name,
  value,
  defaultValue,
  onChange,
  required,
  className,
}: {
  name: string;
  value?: string; // controlled: local "YYYY-MM-DDTHH:mm"
  defaultValue?: Date | string | null;
  onChange?: (local: string) => void;
  required?: boolean;
  className?: string;
}) {
  const [inner, setInner] = useState(() => toLocalInput(defaultValue));
  const local = value ?? inner;
  const [iso, setIso] = useState("");
  useEffect(() => setIso(local ? new Date(local).toISOString() : ""), [local]);
  return (
    <>
      <Input
        type="datetime-local"
        value={local}
        required={required}
        className={className}
        onChange={(e) => (onChange ? onChange(e.target.value) : setInner(e.target.value))}
      />
      <input type="hidden" name={name} value={iso} />
    </>
  );
}

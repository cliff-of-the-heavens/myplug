import { useEffect, useRef, useState } from "react";
import { Input } from "./ui/input";

const LENGTH = 6;
const empty = () => Array<string>(LENGTH).fill("");

/**
 * One box per digit, each showing a dash until it's filled. The whole code is submitted as `name`.
 * Pasting, or a phone offering the code from a message, fills every box. Pass `resetOn` the form's
 * result to clear the boxes after each attempt.
 */
export function CodeInput({ name = "code", autoFocus, resetOn }: { name?: string; autoFocus?: boolean; resetOn?: unknown }) {
  const [digits, setDigits] = useState(empty);
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const focus = (i: number) => boxes.current[Math.max(0, Math.min(LENGTH - 1, i))]?.focus();

  useEffect(() => {
    if (resetOn === undefined) return;
    setDigits(empty());
    if (autoFocus) focus(0);
  }, [resetOn]); // eslint-disable-line react-hooks/exhaustive-deps

  function fill(start: number, text: string) {
    const chars = text.replace(/\D/g, "").slice(0, LENGTH - start).split("");
    if (!chars.length) return;
    setDigits((d) => d.map((c, i) => chars[i - start] ?? c));
    focus(start + chars.length);
  }

  function clear(i: number) {
    setDigits((d) => d.map((c, j) => (j === i ? "" : c)));
  }

  return (
    <div className="mx-auto grid w-full max-w-xs grid-cols-6 gap-2">
      <input type="hidden" name={name} value={digits.join("")} />
      {digits.map((digit, i) => (
        <Input
          key={i}
          ref={(el) => {
            boxes.current[i] = el;
          }}
          value={digit}
          placeholder="-"
          aria-label={`Digit ${i + 1} of ${LENGTH}`}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          autoFocus={autoFocus && i === 0}
          required
          className="h-12 px-0 text-center text-lg font-bold"
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            const value = e.target.value.replace(/\D/g, "");
            if (!value) clear(i);
            // Typed next to the digit already in this box: the new digit replaces it.
            else if (digit && value.length === 2) fill(i, value.replace(digit, "") || digit);
            else fill(i, value);
          }}
          onPaste={(e) => {
            e.preventDefault();
            fill(0, e.clipboardData.getData("text"));
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") focus(i - 1);
            else if (e.key === "ArrowRight") focus(i + 1);
            else if (e.key === "Backspace" && !digit && i > 0) {
              e.preventDefault();
              clear(i - 1);
              focus(i - 1);
            }
          }}
        />
      ))}
    </div>
  );
}

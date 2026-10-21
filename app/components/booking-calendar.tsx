import { addDays, formatDay, weekday, type DateStr } from "~/lib/dates";
import { cn } from "~/lib/utils";

export type DayAvailability = { day: DateStr; booked: number };

/**
 * Public availability for a service: which days are free, partly booked or full.
 * Shows counts only, never who booked. Clicking a free day selects it.
 */
export function AvailabilityCalendar({
  days,
  capacity,
  selected,
  onSelect,
}: {
  days: DayAvailability[];
  capacity: number;
  selected?: DateStr | null;
  onSelect?: (day: DateStr) => void;
}) {
  if (!days.length) return null;
  // Pad the first week so columns line up Monday → Sunday.
  const pad = (weekday(days[0].day) + 6) % 7;
  const cells: (DayAvailability | null)[] = [...Array.from({ length: pad }, () => null), ...days];

  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-muted-foreground">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((c, i) => {
          if (!c) return <span key={`pad-${i}`} />;
          const full = c.booked >= capacity;
          const isFirstOfMonth = c.day.endsWith("-01") || i === pad;
          return (
            <button
              key={c.day}
              type="button"
              disabled={full || !onSelect}
              onClick={() => onSelect?.(c.day)}
              title={`${formatDay(c.day, { weekday: "long", day: "numeric", month: "long" })}: ${full ? "fully booked" : capacity > 1 ? `${capacity - c.booked} of ${capacity} slots free` : "available"}`}
              className={cn(
                "relative flex aspect-square flex-col items-center justify-center rounded-lg border text-xs font-semibold transition-colors",
                full
                  ? "cursor-not-allowed border-transparent bg-destructive/10 text-destructive line-through"
                  : c.booked
                    ? "border-warning/40 bg-warning/15 hover:border-primary"
                    : "bg-success/10 text-success hover:border-primary",
                selected === c.day && "border-2 border-primary bg-primary text-primary-foreground no-underline",
              )}
            >
              {isFirstOfMonth ? <span className="text-[9px] font-normal opacity-80">{formatDay(c.day, { month: "short" })}</span> : null}
              {Number(c.day.slice(8))}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="size-3 rounded bg-success/30" /> Available</span>
        {capacity > 1 ? <span className="flex items-center gap-1"><span className="size-3 rounded bg-warning/40" /> Some slots left</span> : null}
        <span className="flex items-center gap-1"><span className="size-3 rounded bg-destructive/30" /> Fully booked</span>
      </div>
    </div>
  );
}

/** Every day from `from` for `count` days, with booked counts filled in. */
export function availabilityRange(from: DateStr, count: number, booked: Map<string, number>): DayAvailability[] {
  return Array.from({ length: count }, (_, i) => {
    const day = addDays(from, i);
    return { day, booked: booked.get(day) ?? 0 };
  });
}

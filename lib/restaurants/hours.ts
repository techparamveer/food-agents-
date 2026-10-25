import type { OpeningPeriod } from "@/lib/restaurants/types";

const WEEK = 7 * 24 * 60;
const DAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const londonParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Minutes since Sunday 00:00 in Oxford local time. */
export function weekMinute(date: Date): number {
  const parts = Object.fromEntries(londonParts.formatToParts(date).map((p) => [p.type, p.value]));
  return (DAYS[parts.weekday ?? "Sun"] ?? 0) * 1440 + Number(parts.hour) * 60 + Number(parts.minute);
}

/**
 * Is the place open at `date`? Handles periods that run past midnight and Saturday→Sunday wrap.
 * Returns null when hours are unknown, so callers can decide how strict to be.
 */
export function isOpenAt(periods: OpeningPeriod[] | undefined, date: Date): boolean | null {
  if (!periods?.length) return null;
  const now = weekMinute(date);
  for (const { open, close } of periods) {
    if (!close) return true;
    const start = open.day * 1440 + open.minutes;
    let end = close.day * 1440 + close.minutes;
    if (end <= start) end += WEEK;
    if ((now >= start && now < end) || (now + WEEK >= start && now + WEEK < end)) return true;
  }
  return false;
}

/** Same hours every day: `daily(12 * 60, 22 * 60)`. Close past midnight is fine (`daily(18*60, 26*60)`). */
export function daily(openMinutes: number, closeMinutes: number, days = [0, 1, 2, 3, 4, 5, 6]): OpeningPeriod[] {
  return days.map((day) => ({
    open: { day, minutes: openMinutes },
    close: { day: (day + Math.floor(closeMinutes / 1440)) % 7, minutes: closeMinutes % 1440 },
  }));
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** "Monday: 12:00–14:30, 17:30–22:00", Monday first like Google's weekdayDescriptions. */
export function describeHours(periods: OpeningPeriod[]): string[] {
  return [1, 2, 3, 4, 5, 6, 0].map((day) => {
    const today = periods.filter((p) => p.open.day === day).sort((a, b) => a.open.minutes - b.open.minutes);
    if (!today.length) return `${DAY_NAMES[day]}: Closed`;
    const spans = today.map((p) => (p.close ? `${hhmm(p.open.minutes)}–${hhmm(p.close.minutes)}` : "Open 24 hours"));
    return `${DAY_NAMES[day]}: ${spans.join(", ")}`;
  });
}

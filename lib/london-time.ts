/* Wall-clock helpers for Europe/London. Comeda stores instants as ISO strings and shows London time,
   so slot generation and countdowns work the same on a UTC server and a BST browser. */

const ZONE = "Europe/London";

const parts = new Intl.DateTimeFormat("en-GB", {
  timeZone: ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** London wall-clock parts of an instant. */
export function londonParts(at: Date | string) {
  const date = typeof at === "string" ? new Date(at) : at;
  const get = (type: string) => Number(parts.formatToParts(date).find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

/** "YYYY-MM-DD" of the London day an instant falls on. */
export function londonDay(at: Date | string) {
  const p = londonParts(at);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** "HH:MM" in London. */
export function londonClock(at: Date | string) {
  const p = londonParts(at);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** The instant London's clocks read `day` at `hh:mm`. Handles BST by measuring the offset at that moment. */
export function londonInstant(day: string, hh: number, mm: number): Date {
  const [y, m, d] = day.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const seen = londonParts(new Date(guess));
  const offset = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute) - guess;
  return new Date(guess - offset);
}

/** The London day after `day`. */
export function nextDay(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** ISO without milliseconds, e.g. "2026-11-07T12:30:00Z". */
export function iso(at: Date) {
  return at.toISOString().replace(".000Z", "Z");
}

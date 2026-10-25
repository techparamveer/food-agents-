import { londonClock } from "@/lib/london-time";
import type { Estimate } from "@/lib/types";

/* Order deadlines. Order-by = slot time − restaurant prep − delivery travel, so
   "order by 17:40 for 18:30 dinner" means 20 minutes' prep and a 30-minute ride. */

const MINUTE = 60_000;

/** Latest instant to place an order so food lands at `servesAt`. */
export function orderBy(servesAt: string, prepMinutes: number, deliveryMinutes: number): string {
  const lead = Math.max(0, Math.round(prepMinutes)) + Math.max(0, Math.round(deliveryMinutes));
  return new Date(new Date(servesAt).getTime() - lead * MINUTE).toISOString().replace(".000Z", "Z");
}

export type CountdownTone = "overdue" | "urgent" | "soon" | "ok";

export type Countdown = {
  /** Whole minutes left; negative once the deadline has passed. */
  minutes: number;
  /** "2d 4h", "3h 05m", "12m", "Overdue 5m". */
  label: string;
  tone: CountdownTone;
};

/** Time left until `deadline` from `now` (ms or ISO). Rounds down so the label never promises more than there is. */
export function countdown(now: number | string, deadline: string): Countdown {
  const from = typeof now === "string" ? new Date(now).getTime() : now;
  const ms = new Date(deadline).getTime() - from;
  const minutes = ms >= 0 ? Math.floor(ms / MINUTE) : -Math.ceil(-ms / MINUTE);
  const tone: CountdownTone = ms < 0 ? "overdue" : minutes < 60 ? "urgent" : minutes < 180 ? "soon" : "ok";
  return { minutes, label: duration(minutes), tone };
}

function duration(minutes: number): string {
  if (minutes < 0) return `Overdue ${duration(-minutes)}`;
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m`;
}

/** "25–40 min" when the source gave a range, else "35 min". Deadlines use the upper bound (`value`). */
export function minutesLabel(e: Pick<Estimate, "value" | "range">) {
  return e.range && e.range.low !== e.range.high ? `${Math.round(e.range.low)}–${Math.round(e.range.high)} min` : `${Math.round(e.value)} min`;
}

/** "Order by 17:40 for 18:30 dinner". */
export function deadlineLine(orderByAt: string, servesAt: string, meal: string) {
  return `Order by ${londonClock(orderByAt)} for ${londonClock(servesAt)} ${meal.toLowerCase()}`;
}

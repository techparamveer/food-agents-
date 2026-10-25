import { londonClock } from "@/lib/london-time";

/* Order deadlines. Order-by = slot time − restaurant prep − delivery travel, so
   "order by 17:40 for 18:30 dinner" means 20 minutes' prep and a 30-minute ride. */

const MINUTE = 60_000;

/** Latest instant to place an order so food lands at `servesAt`. */
export function orderBy(servesAt: string, prepMinutes: number, deliveryMinutes: number): string {
  const lead = Math.max(0, Math.round(prepMinutes)) + Math.max(0, Math.round(deliveryMinutes));
  return new Date(new Date(servesAt).getTime() - lead * MINUTE).toISOString().replace(".000Z", "Z");
}

export type CountdownTone = "overdue" | "urgent" | "soon" | "ok";

export type DeadlineWindowPhase = "before" | "active" | "ended";

export type Countdown = {
  /** Whole minutes left; negative once the deadline has passed. */
  minutes: number;
  /** "2d 4h", "3h 05m", "12m", "Overdue 5m". */
  label: string;
  tone: CountdownTone;
};

/** Whether order deadlines should be shown for an event. The start is inclusive; the end is not. */
export function deadlineWindowPhase(now: number | string, startsAt: string, endsAt: string): DeadlineWindowPhase {
  const current = typeof now === "string" ? new Date(now).getTime() : now;
  if (current < new Date(startsAt).getTime()) return "before";
  if (current >= new Date(endsAt).getTime()) return "ended";
  return "active";
}

/** Time left until `deadline` from `now` (ms or ISO). Rounds down so the label never promises more than there is. */
export function countdown(now: number | string, deadline: string): Countdown {
  const from = typeof now === "string" ? new Date(now).getTime() : now;
  const ms = new Date(deadline).getTime() - from;
  const minutes = ms >= 0 ? Math.floor(ms / MINUTE) : -Math.ceil(-ms / MINUTE);
  const tone: CountdownTone = ms < 0 ? "overdue" : minutes < 60 ? "urgent" : minutes < 180 ? "soon" : "ok";
  return { minutes, label: duration(minutes), tone };
}

/** Sentence-friendly difference between two instants: "in 53 min", "in 6 h 10 min", "in 2 d 4 h 15 min", or "passed". */
export function deadlineApproximation(now: number | string, deadline: string): string {
  const { minutes } = countdown(now, deadline);
  if (minutes <= 0) return "passed";
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  if (d > 0) return `in ${d} d${h ? ` ${h} h` : ""}${m ? ` ${m} min` : ""}`;
  if (h > 0) return m ? `in ${h} h ${m} min` : `in ${h} h`;
  return `in ${m} min`;
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

/** "Order by 17:40 for 18:30 dinner". */
export function deadlineLine(orderByAt: string, servesAt: string, meal: string) {
  return `Order by ${londonClock(orderByAt)} for ${londonClock(servesAt)} ${meal.toLowerCase()}`;
}

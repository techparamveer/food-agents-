import type { MealLog, MealSlot } from "@/lib/types";

/* Meal allowance at the food table. Pure: the caller passes the clock and the logs,
   so the same rules run in the scanner, the attendee list and the tests. */

/** Per-slot rules. Organisers can change these in the meal check settings. */
export type SlotRules = {
  /** Servings each attendee may collect once the table opens. */
  servings: number;
  /** Minutes after the slot starts when seconds open. `null` means no seconds. */
  secondsAfterMinutes: number | null;
  /** Extra servings allowed once seconds open. */
  seconds: number;
  /** The table opens this many minutes before the slot starts. */
  opensBeforeMinutes: number;
  /** The table closes this many minutes after the slot starts. */
  closesAfterMinutes: number;
};

const BY_KIND: Record<MealSlot["kind"], Omit<SlotRules, "servings">> = {
  breakfast: { secondsAfterMinutes: 30, seconds: 1, opensBeforeMinutes: 15, closesAfterMinutes: 90 },
  lunch: { secondsAfterMinutes: 30, seconds: 1, opensBeforeMinutes: 15, closesAfterMinutes: 90 },
  dinner: { secondsAfterMinutes: 30, seconds: 1, opensBeforeMinutes: 15, closesAfterMinutes: 120 },
  snack: { secondsAfterMinutes: 20, seconds: 1, opensBeforeMinutes: 10, closesAfterMinutes: 60 },
};

/** One serving by default (the slot's `allowance`), seconds 30 minutes in. */
export function defaultRules(slot: MealSlot): SlotRules {
  return { servings: Math.max(0, slot.allowance), ...BY_KIND[slot.kind] };
}

export type BlockCode = "not-open" | "closed" | "used" | "seconds-later";

export type Allowance = {
  ok: boolean;
  /** Servings this attendee has collected in this slot. */
  eaten: number;
  /** Servings allowed right now, including seconds if they're open. */
  limit: number;
  /** Servings left right now. */
  remaining: number;
  /** Most servings possible in this slot once seconds open. */
  max: number;
  /** When seconds open (ISO), or null if this slot has none. */
  secondsAt: string | null;
  secondsOpen: boolean;
  /** Set when blocked. */
  reason?: { code: BlockCode; text: string };
};

const MINUTE = 60_000;

const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
export const formatTime = (iso: string | number) => clock.format(new Date(iso));

export function slotWindow(slot: MealSlot, rules: SlotRules) {
  const start = Date.parse(slot.servesAt);
  return {
    opensAt: start - rules.opensBeforeMinutes * MINUTE,
    closesAt: start + rules.closesAfterMinutes * MINUTE,
    secondsAt: rules.secondsAfterMinutes === null || rules.seconds <= 0 ? null : start + rules.secondsAfterMinutes * MINUTE,
  };
}

/** Can this attendee collect another serving from this slot at `now`? */
export function checkAllowance({
  slot,
  rules,
  logs,
  attendeeId,
  now,
}: {
  slot: MealSlot;
  rules: SlotRules;
  /** Any logs: only this attendee's logs for this slot are counted. */
  logs: readonly MealLog[];
  attendeeId: string;
  now: string | number;
}): Allowance {
  const t = typeof now === "number" ? now : Date.parse(now);
  const eaten = countEaten(logs, slot.id, attendeeId);
  const win = slotWindow(slot, rules);
  const secondsOpen = win.secondsAt !== null && t >= win.secondsAt;
  const max = rules.servings + (win.secondsAt === null ? 0 : rules.seconds);
  const limit = secondsOpen ? max : rules.servings;
  const remaining = Math.max(0, limit - eaten);
  const base = { eaten, limit, remaining, max, secondsOpen, secondsAt: win.secondsAt === null ? null : new Date(win.secondsAt).toISOString() };

  const block = (code: BlockCode, text: string): Allowance => ({ ...base, ok: false, remaining: 0, reason: { code, text } });

  if (t < win.opensAt) return block("not-open", `${slot.label} opens at ${formatTime(win.opensAt)}`);
  if (t >= win.closesAt) return block("closed", `${slot.label} closed at ${formatTime(win.closesAt)}`);
  if (remaining > 0) return { ...base, ok: true };
  if (win.secondsAt !== null && !secondsOpen) return block("seconds-later", `Already collected. Seconds open at ${formatTime(win.secondsAt)}`);
  return block("used", eaten === 1 ? "Already collected this meal" : `Already collected ${eaten} servings`);
}

export function countEaten(logs: readonly MealLog[], slotId: string, attendeeId: string) {
  let n = 0;
  for (const log of logs) if (log.slotId === slotId && log.attendeeId === attendeeId) n++;
  return n;
}

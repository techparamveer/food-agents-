import { iso, londonDay, londonInstant, londonParts, nextDay } from "@/lib/london-time";
import { proposeSlots, type PlannerInput } from "@/lib/planner";
import type { Dietary, Event, MealSlot } from "@/lib/types";

/* Reads a planner request out of plain English, e.g. "feed 150, 20 vegan, by 7pm under £600".
   The chat uses it when Gemini isn't configured, and to check the numbers Gemini passes to tools. */

export type FoodRequest = {
  headcount?: number;
  budget?: number;
  /** Head counts per need ("20 vegan"). */
  dietaryCounts: Partial<Record<Dietary, number>>;
  /** Shares per need ("15% veg"), 0–1. */
  dietaryShares: Partial<Record<Dietary, number>>;
  /** London wall-clock time food must arrive by, "HH:MM". */
  by?: string;
  /** Asked about the whole event rather than one meal. */
  wholeEvent: boolean;
  /** Needs named without a number ("who does vegan and halal?"). */
  mentions: Dietary[];
};

const NEEDS: [RegExp, Dietary][] = [
  [/^vegans?$/, "vegan"],
  [/^(veg|veggie|veggies|vegetarians?)$/, "veg"],
  [/^halal$/, "halal"],
  [/^(gf|gluten[- ]?free|coeliacs?)$/, "gf"],
];

function needFor(word: string): Dietary | undefined {
  const w = word.toLowerCase();
  return NEEDS.find(([re]) => re.test(w))?.[1];
}

function money(amount: string, suffix?: string) {
  const n = Number(amount.replace(/,/g, ""));
  return suffix?.toLowerCase() === "k" ? n * 1000 : n;
}

export function parseFoodRequest(message: string): FoodRequest {
  const text = message.replace(/ /g, " ");
  const out: FoodRequest = { dietaryCounts: {}, dietaryShares: {}, wholeEvent: false, mentions: [] };

  const budget =
    text.match(/£\s*([\d,]+(?:\.\d+)?)\s*(k)?\b/i) ?? text.match(/\b([\d,]+(?:\.\d+)?)\s*(k)?\s*(?:pounds|gbp|quid)\b/i);
  if (budget) out.budget = money(budget[1], budget[2]);

  for (const m of text.matchAll(/\b(\d+(?:\.\d+)?)\s*(%|percent)?\s*(?:are\s+|is\s+)?(vegans?|veg(?:etarians?|gies?|gie)?|halal|gf|gluten[- ]?free|coeliacs?)\b/gi)) {
    const need = needFor(m[3]);
    if (!need) continue;
    if (m[2]) out.dietaryShares[need] = Number(m[1]) / 100;
    else out.dietaryCounts[need] = Number(m[1]);
  }

  const head =
    text.match(/\b(?:feed|feeding|cater(?:ing)?(?:\s+for)?|for)\s+(\d[\d,]*)\b(?!\s*(?:%|percent|vegan|veg|halal|gf|gluten|pm|am|:))/i) ??
    text.match(/\b(\d[\d,]*)\s*(?:people|persons|attendees|hackers|guests|students|ppl|heads)\b/i);
  if (head) out.headcount = Number(head[1].replace(/,/g, ""));

  const time = text.match(/\b(?:by|at|for|before)\s+(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b/i) ?? text.match(/\b(?:by|at|before)\s+(\d{1,2})[:.](\d{2})\b/);
  if (time) {
    let h = Number(time[1]) % 24;
    const meridiem = time[3]?.toLowerCase();
    if (meridiem === "pm" && h < 12) h += 12;
    if (meridiem === "am" && h === 12) h = 0;
    out.by = `${String(h).padStart(2, "0")}:${time[2] ?? "00"}`;
  }
  // "tomorrow's breakfast" means the usual breakfast time.
  const meal = text.match(/\b(breakfast|brunch|lunch|dinner|supper|midnight snack|late snack)\b/i)?.[1].toLowerCase();
  if (!out.by && meal) out.by = meal === "breakfast" || meal === "brunch" ? "08:30" : meal === "lunch" ? "12:30" : meal.includes("snack") ? "00:00" : "18:30";

  for (const m of text.matchAll(/\b(vegans?|veg(?:etarians?|gies?|gie)?|halal|gf|gluten[- ]?free|coeliacs?)\b/gi)) {
    const need = needFor(m[1]);
    if (need && !out.mentions.includes(need)) out.mentions.push(need);
  }

  out.wholeEvent = /\b(whole|entire|full)\s+(event|weekend|hackathon)\b|\bevery meal\b|\ball (the )?meals\b|\bweekend\b|\bget it done\b/i.test(text);
  return out;
}

/** True when the message reads like a request to plan food rather than a question. */
export function looksLikePlanRequest(req: FoodRequest) {
  return Boolean(req.headcount || req.budget || req.by || req.wholeEvent || Object.keys(req.dietaryCounts).length);
}

/* ---------- Request → planner input ---------- */

const MEAL_BY_HOUR = (h: number): MealSlot["kind"] => (h < 4 ? "snack" : h < 11 ? "breakfast" : h < 16 ? "lunch" : h < 22 ? "dinner" : "snack");
const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "Europe/London" });

/** A single meal reads like "by 7pm", or a budget too small for a whole weekend (under £15 a head). */
export function isSingleMeal(req: FoodRequest, event: Pick<Event, "headcount">) {
  if (req.wholeEvent) return false;
  if (req.by) return true;
  return req.budget !== undefined && req.budget / (req.headcount ?? event.headcount) < 15;
}

/** The next time London's clocks read `hh:mm`, at or after `now`. */
export function nextAt(by: string, now: string) {
  const [h, m] = by.split(":").map(Number);
  let day = londonDay(now);
  let at = londonInstant(day, h, m);
  if (at.getTime() < new Date(now).getTime()) {
    day = nextDay(day);
    at = londonInstant(day, h, m);
  }
  return at;
}

/** Turns a request into planner input. Anything the organiser didn't say comes from the event. */
export function plannerInputFor(req: FoodRequest, event: Event, now: string): PlannerInput {
  const headcount = req.headcount ?? event.headcount;
  const dietaryMix = { ...event.dietaryMix, ...req.dietaryShares };
  const dietaryCounts = Object.keys(req.dietaryCounts).length ? req.dietaryCounts : undefined;
  const base = { eventId: event.id, headcount, dietaryMix, dietaryCounts, startsAt: event.startsAt, endsAt: event.endsAt };

  if (!isSingleMeal(req, event)) return { ...base, budget: req.budget ?? event.budget };

  const at = nextAt(req.by ?? "18:30", now);
  const kind = MEAL_BY_HOUR(londonParts(at).hour);
  const slot: MealSlot = {
    id: `slot-${londonDay(at)}-${kind}-custom`,
    eventId: event.id,
    label: `${weekday.format(at)} ${kind === "snack" ? "snack" : kind}`,
    kind,
    servesAt: iso(at),
    headcount,
    allowance: 1,
  };
  const perMeal = event.budget / Math.max(1, proposeSlots(event).length);
  return { ...base, budget: req.budget ?? Math.round(perMeal), slots: [slot] };
}

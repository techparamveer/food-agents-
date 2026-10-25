import type { BlockCode, SlotRules } from "@/lib/allowance";
import { initialsAvatar } from "@/lib/avatar";
import type { Json, TablesInsert, TablesUpdate } from "@/lib/supabase/database.types";
import type { AttendeeRow, EventRow, MealLogRow, Member, MemberRow, OrderRow, PlanRow, SlotRow } from "@/lib/db/types";
import {
  DIETARY,
  ORDER_STATUSES,
  type Attendee,
  type DeliveryPlatform,
  type Dietary,
  type DietaryMix,
  type EstimateSource,
  type Event,
  type EventData,
  type MealLog,
  type MealSlot,
  type Order,
  type OrderLine,
  type Plan,
  type PlanSlot,
  type Restaurant,
} from "@/lib/types";

/* Database rows ↔ the domain types in lib/types.ts, which the dashboard, planner and meal check
   already use. Pure functions (no client), so scripts/test-db-mappers.ts runs them directly.
   Timestamps come back from PostgREST as "2026-11-14T13:00:00+00:00"; the domain uses ISO "Z". */

export const DEFAULT_TIME_ZONE = "Europe/London";
export const DEFAULT_CURRENCY = "GBP";

const iso = (at: string) => new Date(at).toISOString();
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const DIETARY_IDS = DIETARY.map((d) => d.id);
export const isDietary = (v: unknown): v is Dietary => DIETARY_IDS.includes(v as Dietary);
export const PLATFORMS: DeliveryPlatform[] = ["deliveroo", "ubereats", "justeat", "direct"];

/* ---------- Events ---------- */

/** A dietary mix from JSON: each known need as a share 0–1, missing or bad values as 0. */
export function dietaryMixFromJson(json: Json | unknown): DietaryMix {
  const obj = isObject(json) ? json : {};
  const share = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
  return { veg: share(obj.veg), vegan: share(obj.vegan), halal: share(obj.halal), gf: share(obj.gf) };
}

export function eventFromRow(row: EventRow): Event {
  return {
    id: row.id,
    name: row.name,
    venue: {
      name: row.venue_name,
      address: row.venue_address,
      postcode: row.venue_postcode,
      lat: row.venue_lat,
      lon: row.venue_lng,
    },
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    headcount: row.headcount,
    budget: Number(row.budget),
    dietaryMix: dietaryMixFromJson(row.dietary_mix),
    timeZone: row.timezone,
    currency: row.currency,
  };
}

/** What an organiser fills in to create an event. */
export type EventInput = Omit<Event, "id">;

export function eventToInsert(input: EventInput): TablesInsert<"events"> {
  return {
    name: input.name,
    venue_name: input.venue.name,
    venue_address: input.venue.address,
    venue_postcode: input.venue.postcode,
    venue_lat: input.venue.lat,
    venue_lng: input.venue.lon,
    timezone: input.timeZone ?? DEFAULT_TIME_ZONE,
    currency: input.currency ?? DEFAULT_CURRENCY,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    headcount: input.headcount,
    budget: input.budget,
    dietary_mix: input.dietaryMix,
  };
}

export type EventPatch = Partial<Omit<EventInput, "venue">> & { venue?: Partial<Event["venue"]> };

export function eventToUpdate(patch: EventPatch): TablesUpdate<"events"> {
  const out: TablesUpdate<"events"> = {};
  if (patch.name !== undefined) out.name = patch.name;
  if (patch.venue?.name !== undefined) out.venue_name = patch.venue.name;
  if (patch.venue?.address !== undefined) out.venue_address = patch.venue.address;
  if (patch.venue?.postcode !== undefined) out.venue_postcode = patch.venue.postcode;
  if (patch.venue?.lat !== undefined) out.venue_lat = patch.venue.lat;
  if (patch.venue?.lon !== undefined) out.venue_lng = patch.venue.lon;
  if (patch.timeZone !== undefined) out.timezone = patch.timeZone;
  if (patch.currency !== undefined) out.currency = patch.currency;
  if (patch.startsAt !== undefined) out.starts_at = patch.startsAt;
  if (patch.endsAt !== undefined) out.ends_at = patch.endsAt;
  if (patch.headcount !== undefined) out.headcount = patch.headcount;
  if (patch.budget !== undefined) out.budget = patch.budget;
  if (patch.dietaryMix !== undefined) out.dietary_mix = patch.dietaryMix;
  return out;
}

/* ---------- Members ---------- */

export function memberFromRow(row: MemberRow): Member {
  return {
    id: row.id,
    eventId: row.event_id,
    userId: row.user_id,
    email: row.invited_email,
    role: row.role,
    pending: row.user_id === null,
    acceptedAt: row.accepted_at ? iso(row.accepted_at) : null,
  };
}

/* ---------- Meal slots ---------- */

export function slotFromRow(row: SlotRow): MealSlot {
  return {
    id: row.id,
    eventId: row.event_id,
    label: row.label,
    kind: row.kind,
    servesAt: iso(row.serves_at),
    headcount: row.headcount,
    allowance: row.allowance,
  };
}

/** The meal check rules stored on a slot, in lib/allowance.ts's shape. */
export function rulesFromSlotRow(row: SlotRow): SlotRules {
  return {
    servings: row.allowance,
    secondsAfterMinutes: row.seconds_after_minutes,
    seconds: row.seconds,
    opensBeforeMinutes: row.opens_before_minutes,
    closesAfterMinutes: row.closes_after_minutes,
  };
}

export function rulesToSlotUpdate(rules: Partial<SlotRules>): TablesUpdate<"meal_slots"> {
  const out: TablesUpdate<"meal_slots"> = {};
  if (rules.servings !== undefined) out.allowance = rules.servings;
  if (rules.secondsAfterMinutes !== undefined) out.seconds_after_minutes = rules.secondsAfterMinutes;
  if (rules.seconds !== undefined) out.seconds = rules.seconds;
  if (rules.opensBeforeMinutes !== undefined) out.opens_before_minutes = rules.opensBeforeMinutes;
  if (rules.closesAfterMinutes !== undefined) out.closes_after_minutes = rules.closesAfterMinutes;
  return out;
}

/* ---------- Orders ---------- */

export function linesFromJson(json: Json | unknown): OrderLine[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((l): OrderLine[] => {
    if (!isObject(l)) return [];
    const dietary = l.dietary === "standard" || isDietary(l.dietary) ? l.dietary : null;
    const quantity = typeof l.quantity === "number" && Number.isFinite(l.quantity) ? Math.max(0, Math.round(l.quantity)) : null;
    if (dietary === null || quantity === null) return [];
    return [{ dietary, quantity, ...(typeof l.item === "string" && l.item ? { item: l.item } : {}) }];
  });
}

function sourceFromJson(json: Json | unknown): EstimateSource {
  const obj = isObject(json) ? json : {};
  return {
    label: typeof obj.label === "string" && obj.label ? obj.label : "Comeda planner",
    ...(typeof obj.url === "string" && obj.url ? { url: obj.url } : {}),
  };
}

export function orderFromRow(row: OrderRow): Order {
  return {
    id: row.id,
    slotId: row.slot_id,
    restaurantId: row.restaurant_id,
    platform: row.platform,
    status: row.status,
    lines: linesFromJson(row.lines),
    orderBy: row.order_by ? iso(row.order_by) : "",
    total: { value: Number(row.total), source: sourceFromJson(row.total_source), isEstimate: row.total_is_estimate },
  };
}

/** The restaurant as it was when the order was planned, or null if the snapshot is unusable. */
export function restaurantFromOrderRow(row: Pick<OrderRow, "restaurant" | "restaurant_id">): Restaurant | null {
  const r = row.restaurant;
  if (!isObject(r) || typeof r.name !== "string") return null;
  return { ...(r as unknown as Restaurant), id: row.restaurant_id };
}

/** Restaurants named by orders, one per id (the dashboard resolves orders' restaurants by id). */
export function restaurantsFromOrders(rows: Pick<OrderRow, "restaurant" | "restaurant_id">[]): Restaurant[] {
  const byId = new Map<string, Restaurant>();
  for (const row of rows) {
    const r = restaurantFromOrderRow(row);
    if (r && !byId.has(r.id)) byId.set(r.id, r);
  }
  return [...byId.values()];
}

export const ORDER_STATUS_IDS = ORDER_STATUSES.map((s) => s.id);

/* ---------- Attendees ---------- */

export function attendeeFromRow(row: AttendeeRow): Attendee {
  return {
    id: row.id,
    name: row.name,
    discordHandle: row.discord_handle ?? "",
    avatarUrl: row.avatar_url ?? initialsAvatar(row.name),
    qrHash: row.qr_hash,
    ...(row.dietary ? { dietary: row.dietary } : {}),
    ...(row.email ? { email: row.email } : {}),
  };
}

/** One attendee as import_attendees() takes it. */
export type AttendeeImportRow = {
  name: string;
  email?: string;
  discord_handle?: string;
  dietary?: Dietary;
  qr_hash?: string;
};

/* ---------- Meal logs ---------- */

export function mealLogFromRow(row: MealLogRow): MealLog {
  return {
    id: row.id,
    attendeeId: row.attendee_id,
    slotId: row.slot_id,
    at: iso(row.served_at),
    method: row.method,
    ...(row.served_by ? { servedBy: row.served_by } : {}),
  };
}

type ServeCounts = {
  /** Servings this attendee has collected in the slot, including this one. */
  eaten: number;
  /** Servings allowed right now. */
  maxNow: number;
  /** Most servings possible once seconds open. */
  maxTotal: number;
  secondsAt: string | null;
};

/** What serve_meal() answered. */
export type ServeResult = ({ ok: true; log: MealLog } & ServeCounts) | ({ ok: false; code: BlockCode } & ServeCounts);

export function serveResultFromJson(json: Json): ServeResult {
  if (!isObject(json)) throw new Error("serve_meal returned an unexpected shape");
  const counts: ServeCounts = {
    eaten: Number(json.eaten ?? 0),
    maxNow: Number(json.maxNow ?? 0),
    maxTotal: Number(json.maxTotal ?? 0),
    secondsAt: typeof json.secondsAt === "string" ? iso(json.secondsAt) : null,
  };
  if (json.ok === true && isObject(json.log)) return { ok: true, log: mealLogFromRow(json.log as unknown as MealLogRow), ...counts };
  return { ok: false, code: (json.code as BlockCode) ?? "used", ...counts };
}

/* ---------- Plans ---------- */

const PLAN_STATUSES: PlanSlot["status"][] = ["proposed", "approved", "swapped"];

export function planSlotsFromJson(json: Json | unknown): PlanSlot[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((s): PlanSlot[] => {
    if (!isObject(s) || typeof s.slotId !== "string" || typeof s.restaurantId !== "string") return [];
    const status = PLAN_STATUSES.includes(s.status as PlanSlot["status"]) ? (s.status as PlanSlot["status"]) : "proposed";
    return [{ slotId: s.slotId, restaurantId: s.restaurantId, status, ...(typeof s.reason === "string" ? { reason: s.reason } : {}) }];
  });
}

export function planFromRow(row: PlanRow): Plan {
  return {
    id: row.id,
    status: row.status,
    eventId: row.event_id,
    generatedAt: iso(row.generated_at),
    source: row.source as Plan["source"],
    slots: planSlotsFromJson(row.slots),
    total: { value: Number(row.total), source: sourceFromJson(row.total_source), isEstimate: true },
  };
}

/** An empty plan, for events nothing has been planned for yet. */
export function emptyPlan(eventId: string, at: string): Plan {
  return { eventId, generatedAt: at, source: "planner", slots: [], total: { value: 0, source: { label: "Comeda planner" }, isEstimate: true } };
}

/** What save_plan() takes, built from event data after lib/plan-sync.ts applyPlan(). Each order
    carries a snapshot of its restaurant. Slot ids that aren't database ids become new slots. */
export function savePlanPayload(data: Pick<EventData, "event" | "slots" | "orders" | "plan" | "restaurants">, options: { approve?: boolean } = {}) {
  const { headcount, budget, startsAt, endsAt, dietaryMix } = data.event;
  const restaurants = new Map(data.restaurants.map((r) => [r.id, r]));
  return {
    event: { headcount, budget, startsAt, endsAt, dietaryMix },
    slots: data.slots.map(({ id, label, kind, servesAt, headcount, allowance }) => ({ id, label, kind, servesAt, headcount, allowance })),
    orders: data.orders.map((o) => ({
      slotId: o.slotId,
      restaurantId: o.restaurantId,
      restaurant: restaurants.get(o.restaurantId) ?? { id: o.restaurantId, name: o.restaurantId },
      platform: o.platform,
      lines: o.lines,
      orderBy: o.orderBy || null,
      total: o.total,
    })),
    plan: { source: data.plan.source, generatedAt: data.plan.generatedAt, slots: data.plan.slots, total: data.plan.total },
    approve: options.approve ?? false,
  };
}

export type SavePlanPayload = ReturnType<typeof savePlanPayload>;

/** save_plan()'s answer: the plan id and client slot id → database slot id. */
export function savePlanResultFromJson(json: Json): { planId: string; slotIds: Record<string, string> } {
  if (!isObject(json) || typeof json.planId !== "string") throw new Error("save_plan returned an unexpected shape");
  const slotIds = isObject(json.slotIds)
    ? Object.fromEntries(Object.entries(json.slotIds).filter((e): e is [string, string] => typeof e[1] === "string"))
    : {};
  return { planId: json.planId, slotIds };
}

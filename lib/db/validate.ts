import type { SlotRules } from "@/lib/allowance";
import { ORDER_STATUS_IDS, PLATFORMS, dietaryMixFromJson, isDietary, type EventInput, type EventPatch } from "@/lib/db/mappers";
import type { EventRole } from "@/lib/db/types";
import type { DeliveryPlatform, OrderLine, OrderStatus } from "@/lib/types";

/* Request body checks for the API routes. Each returns the cleaned value or a list of plain-English
   problems; the database re-checks everything with constraints and RLS. Pure, so tests run them. */

export type Checked<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function isTimeZone(zone: string) {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

class Problems {
  list: string[] = [];
  add(p: string) {
    this.list.push(p);
  }
  text(v: unknown, name: string, max: number, { required = false } = {}): string | undefined {
    if (v === undefined || v === null) {
      if (required) this.add(`${name} is required`);
      return undefined;
    }
    if (typeof v !== "string") return void this.add(`${name} must be text`);
    const t = v.trim();
    if (required && !t) return void this.add(`${name} is required`);
    if (t.length > max) return void this.add(`${name} must be at most ${max} characters`);
    return t;
  }
  number(v: unknown, name: string, min: number, max: number, { integer = false, required = false } = {}): number | undefined {
    if (v === undefined || v === null) {
      if (required) this.add(`${name} is required`);
      return undefined;
    }
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) {
      return void this.add(`${name} must be ${integer ? "a whole number" : "a number"} from ${min} to ${max}`);
    }
    return v;
  }
  time(v: unknown, name: string, { required = false } = {}): string | undefined {
    if (v === undefined || v === null) {
      if (required) this.add(`${name} is required`);
      return undefined;
    }
    if (typeof v !== "string" || Number.isNaN(Date.parse(v))) return void this.add(`${name} must be an ISO date-time`);
    return new Date(v).toISOString();
  }
}

function eventFields(body: Record<string, unknown>, p: Problems, required: boolean): EventPatch {
  const venue = isObject(body.venue) ? body.venue : {};
  if (required && !isObject(body.venue)) p.add("venue is required");
  const out: EventPatch = {};
  const name = p.text(body.name, "name", 120, { required });
  if (name !== undefined) out.name = name;
  const v: EventPatch["venue"] = {};
  const vName = p.text(venue.name, "venue.name", 200, { required });
  if (vName !== undefined) v.name = vName;
  const address = p.text(venue.address, "venue.address", 300);
  if (address !== undefined) v.address = address;
  const postcode = p.text(venue.postcode, "venue.postcode", 20);
  if (postcode !== undefined) v.postcode = postcode;
  const lat = p.number(venue.lat, "venue.lat", -90, 90, { required });
  if (lat !== undefined) v.lat = lat;
  const lon = p.number(venue.lon, "venue.lon", -180, 180, { required });
  if (lon !== undefined) v.lon = lon;
  if (Object.keys(v).length) out.venue = v;
  const startsAt = p.time(body.startsAt, "startsAt", { required });
  if (startsAt !== undefined) out.startsAt = startsAt;
  const endsAt = p.time(body.endsAt, "endsAt", { required });
  if (endsAt !== undefined) out.endsAt = endsAt;
  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) p.add("endsAt must be after startsAt");
  const headcount = p.number(body.headcount, "headcount", 1, 10_000, { integer: true, required });
  if (headcount !== undefined) out.headcount = headcount;
  const budget = p.number(body.budget, "budget", 0, 10_000_000, { required });
  if (budget !== undefined) out.budget = Math.round(budget * 100) / 100;
  if (body.dietaryMix !== undefined) {
    if (!isObject(body.dietaryMix)) p.add("dietaryMix must be an object like { veg: 0.15 }");
    else out.dietaryMix = dietaryMixFromJson(body.dietaryMix);
  } else if (required) out.dietaryMix = { veg: 0, vegan: 0, halal: 0, gf: 0 };
  const timeZone = p.text(body.timeZone, "timeZone", 64);
  if (timeZone !== undefined) {
    if (isTimeZone(timeZone)) out.timeZone = timeZone;
    else p.add(`Unknown timeZone: ${timeZone}`);
  }
  const currency = p.text(body.currency, "currency", 3);
  if (currency !== undefined) {
    if (/^[A-Z]{3}$/.test(currency)) out.currency = currency;
    else p.add("currency must be a 3-letter code like GBP");
  }
  return out;
}

export function checkEventInput(body: unknown): Checked<EventInput> {
  if (!isObject(body)) return { ok: false, errors: ["Send a JSON object"] };
  const p = new Problems();
  const fields = eventFields(body, p, true);
  if (p.list.length) return { ok: false, errors: p.list };
  const venue = { address: "", postcode: "", ...fields.venue } as EventInput["venue"];
  return { ok: true, value: { ...(fields as Omit<EventInput, "venue">), venue } };
}

export function checkEventPatch(body: unknown): Checked<EventPatch> {
  if (!isObject(body)) return { ok: false, errors: ["Send a JSON object"] };
  const p = new Problems();
  const fields = eventFields(body, p, false);
  if (p.list.length) return { ok: false, errors: p.list };
  if (!Object.keys(fields).length) return { ok: false, errors: ["Nothing to update"] };
  return { ok: true, value: fields };
}

export function checkInvite(body: unknown): Checked<{ email: string; role: EventRole }> {
  if (!isObject(body)) return { ok: false, errors: ["Send a JSON object"] };
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = body.role === undefined ? "staff" : body.role;
  const errors: string[] = [];
  if (!EMAIL.test(email) || email.length > 320) errors.push("A valid email is required");
  if (role !== "staff" && role !== "organiser") errors.push('role must be "staff" or "organiser"');
  return errors.length ? { ok: false, errors } : { ok: true, value: { email, role: role as EventRole } };
}

export type OrderPatch = { status?: OrderStatus; lines?: OrderLine[]; platform?: DeliveryPlatform };

export function checkOrderPatch(body: unknown): Checked<OrderPatch> {
  if (!isObject(body)) return { ok: false, errors: ["Send a JSON object"] };
  const errors: string[] = [];
  const out: OrderPatch = {};
  if (body.status !== undefined) {
    if (ORDER_STATUS_IDS.includes(body.status as OrderStatus)) out.status = body.status as OrderStatus;
    else errors.push(`status must be one of ${ORDER_STATUS_IDS.join(", ")}`);
  }
  if (body.platform !== undefined) {
    if (PLATFORMS.includes(body.platform as DeliveryPlatform)) out.platform = body.platform as DeliveryPlatform;
    else errors.push(`platform must be one of ${PLATFORMS.join(", ")}`);
  }
  if (body.lines !== undefined) {
    if (!Array.isArray(body.lines) || body.lines.length > 20) errors.push("lines must be a list of at most 20 lines");
    else {
      const lines: OrderLine[] = [];
      for (const l of body.lines) {
        const ok =
          isObject(l) &&
          (l.dietary === "standard" || isDietary(l.dietary)) &&
          typeof l.quantity === "number" &&
          Number.isInteger(l.quantity) &&
          l.quantity >= 0 &&
          l.quantity <= 10_000 &&
          (l.item === undefined || (typeof l.item === "string" && l.item.length <= 200));
        if (!ok) {
          errors.push("Each line needs dietary (standard, veg, vegan, halal, gf) and a whole quantity 0–10,000");
          break;
        }
        lines.push({ dietary: l.dietary as OrderLine["dietary"], quantity: l.quantity as number, ...(l.item ? { item: l.item as string } : {}) });
      }
      out.lines = lines;
    }
  }
  if (!errors.length && !Object.keys(out).length) errors.push("Nothing to update");
  return errors.length ? { ok: false, errors } : { ok: true, value: out };
}

export function checkSlotRules(body: unknown): Checked<Partial<SlotRules>> {
  if (!isObject(body)) return { ok: false, errors: ["Send a JSON object"] };
  const p = new Problems();
  const out: Partial<SlotRules> = {};
  const servings = p.number(body.servings, "servings", 0, 20, { integer: true });
  if (servings !== undefined) out.servings = servings;
  if (body.secondsAfterMinutes === null) out.secondsAfterMinutes = null;
  else {
    const v = p.number(body.secondsAfterMinutes, "secondsAfterMinutes", 0, 1440, { integer: true });
    if (v !== undefined) out.secondsAfterMinutes = v;
  }
  const seconds = p.number(body.seconds, "seconds", 0, 20, { integer: true });
  if (seconds !== undefined) out.seconds = seconds;
  const opens = p.number(body.opensBeforeMinutes, "opensBeforeMinutes", 0, 1440, { integer: true });
  if (opens !== undefined) out.opensBeforeMinutes = opens;
  const closes = p.number(body.closesAfterMinutes, "closesAfterMinutes", 1, 1440, { integer: true });
  if (closes !== undefined) out.closesAfterMinutes = closes;
  if (!p.list.length && !Object.keys(out).length) p.add("Nothing to update");
  return p.list.length ? { ok: false, errors: p.list } : { ok: true, value: out };
}

export function checkServe(body: unknown): Checked<{ slotId: string; attendeeId: string; method: "qr" | "search" }> {
  if (!isObject(body)) return { ok: false, errors: ["Send a JSON object"] };
  const errors: string[] = [];
  if (!isUuid(body.slotId)) errors.push("slotId must be a slot id");
  if (!isUuid(body.attendeeId)) errors.push("attendeeId must be an attendee id");
  const method = body.method ?? "qr";
  if (method !== "qr" && method !== "search") errors.push('method must be "qr" or "search"');
  return errors.length
    ? { ok: false, errors }
    : { ok: true, value: { slotId: body.slotId as string, attendeeId: body.attendeeId as string, method: method as "qr" | "search" } };
}

/** A plan save: the shape savePlanPayload() builds. The database function checks the details. */
export function checkPlanSave(body: unknown): Checked<Record<string, unknown>> {
  if (!isObject(body)) return { ok: false, errors: ["Send a JSON object"] };
  const errors: string[] = [];
  if (!Array.isArray(body.slots) || body.slots.length > 200) errors.push("slots must be a list of at most 200");
  if (!Array.isArray(body.orders) || body.orders.length > 200) errors.push("orders must be a list of at most 200");
  if (!isObject(body.plan)) errors.push("plan is required");
  if (body.approve !== undefined && typeof body.approve !== "boolean") errors.push("approve must be true or false");
  return errors.length ? { ok: false, errors } : { ok: true, value: body };
}

import { costSlot, splitDietary } from "@/lib/planner";
import { iso, londonDay, londonInstant, londonParts } from "@/lib/london-time";
import type {
  Attendee,
  Estimate,
  Event,
  EventData,
  MealLog,
  MealSlot,
  Order,
  Plan,
  Restaurant,
} from "@/lib/types";
import { seedAttendees } from "@/lib/seed/attendees";

/* The OxHack demo event. Restaurants are fictional stand-ins until Places results replace them,
   and every number they carry is an estimate labelled "Seed data". */

const SEED = { label: "Seed data" };
const est = (value: number): Estimate => ({ value, source: SEED, isEstimate: true });

/** The demo's clock: Saturday afternoon, lunch eaten, dinner still to order. */
export const OXHACK_NOW = "2026-11-14T17:05:00Z";

export const OXHACK_EVENT: Event = {
  id: "oxhack-2026",
  name: "OxHack 2026",
  /* OxHack '26 is held at the Mathematical Institute (Andrew Wiles Building), Radcliffe Observatory Quarter. */
  venue: {
    name: "Mathematical Institute",
    address: "Andrew Wiles Building, Woodstock Road, Oxford",
    postcode: "OX2 6GG",
    lat: 51.7604,
    lon: -1.2632,
  },
  startsAt: "2026-11-14T10:00:00Z",
  endsAt: "2026-11-15T16:00:00Z",
  headcount: 150,
  budget: 5000,
  dietaryMix: { veg: 0.15, vegan: 0.08, halal: 0.04, gf: 0.03 },
};

const slot = (id: string, label: string, kind: MealSlot["kind"], servesAt: string): MealSlot => ({
  id,
  eventId: OXHACK_EVENT.id,
  label,
  kind,
  servesAt,
  headcount: OXHACK_EVENT.headcount,
  allowance: 1,
});

export const OXHACK_SLOTS: MealSlot[] = [
  slot("sat-lunch", "Saturday lunch", "lunch", "2026-11-14T13:00:00Z"),
  slot("sat-dinner", "Saturday dinner", "dinner", "2026-11-14T18:30:00Z"),
  slot("sat-midnight", "Midnight snack", "snack", "2026-11-15T00:00:00Z"),
  slot("sun-breakfast", "Sunday breakfast", "breakfast", "2026-11-15T08:30:00Z"),
  slot("sun-lunch", "Sunday lunch", "lunch", "2026-11-15T12:30:00Z"),
];

const restaurant = (
  r: Omit<Restaurant, "costPerHead" | "prepMinutes" | "travelMinutes" | "delivery"> & {
    perHead: number;
    prep: number;
    travel: number;
    fee: number;
  },
): Restaurant => {
  const { perHead, prep, travel, fee, ...rest } = r;
  return {
    ...rest,
    costPerHead: est(perHead),
    prepMinutes: est(prep),
    travelMinutes: est(travel),
    delivery: [{ platform: "direct", url: rest.websiteUrl ?? "https://example.com", fee: est(fee), eta: est(prep + travel) }],
  };
};

export const OXHACK_RESTAURANTS: Restaurant[] = [
  restaurant({
    id: "covered-market-pizza",
    name: "Covered Market Pizza Co.",
    cuisine: "Pizza",
    address: "Market Street, Oxford",
    lat: 51.7524,
    lon: -1.2571,
    distanceKm: 0.4,
    rating: 4.5,
    priceLevel: 2,
    serves: ["veg", "vegan", "gf"],
    imageUrl: "/collage/collage-portrait-01.jpg",
    color: "#c2410c",
    monogram: "P",
    perHead: 6,
    prep: 25,
    travel: 10,
    fee: 15,
  }),
  restaurant({
    id: "gloucester-green-falafel",
    name: "Gloucester Green Falafel",
    cuisine: "Middle Eastern",
    address: "Gloucester Green, Oxford",
    lat: 51.7543,
    lon: -1.2627,
    distanceKm: 0.7,
    rating: 4.7,
    priceLevel: 1,
    serves: ["veg", "vegan", "halal"],
    imageUrl: "/collage/collage-portrait-03.jpg",
    color: "#15803d",
    monogram: "F",
    perHead: 6.5,
    prep: 20,
    travel: 12,
    fee: 10,
  }),
  restaurant({
    id: "cowley-road-curry",
    name: "Cowley Road Curry House",
    cuisine: "Indian",
    address: "Cowley Road, Oxford",
    lat: 51.7466,
    lon: -1.2396,
    distanceKm: 1.6,
    rating: 4.4,
    priceLevel: 2,
    serves: ["veg", "vegan", "halal", "gf"],
    imageUrl: "/collage/collage-landscape-02.jpg",
    color: "#b45309",
    monogram: "C",
    perHead: 7.5,
    prep: 25,
    travel: 25,
    fee: 20,
  }),
  restaurant({
    id: "jericho-bagels",
    name: "Jericho Bagel Bakery",
    cuisine: "Bakery",
    address: "Walton Street, Oxford",
    lat: 51.7593,
    lon: -1.2668,
    distanceKm: 1.2,
    rating: 4.6,
    priceLevel: 1,
    serves: ["veg", "vegan"],
    imageUrl: "/collage/collage-square-01.jpg",
    color: "#a16207",
    monogram: "B",
    perHead: 4.5,
    prep: 30,
    travel: 15,
    fee: 8,
  }),
  restaurant({
    id: "high-street-noodles",
    name: "High Street Noodle Bar",
    cuisine: "Pan-Asian",
    address: "High Street, Oxford",
    lat: 51.7522,
    lon: -1.2508,
    distanceKm: 0.6,
    rating: 4.3,
    priceLevel: 2,
    serves: ["veg", "vegan", "halal", "gf"],
    imageUrl: "/collage/collage-square-02.jpg",
    color: "#be123c",
    monogram: "N",
    perHead: 8,
    prep: 20,
    travel: 12,
    fee: 12,
  }),
];

/* ---------- Attendees: 150 records with placeholder QR hashes (see lib/qr.ts) ---------- */

export const OXHACK_ATTENDEES: Attendee[] = seedAttendees(OXHACK_EVENT.headcount);

/* ---------- Orders, meal logs and the plan ---------- */

const restaurantById = (id: string) => OXHACK_RESTAURANTS.find((r) => r.id === id)!;
const slotById = (id: string) => OXHACK_SLOTS.find((s) => s.id === id)!;

/** Seeded orders are costed by the planner, so they match what "Get it done" would produce. */
function order(id: string, slotId: string, restaurantId: string, status: Order["status"]): Order {
  const s = slotById(slotId);
  const r = restaurantById(restaurantId);
  const cost = costSlot(s, r);
  return {
    id,
    slotId,
    restaurantId,
    platform: cost.delivery?.platform ?? "direct",
    status,
    lines: splitDietary(s.headcount, OXHACK_EVENT.dietaryMix),
    orderBy: cost.orderBy,
    total: est(cost.cost),
  };
}

export const OXHACK_ORDERS: Order[] = [
  order("ord-sat-lunch", "sat-lunch", "gloucester-green-falafel", "arrived"),
  order("ord-sat-dinner", "sat-dinner", "high-street-noodles", "planned"),
  order("ord-sat-midnight", "sat-midnight", "covered-market-pizza", "planned"),
];

/** 138 of 150 collected Saturday lunch. */
export const OXHACK_MEAL_LOGS: MealLog[] = OXHACK_ATTENDEES.slice(0, 138).map((a, i) => ({
  id: `log-${i + 1}`,
  attendeeId: a.id,
  slotId: "sat-lunch",
  at: new Date(Date.parse("2026-11-14T13:00:00Z") + i * 9_000).toISOString(),
  method: i % 10 === 0 ? "search" : "qr",
}));

const PICKS: Record<string, string> = {
  "sat-lunch": "gloucester-green-falafel",
  "sat-dinner": "high-street-noodles",
  "sat-midnight": "covered-market-pizza",
  "sun-breakfast": "jericho-bagels",
  "sun-lunch": "cowley-road-curry",
};

export const OXHACK_PLAN: Plan = {
  eventId: OXHACK_EVENT.id,
  generatedAt: "2026-11-10T09:00:00Z",
  source: "seed",
  slots: OXHACK_SLOTS.map((s) => ({
    slotId: s.id,
    restaurantId: PICKS[s.id],
    status: OXHACK_ORDERS.some((o) => o.slotId === s.id && o.status !== "planned") ? "approved" : "proposed",
  })),
  total: est(
    OXHACK_SLOTS.reduce((sum, s) => {
      return sum + costSlot(s, restaurantById(PICKS[s.id])).cost;
    }, 0),
  ),
};

export const OXHACK: EventData = {
  now: OXHACK_NOW,
  event: OXHACK_EVENT,
  slots: OXHACK_SLOTS,
  restaurants: OXHACK_RESTAURANTS,
  orders: OXHACK_ORDERS,
  attendees: OXHACK_ATTENDEES,
  mealLogs: OXHACK_MEAL_LOGS,
  plan: OXHACK_PLAN,
};

const DAY = 86_400_000;
const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "Europe/London" });

function dayNumber(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return Date.UTC(year, month - 1, date) / DAY;
}

/** Move a seeded instant by whole London calendar days, retaining its London wall-clock time. */
function shiftLondonDay(at: string, days: number) {
  const date = new Date(at);
  const originalDay = londonDay(date);
  const shiftedDay = new Date((dayNumber(originalDay) + days) * DAY).toISOString().slice(0, 10);
  const { hour, minute } = londonParts(date);
  const shifted = londonInstant(shiftedDay, hour, minute).getTime() + date.getUTCSeconds() * 1000 + date.getUTCMilliseconds();
  return iso(new Date(shifted));
}

/** The demo event rebased onto today's UK date, so its deadline clock is useful whenever it is opened. */
export function oxhackForToday(now: Date | string = new Date()): EventData {
  const instant = typeof now === "string" ? new Date(now) : now;
  const days = dayNumber(londonDay(instant)) - dayNumber(londonDay(OXHACK_NOW));
  const shift = (at: string) => shiftLondonDay(at, days);
  const slots = OXHACK_SLOTS.map((slot) => {
    const servesAt = shift(slot.servesAt);
    const label = slot.kind === "snack" ? "Midnight snack" : `${weekday.format(new Date(servesAt))} ${slot.kind}`;
    return { ...slot, label, servesAt };
  });

  return {
    ...OXHACK,
    now: iso(instant),
    event: { ...OXHACK_EVENT, startsAt: shift(OXHACK_EVENT.startsAt), endsAt: shift(OXHACK_EVENT.endsAt) },
    slots,
    orders: OXHACK_ORDERS.map((order) => ({ ...order, orderBy: shift(order.orderBy) })),
    mealLogs: OXHACK_MEAL_LOGS.map((log) => ({ ...log, at: shift(log.at) })),
    plan: { ...OXHACK_PLAN, generatedAt: shift(OXHACK_PLAN.generatedAt) },
  };
}

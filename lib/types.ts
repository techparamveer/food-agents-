/** Shared Comeda domain types. Money is GBP in pounds; times are ISO 8601 strings in Europe/London. */

/** Dietary needs Comeda plans quantities for. Everyone else is "standard". */
export type Dietary = "veg" | "vegan" | "halal" | "gf";

export const DIETARY: { id: Dietary; label: string }[] = [
  { id: "veg", label: "Vegetarian" },
  { id: "vegan", label: "Vegan" },
  { id: "halal", label: "Halal" },
  { id: "gf", label: "Gluten-free" },
];

/** Share of attendees per need, 0–1. The rest eat standard. */
export type DietaryMix = Record<Dietary, number>;

/** Where a number came from, so the UI can label it and link the source. */
export type EstimateSource = {
  /** e.g. "Google Places", "Gemini (Google Search)", "Seed data". */
  label: string;
  url?: string;
};

/** A number shown to organisers. `isEstimate` is false only for figures a human confirmed. */
export type Estimate = {
  /** For a range, the upper bound: deadlines plan for the slow end. */
  value: number;
  source: EstimateSource;
  isEstimate: boolean;
  /** Set when the source gives a range, e.g. a platform's "25–40 min". */
  range?: { low: number; high: number };
};

export type Venue = {
  name: string;
  address: string;
  postcode: string;
  lat: number;
  lon: number;
};

export type Event = {
  id: string;
  name: string;
  venue: Venue;
  startsAt: string;
  endsAt: string;
  headcount: number;
  /** Total food budget in pounds. */
  budget: number;
  dietaryMix: DietaryMix;
};

export type MealKind = "breakfast" | "lunch" | "dinner" | "snack";

export type MealSlot = {
  id: string;
  eventId: string;
  label: string;
  kind: MealKind;
  /** When food should be on the table. */
  servesAt: string;
  headcount: number;
  /** Meals each attendee may collect in this slot (the meal check enforces it). */
  allowance: number;
};

export type DeliveryPlatform = "deliveroo" | "ubereats" | "justeat" | "direct";

/** One way to get food from a restaurant to the venue. */
export type DeliveryOption = {
  platform: DeliveryPlatform;
  /** Where the organiser places the order. Comeda never orders itself. */
  url: string;
  fee: Estimate;
  /** Minutes from order to door: prep + travel. */
  eta: Estimate;
};

export type Restaurant = {
  id: string;
  /** Google Places id, once fetched live. */
  placeId?: string;
  name: string;
  cuisine: string;
  address: string;
  lat: number;
  lon: number;
  distanceKm: number;
  rating?: number;
  ratingCount?: number;
  /** Places price level, 1 (cheap) to 4. */
  priceLevel?: 1 | 2 | 3 | 4;
  /** Human-readable opening hours, one line per day. */
  hours?: string[];
  /** Dietary needs the menu covers. */
  serves: Dietary[];
  costPerHead: Estimate;
  prepMinutes: Estimate;
  travelMinutes: Estimate;
  delivery: DeliveryOption[];
  websiteUrl?: string;
  mapsUrl?: string;
  /** The restaurant's logo, resolved from its website by /api/restaurants/logo. 404s when there isn't one. */
  logoUrl?: string;
  /** A photo of the place, served through /api/restaurants/photo (the key stays on the server). */
  photoUrl?: string;
  /** Who took the photo. Google requires showing this wherever the photo appears. */
  photoCredit?: { name: string; url?: string };
  /** Tile colour and letter for the UI until a logo exists. */
  color: string;
  monogram: string;
};

/** Set by hand: Comeda never sees the restaurant's side. */
export type OrderStatus = "planned" | "ordered" | "out_for_delivery" | "arrived";

export const ORDER_STATUSES: { id: OrderStatus; label: string }[] = [
  { id: "planned", label: "Planned" },
  { id: "ordered", label: "Ordered" },
  { id: "out_for_delivery", label: "Out for delivery" },
  { id: "arrived", label: "Arrived" },
];

export type OrderLine = {
  dietary: Dietary | "standard";
  quantity: number;
  item?: string;
};

/** One bulk order for one meal slot. */
export type Order = {
  id: string;
  slotId: string;
  restaurantId: string;
  platform: DeliveryPlatform;
  status: OrderStatus;
  lines: OrderLine[];
  /** Latest time to place it: slot time − prep − delivery. */
  orderBy: string;
  total: Estimate;
};

export type Attendee = {
  id: string;
  name: string;
  discordHandle: string;
  avatarUrl: string;
  /** What the attendee's QR code encodes. Placeholder format until real hashes land. */
  qrHash: string;
  dietary?: Dietary;
};

/** One meal collected at the food table. */
export type MealLog = {
  id: string;
  attendeeId: string;
  slotId: string;
  at: string;
  method: "qr" | "search";
};

export type PlanStatus = "proposed" | "approved" | "swapped";

export type PlanSlot = {
  slotId: string;
  restaurantId: string;
  status: PlanStatus;
  /** Why the planner picked this restaurant. */
  reason?: string;
};

/** The planner's proposal: a restaurant per slot, kept under budget. */
export type Plan = {
  eventId: string;
  generatedAt: string;
  source: "seed" | "planner" | "gemini";
  slots: PlanSlot[];
  total: Estimate;
};

/** Everything the dashboard renders for one event. */
export type EventData = {
  /** The dashboard's clock. Fixed in the demo so countdowns read the same every time. */
  now: string;
  event: Event;
  slots: MealSlot[];
  restaurants: Restaurant[];
  orders: Order[];
  attendees: Attendee[];
  mealLogs: MealLog[];
  plan: Plan;
};

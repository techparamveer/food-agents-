import "server-only";

import { londonClock } from "@/lib/london-time";
import { looksLikePlanRequest, parseFoodRequest, plannerInputFor, type FoodRequest } from "@/lib/food-request";
import { planMeals, type MealPlan } from "@/lib/planner";
import { searchRestaurants } from "@/lib/restaurant-search";
import { OXHACK_EVENT, OXHACK_NOW } from "@/lib/seed/oxhack";
import { generate, geminiModel, hasGeminiKey, type FunctionDeclaration, type GeminiContent, type GeminiPart } from "@/lib/server/gemini";
import { DIETARY, type Dietary, type Restaurant } from "@/lib/types";

/* One food-planner chat turn, streamed as newline-delimited JSON:
     {"type":"tool", name, label}             a tool started
     {"type":"plan", plan: MealPlan}          the planner's result (the client renders it as a card)
     {"type":"restaurants", restaurants}      restaurant search results
     {"type":"delta", text}                   reply text
     {"type":"done", model?}
     {"type":"error", message}
   The planner does the maths. Gemini picks the tool and narrates; without a key the request is
   parsed with rules and the reply is templated, so the demo never breaks. */

export type FoodChatEvent =
  | { type: "tool"; name: ToolName; label: string }
  | { type: "plan"; plan: MealPlan }
  | { type: "restaurants"; restaurants: Restaurant[] }
  | { type: "delta"; text: string }
  | { type: "done"; model?: string }
  | { type: "error"; message: string };

export type ChatTurn = { role: "user" | "assistant"; text: string };

/** What the dashboard knows that the server doesn't: the organiser's orders so far. */
export type ChatState = { spent: number; planned: number; budget: number; left: number };

type ToolName = "plan_meals" | "find_restaurants";

const DIETARY_PROPS = Object.fromEntries(
  DIETARY.map((d) => [d.id, { type: "integer", description: `How many people need ${d.label.toLowerCase()} meals.` }]),
);

const TOOLS: FunctionDeclaration[] = [
  {
    name: "plan_meals",
    description:
      "Plan food: picks a restaurant per meal, splits quantities by dietary need and keeps the total under budget. " +
      "Use for any request to feed people. Omit anything the organiser didn't say; the event's defaults fill it in.",
    parameters: {
      type: "object",
      properties: {
        headcount: { type: "integer", description: "People to feed." },
        budget: { type: "number", description: "Budget in pounds for everything planned." },
        by: { type: "string", description: "London time food must arrive, 24h HH:MM. Set for a single meal." },
        wholeEvent: { type: "boolean", description: "Plan every meal of the event rather than one." },
        ...DIETARY_PROPS,
      },
    },
  },
  {
    name: "find_restaurants",
    description: "List restaurants near the venue that can cater, cheapest first, with estimated cost per head, ETA and fees.",
    parameters: {
      type: "object",
      properties: {
        headcount: { type: "integer" },
        maxPerHead: { type: "number", description: "Most to spend per head in pounds." },
        by: { type: "string", description: "London time food must arrive, HH:MM." },
        dietary: { type: "array", items: { type: "string", enum: DIETARY.map((d) => d.id) } },
      },
    },
  },
];

const SYSTEM = `You are Comeda, a food planner for hackathon organisers running ${OXHACK_EVENT.name} at ${OXHACK_EVENT.venue.name}.
The event runs ${OXHACK_EVENT.startsAt} to ${OXHACK_EVENT.endsAt} (UTC) for ${OXHACK_EVENT.headcount} people with a £${OXHACK_EVENT.budget} food budget.
Call plan_meals for any request to feed people, and find_restaurants to compare places. Never do arithmetic yourself and never
invent prices, times or restaurants: every number you mention must come from a tool result, and costs are estimates.
Comeda never places orders; the organiser orders through the restaurant's link in the Order builder.
Reply in British English, in at most 5 short lines or bullets. Lead with the answer, then one trade-off worth knowing.`;

const gbp = (n: number) => `${n < 0 ? "−" : ""}£${Math.abs(Math.round(n)).toLocaleString("en-GB")}`;

/** Gemini args → the same request shape the rule parser makes, so both paths share planner input. */
function requestFromArgs(args: Record<string, unknown>): FoodRequest {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);
  const counts: FoodRequest["dietaryCounts"] = {};
  for (const d of DIETARY) {
    const n = num(args[d.id]);
    if (n !== undefined) counts[d.id] = Math.round(n);
  }
  const by = typeof args.by === "string" && /^\d{1,2}:\d{2}$/.test(args.by) ? args.by.padStart(5, "0") : undefined;
  return {
    headcount: num(args.headcount) ? Math.round(num(args.headcount)!) : undefined,
    budget: num(args.budget),
    dietaryCounts: counts,
    dietaryShares: {},
    by,
    wholeEvent: args.wholeEvent === true,
    mentions: [],
  };
}

async function runPlan(req: FoodRequest) {
  const input = plannerInputFor(req, OXHACK_EVENT, OXHACK_NOW);
  const first = input.slots?.[0]?.servesAt ?? input.startsAt;
  // No hard dietary filter: the planner prices menu gaps and explains them.
  const restaurants = await searchRestaurants({ venue: OXHACK_EVENT.venue, slotTime: first, headcount: input.headcount, dietaryMix: input.dietaryMix });
  return { plan: planMeals(input, restaurants), restaurants };
}

async function runSearch(args: Record<string, unknown>) {
  const req = requestFromArgs(args);
  const dietary = Array.isArray(args.dietary) ? args.dietary.filter((d): d is Dietary => DIETARY.some((x) => x.id === d)) : [];
  const input = plannerInputFor({ ...req, by: req.by ?? "18:30" }, OXHACK_EVENT, OXHACK_NOW);
  const found = await searchRestaurants({
    venue: OXHACK_EVENT.venue,
    slotTime: input.slots?.[0]?.servesAt ?? OXHACK_NOW,
    headcount: req.headcount ?? OXHACK_EVENT.headcount,
    maxPerHead: typeof args.maxPerHead === "number" ? args.maxPerHead : undefined,
    dietary,
  });
  // Asked for specific needs: only show places that cover all of them, when any do.
  const covering = found.filter((r) => dietary.every((d) => r.serves.includes(d)));
  return covering.length ? covering : found;
}

/** What Gemini sees of a plan: names and numbers, nothing it could re-derive wrongly. */
function planForModel(plan: MealPlan, restaurants: Restaurant[]) {
  const name = (id: string) => restaurants.find((r) => r.id === id)?.name ?? id;
  return {
    fits: plan.fits,
    total: gbp(plan.total),
    budget: gbp(plan.budget),
    remaining: gbp(plan.remaining),
    notes: plan.notes,
    meals: plan.slots.map((s) => ({
      meal: s.slot.label,
      serves: londonClock(s.slot.servesAt),
      restaurant: name(s.restaurantId),
      cost: gbp(s.cost),
      orderBy: londonClock(s.orderBy),
      quantities: s.lines.filter((l) => l.quantity > 0).map((l) => `${l.quantity} ${l.dietary}`).join(", "),
      why: s.reason,
      cheaperOption: s.alternatives.find((a) => a.delta < 0)?.name,
    })),
  };
}

/** The no-key reply: the same facts, templated. */
export function narratePlan(plan: MealPlan, restaurants: Restaurant[]) {
  const name = (id: string) => restaurants.find((r) => r.id === id)?.name ?? id;
  if (!plan.slots.length) return "I couldn't find a meal to plan in those times. Try another time or the whole weekend.";
  const total = Math.round(plan.total);
  const head = plan.fits
    ? `Done: ${plan.slots.length === 1 ? "one meal" : `${plan.slots.length} meals`} for ${gbp(total)}, ${gbp(plan.budget - total)} under your ${gbp(plan.budget)}.`
    : `This can't fit ${gbp(plan.budget)}: the cheapest plan is ${gbp(plan.total)}.`;
  const lines = plan.slots.map(
    (s) => `- **${s.slot.label}** · ${name(s.restaurantId)}, ${gbp(s.cost)}. Order by ${londonClock(s.orderBy)}.`,
  );
  const tradeoff = plan.slots.find((s) => s.missing.length)?.reason ?? plan.slots.find((s) => !/^Cheapest/.test(s.reason))?.reason;
  const next = plan.input.slots ? "Open Orders to build it." : "Tap Use this plan to make it the event's plan, then approve or swap each meal.";
  return [head, lines.join("\n"), tradeoff ? `Trade-off: ${tradeoff}` : "", next]
    .filter(Boolean)
    .join("\n\n");
}

function narrateRestaurants(restaurants: Restaurant[], dietary: Dietary[] = []) {
  if (!restaurants.length) return "No restaurants match that. Try a higher cost per head.";
  const needs = dietary.map((d) => DIETARY.find((x) => x.id === d)!.label.toLowerCase()).join(" and ");
  return [
    needs ? `These cover ${needs}, best match first (all estimates):` : "Cheapest first (all estimates):",
    restaurants
      .slice(0, 5)
      .map((r) => `- **${r.name}** · ${r.cuisine}, about £${r.costPerHead.value.toFixed(2)} a head, ${r.prepMinutes.value + r.travelMinutes.value} min to the door`)
      .join("\n"),
  ].join("\n\n");
}

const SEARCH = /restaurant|places|compare|options?|nearby|near me|cheapest|who (does|has|serves|can)/i;
const BUDGET = /budget|spent|spend|left|afford|money|cost so far/i;

function narrateBudget(state: ChatState | undefined) {
  if (!state) return "Open Overview for the budget: spent, planned and what's left.";
  const over = state.left < 0;
  return [
    `You've committed ${gbp(state.spent)} so far, and the full plan comes to ${gbp(state.planned)} of your ${gbp(state.budget)}.`,
    over ? `That's ${gbp(-state.left)} over. Ask me to re-plan under budget, or swap a meal for a cheaper one.` : `That leaves ${gbp(state.left)}.`,
  ].join(" ");
}

const HELP =
  'Tell me who to feed and I\'ll plan it, e.g. "feed 150, 20 vegan, by 7pm under £600", or "plan the whole weekend". I can also compare restaurants near the venue.';

export function foodChatStream(message: string, history: ChatTurn[], state?: ChatState): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      const send = (event: FoodChatEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      const finish = (text: string, model?: string) => {
        send({ type: "delta", text });
        send({ type: "done", model });
        controller.close();
      };

      const fallback = async () => {
        const req = parseFoodRequest(message);
        if (SEARCH.test(message) && !req.by && !req.wholeEvent) {
          send({ type: "tool", name: "find_restaurants", label: "Restaurant search" });
          const restaurants = await runSearch({ headcount: req.headcount, dietary: req.mentions });
          send({ type: "restaurants", restaurants });
          return finish(narrateRestaurants(restaurants, req.mentions));
        }
        if (!looksLikePlanRequest(req)) return finish(BUDGET.test(message) ? narrateBudget(state) : HELP);
        send({ type: "tool", name: "plan_meals", label: "Meal plan" });
        const { plan, restaurants } = await runPlan(req);
        send({ type: "plan", plan });
        return finish(narratePlan(plan, restaurants));
      };

      try {
        if (!hasGeminiKey()) return await fallback();

        const contents: GeminiContent[] = [
          ...history.slice(-8).map((t): GeminiContent => ({ role: t.role === "user" ? "user" : "model", parts: [{ text: t.text.slice(0, 1500) }] })),
          { role: "user", parts: [{ text: message }] },
        ];
        const system = state
          ? `${SYSTEM}\nOrders so far: ${gbp(state.spent)} committed, ${gbp(state.planned)} planned in total, ${gbp(state.left)} of the budget left.`
          : SYSTEM;
        let parts: GeminiPart[];
        try {
          parts = await generate({ system, contents, tools: TOOLS });
        } catch {
          return await fallback();
        }

        // What the tools found, so a failed narration can still be templated without re-running them.
        let told = "";
        // Up to two rounds of tool calls, then the narrative.
        for (let round = 0; round < 2; round++) {
          const calls = parts.flatMap((p) => ("functionCall" in p ? [p.functionCall] : []));
          if (!calls.length) break;
          const responses: GeminiPart[] = [];
          for (const call of calls.slice(0, 2)) {
            const args = call.args ?? {};
            if (call.name === "plan_meals") {
              send({ type: "tool", name: "plan_meals", label: "Meal plan" });
              // Cross-check: numbers the organiser typed beat numbers the model passed.
              const typed = parseFoodRequest(message);
              const fromModel = requestFromArgs(args);
              const req: FoodRequest = {
                ...fromModel,
                headcount: typed.headcount ?? fromModel.headcount,
                budget: typed.budget ?? fromModel.budget,
                by: typed.by ?? fromModel.by,
                dietaryCounts: { ...fromModel.dietaryCounts, ...typed.dietaryCounts },
                dietaryShares: typed.dietaryShares,
                wholeEvent: typed.wholeEvent || fromModel.wholeEvent,
              };
              const { plan, restaurants } = await runPlan(req);
              send({ type: "plan", plan });
              told = narratePlan(plan, restaurants);
              responses.push({ functionResponse: { name: call.name, response: planForModel(plan, restaurants) } });
            } else if (call.name === "find_restaurants") {
              send({ type: "tool", name: "find_restaurants", label: "Restaurant search" });
              const restaurants = await runSearch(args);
              send({ type: "restaurants", restaurants });
              told = narrateRestaurants(restaurants);
              responses.push({
                functionResponse: {
                  name: call.name,
                  response: {
                    restaurants: restaurants.slice(0, 6).map((r) => ({
                      name: r.name,
                      cuisine: r.cuisine,
                      perHead: `£${r.costPerHead.value.toFixed(2)} (estimate)`,
                      minutesToDoor: r.prepMinutes.value + r.travelMinutes.value,
                      serves: r.serves,
                      rating: r.rating,
                    })),
                  },
                },
              });
            }
          }
          contents.push({ role: "model", parts }, { role: "user", parts: responses });
          try {
            parts = await generate({ system, contents, tools: TOOLS });
          } catch {
            return told ? finish(told) : await fallback();
          }
        }

        const text = parts.flatMap((p) => ("text" in p ? [p.text] : [])).join("").trim();
        if (!text) return told ? finish(told) : await fallback();
        return finish(text, geminiModel());
      } catch {
        send({ type: "error", message: "Comeda couldn't plan that just now. Try again in a moment." });
        controller.close();
      }
    },
  });
}

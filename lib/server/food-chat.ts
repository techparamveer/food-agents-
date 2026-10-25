import "server-only";

import { chatSigner, type ChatTurn } from "@/lib/chat-history";
import { londonClock } from "@/lib/london-time";
import { looksLikePlanRequest, parseFoodRequest, plannerInputFor, type FoodRequest } from "@/lib/food-request";
import { doorMinutes, planMeals, proposeSlots, type MealPlan } from "@/lib/planner";
import { searchForSlots, setRestaurantSearch, type SearchInfo } from "@/lib/restaurant-search";
import { findRestaurants } from "@/lib/restaurants/find";
import { OXHACK_EVENT, OXHACK_NOW } from "@/lib/seed/oxhack";
import { generate, geminiModel, hasGeminiKey, type FunctionDeclaration, type GeminiContent, type GeminiPart } from "@/lib/server/gemini";
import { DIETARY, type Dietary, type Restaurant } from "@/lib/types";

/* One food-planner chat turn, streamed as newline-delimited JSON:
     {"type":"tool", name, label}             a tool started
     {"type":"plan", plan, restaurants}       the planner's result and the restaurants it used (the client renders a card)
     {"type":"restaurants", restaurants}      restaurant search results
     {"type":"delta", text}                   reply text
     {"type":"done", model?, sig}             sig signs the reply text, so the client can send it back as history
     {"type":"error", message}
   The planner does the maths. Gemini picks the tool and narrates; without a key the request is
   parsed with rules and the reply is templated, so the demo never breaks. */

export type FoodChatEvent =
  | { type: "tool"; name: ToolName; label: string }
  | { type: "plan"; plan: MealPlan; restaurants: Restaurant[] }
  | { type: "restaurants"; restaurants: Restaurant[]; search: SearchInfo }
  | { type: "delta"; text: string }
  | { type: "done"; model?: string; sig: string }
  | { type: "error"; message: string };

export type { ChatTurn } from "@/lib/chat-history";

// The chat plans on live data: Places + Gemini when keys are set, the seed otherwise.
setRestaurantSearch(findRestaurants);

/** Signs replies so a later request can prove an assistant turn really came from here. */
export const replySigner = chatSigner();

/** Tool calls answered per model round; extra calls get an error result instead of running. */
const MAX_CALLS_PER_ROUND = 3;

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
  const base = plannerInputFor(req, OXHACK_EVENT, OXHACK_NOW);
  // One search prices every meal; each meal only uses places open at its time.
  // No hard dietary filter: the planner prices menu gaps and explains them.
  const found = await searchForSlots(
    { venue: OXHACK_EVENT.venue, headcount: base.headcount, dietaryMix: base.dietaryMix },
    base.slots ?? proposeSlots(base),
  );
  const { restaurants, openAt, ...search } = found;
  const plan: MealPlan = { ...planMeals({ ...base, openAt }, restaurants), search };
  // Send the client only the restaurants the plan names, so it can show them.
  const used = restaurants.filter((r) => plan.slots.some((s) => s.restaurantId === r.id || s.alternatives.some((a) => a.restaurantId === r.id)));
  return { plan, restaurants: used };
}

async function runSearch(args: Record<string, unknown>): Promise<{ restaurants: Restaurant[]; search: SearchInfo }> {
  const req = requestFromArgs(args);
  const dietary = Array.isArray(args.dietary) ? args.dietary.filter((d): d is Dietary => DIETARY.some((x) => x.id === d)) : [];
  const input = plannerInputFor({ ...req, by: req.by ?? "18:30" }, OXHACK_EVENT, OXHACK_NOW);
  const slot = input.slots?.[0];
  const found = await searchForSlots(
    {
      venue: OXHACK_EVENT.venue,
      headcount: req.headcount ?? OXHACK_EVENT.headcount,
      maxPerHead: typeof args.maxPerHead === "number" ? args.maxPerHead : undefined,
      dietary,
    },
    slot ? [slot] : [],
  );
  const { restaurants: all, openAt, ...search } = found;
  // Open at that time, when any are; then only places covering every asked-for need, when any do.
  const open = slot ? all.filter((r) => openAt[slot.id]?.includes(r.id)) : all;
  const pool = open.length ? open : all;
  const covering = pool.filter((r) => dietary.every((d) => r.serves.includes(d)));
  return { restaurants: covering.length ? covering : pool, search };
}

/** What Gemini sees when a tool can't run. Every call gets a response, or Gemini rejects the next turn. */
const toolError = (name: string, error: string) => ({ functionResponse: { name, response: { error } } });

/** What Gemini sees of a plan: names and numbers, nothing it could re-derive wrongly. */
function planForModel(plan: MealPlan, restaurants: Restaurant[]) {
  const name = (id: string) => restaurants.find((r) => r.id === id)?.name ?? id;
  return {
    dataSource: plan.search?.source === "fallback" ? "seeded sample restaurants (live search unavailable)" : "Google Places",
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
  const seeded = plan.search?.source === "fallback" ? "Planned from seeded sample restaurants: live search isn't available right now." : "";
  return [head, lines.join("\n"), tradeoff ? `Trade-off: ${tradeoff}` : "", seeded, next]
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
      .map((r) => `- **${r.name}** · ${r.cuisine}, about £${r.costPerHead.value.toFixed(2)} a head, ${doorMinutes(r)} min to the door`)
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
        send({ type: "done", model, sig: replySigner.sign(text) });
        controller.close();
      };

      const fallback = async () => {
        const req = parseFoodRequest(message);
        if (SEARCH.test(message) && !req.by && !req.wholeEvent) {
          send({ type: "tool", name: "find_restaurants", label: "Restaurant search" });
          const { restaurants, search } = await runSearch({ headcount: req.headcount, dietary: req.mentions });
          send({ type: "restaurants", restaurants, search });
          return finish(narrateRestaurants(restaurants, req.mentions));
        }
        if (!looksLikePlanRequest(req)) return finish(BUDGET.test(message) ? narrateBudget(state) : HELP);
        send({ type: "tool", name: "plan_meals", label: "Meal plan" });
        const { plan, restaurants } = await runPlan(req);
        send({ type: "plan", plan, restaurants });
        return finish(narratePlan(plan, restaurants));
      };

      try {
        if (!hasGeminiKey()) return await fallback();

        // History arrives sanitised (lib/chat-history.ts): signed assistant turns only, roles alternating.
        const contents: GeminiContent[] = [
          ...history.map((t): GeminiContent => ({ role: t.role === "user" ? "user" : "model", parts: [{ text: t.text }] })),
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
          for (const [i, call] of calls.entries()) {
            const args = call.args ?? {};
            if (i >= MAX_CALLS_PER_ROUND) {
              responses.push(toolError(call.name, `Skipped: at most ${MAX_CALLS_PER_ROUND} tool calls per turn. Answer with what you have.`));
              continue;
            }
            try {
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
                send({ type: "plan", plan, restaurants });
                told = narratePlan(plan, restaurants);
                responses.push({ functionResponse: { name: call.name, response: planForModel(plan, restaurants) } });
              } else if (call.name === "find_restaurants") {
                send({ type: "tool", name: "find_restaurants", label: "Restaurant search" });
                const { restaurants, search } = await runSearch(args);
                send({ type: "restaurants", restaurants, search });
                told = narrateRestaurants(restaurants);
                responses.push({
                  functionResponse: {
                    name: call.name,
                    response: {
                      dataSource: search.source === "fallback" ? "seeded sample restaurants (live search unavailable)" : "Google Places",
                      restaurants: restaurants.slice(0, 6).map((r) => ({
                        name: r.name,
                        cuisine: r.cuisine,
                        perHead: `£${r.costPerHead.value.toFixed(2)} (estimate)`,
                        minutesToDoor: doorMinutes(r),
                        serves: r.serves,
                        rating: r.rating,
                      })),
                    },
                  },
                });
              } else {
                responses.push(toolError(call.name || "unknown", `Unknown tool. Use one of: ${TOOLS.map((t) => t.name).join(", ")}.`));
              }
            } catch {
              responses.push(toolError(call.name, "The tool failed. Tell the organiser to try again in a moment."));
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

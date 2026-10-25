import assert from "node:assert/strict";
import { createServer } from "node:http";
import Module from "node:module";
import type { AddressInfo } from "node:net";

/* The chat answers every tool call Gemini makes, including ones it can't run, so the next request
   is never rejected. Runs foodChatStream against a local mock of the Gemini API: no network, no keys. */

// lib/server/* is marked server-only; outside Next that import throws, so stub it for this script.
const loader = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const load = loader._load;
loader._load = function (request: string, ...rest: unknown[]) {
  return request === "server-only" ? {} : load.call(this, request, ...rest);
};

type Part = { text?: string; functionCall?: { name: string; args?: object }; functionResponse?: { name: string; response: Record<string, unknown> } };
type Body = { contents: { role: string; parts: Part[] }[] };

async function main() {
  const requests: Body[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      requests.push(JSON.parse(raw));
      const parts: Part[] =
        requests.length === 1
          ? [
              { functionCall: { name: "plan_meals", args: { headcount: 40, by: "19:00" } } },
              { functionCall: { name: "find_restaurants", args: { dietary: ["vegan"] } } },
              { functionCall: { name: "order_pizza", args: {} } },
              { functionCall: { name: "plan_meals", args: {} } },
            ]
          : [{ text: "All set: dinner for 40 is planned." }];
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ candidates: [{ content: { role: "model", parts } }] }));
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  process.env.GEMINI_API_KEY = "test-key";
  process.env.GEMINI_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.COMEDA_CACHE = "file";

  const { foodChatStream, replySigner } = await import("@/lib/server/food-chat");
  const { setRestaurantSearch } = await import("@/lib/restaurant-search");
  const { OXHACK_RESTAURANTS } = await import("@/lib/seed/oxhack");
  setRestaurantSearch(async () => ({ restaurants: OXHACK_RESTAURANTS, source: "live", grounded: OXHACK_RESTAURANTS.length, warnings: [] }));
  const stream = foodChatStream("feed 40 by 7pm, and who does vegan?", []);
  const text = await new Response(stream).text();
  server.close();
  const events = text.trim().split("\n").map((line) => JSON.parse(line));

  assert.equal(requests.length, 2, "one tool round, then the narrative");
  const answers = requests[1].contents.at(-1)!.parts.map((p) => p.functionResponse!);
  assert.equal(answers.length, 4, "every call gets a response, not just the first two");
  assert.deepEqual(answers.map((a) => a.name), ["plan_meals", "find_restaurants", "order_pizza", "plan_meals"], "names match the calls");
  assert.ok(answers[0].response.meals, "plan result");
  assert.ok(Array.isArray(answers[1].response.restaurants), "search result");
  assert.match(String(answers[2].response.error), /Unknown tool/, "unknown tool → an error result, not an empty reply");
  assert.match(String(answers[3].response.error), /at most 3 tool calls/, "over the cap → an error result");
  assert.equal(requests[1].contents.at(-2)!.role, "model", "the model's calls are echoed back before the answers");

  const plan = events.find((e) => e.type === "plan");
  assert.ok(plan.restaurants.length > 0, "the plan event carries the restaurants it names");
  assert.equal(plan.plan.search.source, "live", "the chat only plans from a live Google Places-shaped result");
  assert.ok(plan.plan.slots.every((s: { restaurantId: string }) => plan.restaurants.some((r: { id: string }) => r.id === s.restaurantId)));
  const restaurants = events.find((e) => e.type === "restaurants");
  assert.equal(restaurants.search.source, "live");

  const reply = events.filter((e) => e.type === "delta").map((e) => e.text).join("");
  assert.equal(reply, "All set: dinner for 40 is planned.");
  const done = events.at(-1);
  assert.equal(done.type, "done");
  assert.equal(replySigner.verify(reply, done.sig), true, "the reply is signed so it can come back as history");

  console.log("test-chat-tools: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

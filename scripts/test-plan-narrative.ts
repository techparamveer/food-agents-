import assert from "node:assert/strict";
import { createServer } from "node:http";
import Module from "node:module";
import type { AddressInfo } from "node:net";

const loader = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const load = loader._load;
loader._load = function (request: string, ...rest: unknown[]) {
  return request === "server-only" ? {} : load.call(this, request, ...rest);
};

async function main() {
  let request: { systemInstruction?: { parts?: { text?: string }[] }; contents?: { parts?: { text?: string }[] }[] } | undefined;
  const server = createServer((incoming, response) => {
    let raw = "";
    incoming.on("data", (chunk) => (raw += chunk));
    incoming.on("end", () => {
      request = JSON.parse(raw);
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Google Places data has no recorded halal tag for Monday breakfast; verify the menu directly. The plan is £65 over budget." }] } }] }));
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  process.env.GEMINI_API_KEY = "test-key";
  process.env.GEMINI_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const { generatePlanNarrative } = await import("@/lib/server/plan-narrative");
  const narrative = await generatePlanNarrative({
    source: "live",
    budget: 5000,
    total: 5065,
    remaining: -65,
    fits: false,
    meals: [{ label: "Monday breakfast", restaurantId: "place-cafe", missing: ["halal"] }],
    restaurants: [{ id: "place-cafe", name: "Oxford Café", serves: ["veg", "vegan", "gf"] }],
  });

  assert.match(narrative, /no recorded halal tag/);
  assert.match(request?.systemInstruction?.parts?.[0]?.text ?? "", /never claim that a restaurant cannot serve/);
  assert.match(request?.contents?.[0]?.parts?.[0]?.text ?? "", /Monday breakfast/);

  await generatePlanNarrative({
    source: "fallback",
    budget: 5000,
    total: 4900,
    remaining: 100,
    fits: true,
    meals: [{ label: "Monday dinner", restaurantId: "seed-curry", missing: [] }],
    restaurants: [{ id: "seed-curry", name: "Cowley Road Curry House", serves: ["veg", "vegan", "halal", "gf"] }],
  });
  assert.match(request?.contents?.[0]?.parts?.[0]?.text ?? "", /fallback/);
  server.close();
  console.log("test-plan-narrative: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

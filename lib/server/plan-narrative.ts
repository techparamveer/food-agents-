import "server-only";

import { generate } from "@/lib/server/gemini";
import type { DataSource } from "@/lib/restaurants/types";
import type { Dietary } from "@/lib/types";

export type PlanNarrativeInput = {
  source: DataSource;
  budget: number;
  total: number;
  remaining: number;
  fits: boolean;
  meals: {
    label: string;
    restaurantId: string;
    missing: Dietary[];
  }[];
  restaurants: {
    id: string;
    name: string;
    serves: Dietary[];
  }[];
};

const SYSTEM = `Write a concise planning note from the supplied restaurant data. The source field may identify live or do not discuss provenance because the interface labels it separately.
Use only facts in the JSON. Dietary tags are recorded or inferred coverage, not verified menu guarantees: describe a tag as missing from the available data, never claim that a restaurant cannot serve someone or that no restaurant can.
Group repeated patterns instead of listing every meal. Mention the most useful budget or dietary trade-off. Use British English, plain text, at most two sentences and 55 words. Do not use markdown.`;

export async function generatePlanNarrative(input: PlanNarrativeInput): Promise<string> {
  const parts = await generate({
    system: SYSTEM,
    contents: [{ role: "user", parts: [{ text: JSON.stringify(input) }] }],
    timeoutMs: 20_000,
  });
  const text = parts
    .flatMap((part) => ("text" in part ? [part.text] : []))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) throw new Error("Gemini returned no plan narrative");
  return text.slice(0, 600);
}

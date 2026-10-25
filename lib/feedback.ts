import type { FoodFeedback, FoodFeedbackSentiment } from "@/lib/types";

export const FOOD_FEEDBACK_OPTIONS: { id: FoodFeedbackSentiment; label: string; emoji: string }[] = [
  { id: "loved", label: "Loved it", emoji: "😍" },
  { id: "okay", label: "Okay", emoji: "🙂" },
  { id: "not_for_me", label: "Not for me", emoji: "😕" },
];

export type FoodFeedbackSummary = Record<FoodFeedbackSentiment, number> & {
  total: number;
  lovedPercent: number;
};

/** Counts anonymous reactions for one meal slot. */
export function summariseFoodFeedback(responses: FoodFeedback[], slotId: string): FoodFeedbackSummary {
  const summary: FoodFeedbackSummary = { loved: 0, okay: 0, not_for_me: 0, total: 0, lovedPercent: 0 };
  for (const response of responses) {
    if (response.slotId !== slotId) continue;
    summary[response.sentiment] += 1;
    summary.total += 1;
  }
  summary.lovedPercent = summary.total ? Math.round((summary.loved / summary.total) * 100) : 0;
  return summary;
}

import assert from "node:assert/strict";
import { summariseFoodFeedback } from "@/lib/feedback";
import type { FoodFeedback } from "@/lib/types";

const responses: FoodFeedback[] = [
  { id: "1", slotId: "lunch", sentiment: "loved", at: "2026-10-25T12:00:00Z" },
  { id: "2", slotId: "lunch", sentiment: "loved", at: "2026-10-25T12:01:00Z" },
  { id: "3", slotId: "lunch", sentiment: "okay", at: "2026-10-25T12:02:00Z" },
  { id: "4", slotId: "dinner", sentiment: "not_for_me", at: "2026-10-25T18:00:00Z" },
];

assert.deepEqual(summariseFoodFeedback(responses, "lunch"), {
  loved: 2,
  okay: 1,
  not_for_me: 0,
  total: 3,
  lovedPercent: 67,
});
assert.deepEqual(summariseFoodFeedback(responses, "breakfast"), {
  loved: 0,
  okay: 0,
  not_for_me: 0,
  total: 0,
  lovedPercent: 0,
});

console.log("test-feedback: ok");

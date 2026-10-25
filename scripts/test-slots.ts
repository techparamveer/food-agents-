import assert from "node:assert/strict";
import { proposeSlots } from "@/lib/planner";

/* Slot generation: meals between doors open and close, in London time, through BST changes. */

// OxHack: Saturday 10:00 → Sunday 16:00 (GMT in November).
const oxhack = proposeSlots({ eventId: "ox", headcount: 150, startsAt: "2026-11-14T10:00:00Z", endsAt: "2026-11-15T16:00:00Z" });
assert.deepEqual(
  oxhack.map((s) => [s.label, s.servesAt]),
  [
    ["Sat lunch", "2026-11-14T12:30:00Z"],
    ["Sat dinner", "2026-11-14T18:30:00Z"],
    ["Sat midnight snack", "2026-11-15T00:00:00Z"],
    ["Sun breakfast", "2026-11-15T08:30:00Z"],
    ["Sun lunch", "2026-11-15T12:30:00Z"],
  ],
);
assert.ok(oxhack.every((s) => s.headcount === 150 && s.eventId === "ox" && s.allowance === 1));
assert.equal(new Set(oxhack.map((s) => s.id)).size, oxhack.length, "slot ids are unique");

// Doors at 08:00 leave too little time for 08:30 breakfast (needs an hour), closing at 12:45 drops lunch (needs 30 min after).
const short = proposeSlots({ headcount: 40, startsAt: "2026-11-14T08:00:00Z", endsAt: "2026-11-14T12:45:00Z" });
assert.deepEqual(short.map((s) => s.kind), [], "no meal fits a 08:00–12:45 morning");
const morning = proposeSlots({ headcount: 40, startsAt: "2026-11-14T07:00:00Z", endsAt: "2026-11-14T13:00:00Z" });
assert.deepEqual(morning.map((s) => s.kind), ["breakfast", "lunch"]);

// Summer: London is UTC+1, so 18:30 dinner is 17:30Z.
const summer = proposeSlots({ headcount: 10, startsAt: "2026-06-06T09:00:00Z", endsAt: "2026-06-06T20:00:00Z" });
assert.deepEqual(summer.map((s) => [s.kind, s.servesAt]), [
  ["lunch", "2026-06-06T11:30:00Z"],
  ["dinner", "2026-06-06T17:30:00Z"],
]);

// Clocks go back on 25 Oct 2026: Saturday is BST, Sunday is GMT.
const clocks = proposeSlots({ headcount: 10, startsAt: "2026-10-24T09:00:00Z", endsAt: "2026-10-25T13:30:00Z" });
assert.deepEqual(
  clocks.map((s) => s.servesAt),
  ["2026-10-24T11:30:00Z", "2026-10-24T17:30:00Z", "2026-10-24T23:00:00Z", "2026-10-25T08:30:00Z", "2026-10-25T12:30:00Z"],
);

// Three days produce two midnight snacks with distinct labels.
const long = proposeSlots({ headcount: 10, startsAt: "2026-11-13T17:00:00Z", endsAt: "2026-11-15T17:00:00Z" });
assert.deepEqual(long.filter((s) => s.kind === "snack").map((s) => s.label), ["Fri midnight snack", "Sat midnight snack"]);

assert.deepEqual(proposeSlots({ headcount: 10, startsAt: "2026-11-15T10:00:00Z", endsAt: "2026-11-14T10:00:00Z" }), [], "end before start");

console.log("test-slots: ok");

import assert from "node:assert/strict";
import { countdown, deadlineApproximation, deadlineLine, deadlineWindowPhase, orderBy } from "@/lib/countdown";

/* Countdown maths: order-by = slot time − prep − delivery; labels round down. */

// The spec example: 18:30 dinner, 20 min prep + 30 min ride → order by 17:40.
const by = orderBy("2026-11-14T18:30:00Z", 20, 30);
assert.equal(by, "2026-11-14T17:40:00Z");
assert.equal(deadlineLine(by, "2026-11-14T18:30:00Z", "Dinner"), "Order by 17:40 for 18:30 dinner");
// BST: wall clock is an hour ahead of UTC.
assert.equal(deadlineLine(orderBy("2026-06-06T17:30:00Z", 20, 30), "2026-06-06T17:30:00Z", "dinner"), "Order by 17:40 for 18:30 dinner");
assert.equal(orderBy("2026-11-14T18:30:00Z", -5, 0), "2026-11-14T18:30:00Z", "negative lead is ignored");
assert.equal(orderBy("2026-11-15T00:00:00Z", 25, 10), "2026-11-14T23:25:00Z", "crosses midnight");

const now = "2026-11-14T17:05:00Z";
assert.deepEqual(countdown(now, "2026-11-14T17:40:00Z"), { minutes: 35, label: "35m", tone: "urgent" });
assert.deepEqual(countdown(now, "2026-11-14T18:05:00Z"), { minutes: 60, label: "1h 00m", tone: "soon" });
assert.deepEqual(countdown(now, "2026-11-14T20:10:00Z"), { minutes: 185, label: "3h 05m", tone: "ok" });
assert.deepEqual(countdown(now, "2026-11-15T19:05:00Z"), { minutes: 1560, label: "1d 2h", tone: "ok" });
assert.deepEqual(countdown(now, "2026-11-14T17:05:00Z"), { minutes: 0, label: "0m", tone: "urgent" });
assert.deepEqual(countdown(now, "2026-11-14T16:59:30Z"), { minutes: -6, label: "Overdue 6m", tone: "overdue" });
assert.equal(deadlineApproximation(Date.parse(now), "2026-11-14T17:40:00Z"), "in 35 min");
assert.equal(deadlineApproximation(now, "2026-11-15T19:05:00Z"), "in 1 d 2 h");
assert.equal(deadlineApproximation("2026-11-14T10:15:00Z", "2026-11-15T16:30:00Z"), "in 1 d 6 h 15 min");
assert.equal(deadlineApproximation(now, now), "passed");

// Deadline UI follows the event's Starts/Ends calendar window exactly.
const startsAt = "2026-11-14T10:00:00Z";
const endsAt = "2026-11-15T16:00:00Z";
assert.equal(deadlineApproximation(startsAt, endsAt), "in 1 d 6 h", "estimate is Ends minus Starts");
assert.equal(deadlineWindowPhase("2026-11-14T09:59:59Z", startsAt, endsAt), "before");
assert.equal(deadlineWindowPhase(startsAt, startsAt, endsAt), "active", "Starts is inclusive");
assert.equal(deadlineWindowPhase("2026-11-15T15:59:59Z", startsAt, endsAt), "active");
assert.equal(deadlineWindowPhase(endsAt, startsAt, endsAt), "ended", "Ends closes the window");

// Rounds down: 59.9 minutes left is still "59m".
assert.equal(countdown(Date.parse(now) + 6_000, "2026-11-14T18:05:00Z").label, "59m");

// Live ticking: one second past the deadline is overdue.
assert.equal(countdown(Date.parse("2026-11-14T17:40:01Z"), "2026-11-14T17:40:00Z").tone, "overdue");

console.log("test-countdown: ok");

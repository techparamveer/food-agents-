import assert from "node:assert/strict";
import { createResolver, hashFromPayload, HASH_PATTERN, payloadFor, placeholderHash } from "@/lib/qr";
import { OXHACK_ATTENDEES } from "@/lib/seed/oxhack";

/* QR resolution: hash → attendee lives in lib/qr.ts only. */

// Placeholder hashes are stable and well-formed.
assert.equal(placeholderHash("att-001"), placeholderHash("att-001"));
assert.notEqual(placeholderHash("att-001"), placeholderHash("att-002"));
assert.match(placeholderHash("att-001"), HASH_PATTERN);

// The seed: 150 attendees, unique ids, names, handles and hashes; local avatars only.
assert.equal(OXHACK_ATTENDEES.length, 150);
for (const key of ["id", "name", "discordHandle", "qrHash"] as const) {
  assert.equal(new Set(OXHACK_ATTENDEES.map((a) => a[key])).size, 150, `${key} should be unique`);
}
for (const a of OXHACK_ATTENDEES) {
  assert.match(a.qrHash, HASH_PATTERN);
  assert.ok(a.avatarUrl.startsWith("data:image/svg+xml,"), `${a.id} avatar should be generated locally`);
  assert.match(a.discordHandle, /^[a-z0-9._]{2,32}$/, `${a.discordHandle} should be a valid Discord username`);
}

const resolve = createResolver(OXHACK_ATTENDEES);

// Every attendee's printed payload resolves back to them.
for (const a of OXHACK_ATTENDEES) {
  const r = resolve(payloadFor(a));
  assert.ok(r.ok, `${a.id} should resolve`);
  assert.equal(r.attendee.id, a.id);
}

// Scanners add whitespace or change case; both still resolve.
const first = OXHACK_ATTENDEES[0];
assert.equal(hashFromPayload(`  ${first.qrHash.toUpperCase()}\n`), first.qrHash);
{
  const r = resolve(` ${first.qrHash.toUpperCase()} `);
  assert.ok(r.ok && r.attendee.id === first.id);
}

// Well-formed but not on the list.
{
  const r = resolve("ph_00000000");
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.reason, "unknown");
}

// Not one of our codes at all.
for (const text of ["", "hello", "https://example.com", "ph_123", "ph_zzzzzzzz", "ph_123456789"]) {
  const r = resolve(text);
  assert.equal(r.ok, false, text);
  assert.equal(!r.ok && r.reason, "malformed", text);
}

// The resolver follows the list it was built from: real hashes swap in by changing the data.
{
  const swapped = OXHACK_ATTENDEES.map((a, i) => (i === 0 ? { ...a, qrHash: "ph_deadbeef" } : a));
  const r2 = createResolver(swapped);
  assert.ok(r2("ph_deadbeef").ok);
  assert.equal(r2(first.qrHash).ok, false);
}

console.log("qr: all tests passed");

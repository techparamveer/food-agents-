import type { Attendee } from "@/lib/types";

/* The one place that knows what an attendee QR code contains.

   Format: the QR text is the attendee's `qrHash`, verbatim. Two kinds exist:
   - placeholder hashes, `ph_` + 8 lowercase hex digits: FNV-1a of the attendee id (the seed, the demo);
   - database hashes, `q_` + 32 random lowercase hex digits (the `attendees.qr_hash` default).

   Swapping in real hashes:
   1. Set each attendee's `qrHash` to the real value (seed or database). Nothing else stores hashes.
   2. If the real QR text wraps the hash (a URL, a prefix, JSON), change `hashFromPayload` to unwrap it.
   3. If the real hashes look different, change `HASH_PATTERN` so malformed scans are still caught.
   `payloadFor` must stay the inverse of `hashFromPayload`, so the demo QR sheet keeps scanning. */

/** What a valid hash looks like: a placeholder or a database hash. */
export const HASH_PATTERN = /^(?:ph_[0-9a-f]{8}|q_[0-9a-f]{32})$/;

/** FNV-1a, so placeholder hashes are stable across runs. */
export function placeholderHash(attendeeId: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < attendeeId.length; i++) {
    h ^= attendeeId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `ph_${(h >>> 0).toString(16).padStart(8, "0")}`;
}

/** The text to encode in an attendee's QR code. */
export function payloadFor(attendee: Pick<Attendee, "qrHash">) {
  return attendee.qrHash;
}

/** The hash inside scanned QR text, or null if it isn't one of ours. */
export function hashFromPayload(text: string) {
  const hash = text.trim().toLowerCase();
  return HASH_PATTERN.test(hash) ? hash : null;
}

export type Resolution =
  | { ok: true; attendee: Attendee }
  | { ok: false; reason: "malformed" | "unknown"; text: string };

/** Builds a hash → attendee lookup. Rebuild it when the attendee list changes. */
export function createResolver(attendees: readonly Attendee[]) {
  const byHash = new Map<string, Attendee>();
  for (const a of attendees) byHash.set(a.qrHash.trim().toLowerCase(), a);
  return (text: string): Resolution => {
    const hash = hashFromPayload(text);
    if (!hash) return { ok: false, reason: "malformed", text };
    const attendee = byHash.get(hash);
    return attendee ? { ok: true, attendee } : { ok: false, reason: "unknown", text };
  };
}

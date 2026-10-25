import type { Attendee } from "@/lib/types";

/* The one place that knows what an attendee QR code contains.

   Format (placeholder, v0): the QR text is the attendee's `qrHash`, verbatim.
   Placeholder hashes are `ph_` + 8 lowercase hex digits: FNV-1a of the attendee id.

   Swapping in real hashes:
   1. Set each attendee's `qrHash` to the real value (seed or database). Nothing else stores hashes.
   2. If the real QR text wraps the hash (a URL, a prefix, JSON), change `hashFromPayload` to unwrap it.
   3. If the real hashes look different, change `HASH_PATTERN` so malformed scans are still caught.
   Hashes are compared exactly, case and all, because real ones may be base64 or base58: only
   whitespace around the scanned text is trimmed. Don't add case folding unless the real format
   is case-insensitive (hex, say), and then fold in both `hashFromPayload` and `createResolver`.
   `payloadFor` must stay the inverse of `hashFromPayload`, so the demo QR sheet keeps scanning. */

/** What a valid hash looks like. Placeholder hashes only, for now. */
export const HASH_PATTERN = /^ph_[0-9a-f]{8}$/;

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
  const hash = text.trim();
  return HASH_PATTERN.test(hash) ? hash : null;
}

export type Resolution =
  | { ok: true; attendee: Attendee }
  | { ok: false; reason: "malformed" | "unknown"; text: string };

/** Builds a hash → attendee lookup. Rebuild it when the attendee list changes. */
export function createResolver(attendees: readonly Attendee[]) {
  const byHash = new Map<string, Attendee>();
  for (const a of attendees) byHash.set(a.qrHash.trim(), a);
  return (text: string): Resolution => {
    const hash = hashFromPayload(text);
    if (!hash) return { ok: false, reason: "malformed", text };
    const attendee = byHash.get(hash);
    return attendee ? { ok: true, attendee } : { ok: false, reason: "unknown", text };
  };
}

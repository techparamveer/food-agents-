import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/* What the chat route accepts as history. The browser sends the conversation back each turn, so
   anything in it could be forged: a fake "assistant" turn could put words (or prices) in Comeda's
   mouth. Assistant turns are only kept when they carry the signature the server attached to that
   exact reply; user turns are kept as the organiser's own words. Server-side only (node:crypto). */

export type ChatTurn = { role: "user" | "assistant"; text: string };

/** Turns sent to Gemini, and the most text kept from each. */
export const MAX_HISTORY_TURNS = 8;
export const MAX_TURN_CHARS = 1500;

export type ChatSigner = { sign: (text: string) => string; verify: (text: string, sig: unknown) => boolean };

/** HMAC over a reply's text. Without COMEDA_CHAT_SECRET the key is per process: a restart just
    drops older assistant turns from the context, which is harmless. */
export function chatSigner(secret: string = process.env.COMEDA_CHAT_SECRET || randomBytes(32).toString("hex")): ChatSigner {
  const sign = (text: string) => createHmac("sha256", secret).update(text).digest("base64url");
  return {
    sign,
    verify(text, sig) {
      if (typeof sig !== "string" || sig.length > 100) return false;
      const want = Buffer.from(sign(text));
      const got = Buffer.from(sig);
      return want.length === got.length && timingSafeEqual(want, got);
    },
  };
}

/** Raw request history → alternating turns that start with the user. Unsigned assistant turns are dropped. */
export function sanitizeHistory(raw: unknown, verify: ChatSigner["verify"]): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  const turns: ChatTurn[] = [];
  for (const t of raw.slice(-MAX_HISTORY_TURNS * 2)) {
    if (!t || typeof t !== "object" || typeof t.text !== "string" || !t.text.trim()) continue;
    if (t.role === "user") turns.push({ role: "user", text: t.text.slice(0, MAX_TURN_CHARS) });
    else if (t.role === "assistant" && verify(t.text, t.sig)) turns.push({ role: "assistant", text: t.text.slice(0, MAX_TURN_CHARS) });
  }
  // Gemini wants roles to alternate: fold repeats (e.g. two user turns around a dropped reply).
  const merged: ChatTurn[] = [];
  for (const t of turns) {
    const last = merged[merged.length - 1];
    if (last?.role === t.role) last.text = `${last.text}\n${t.text}`.slice(-MAX_TURN_CHARS);
    else merged.push({ ...t });
  }
  // The new message is a user turn, so history should end on Comeda's reply.
  if (merged[merged.length - 1]?.role === "user") merged.pop();
  const recent = merged.slice(-MAX_HISTORY_TURNS);
  while (recent[0]?.role === "assistant") recent.shift();
  return recent;
}

import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { adminClient } from "@/lib/supabase/admin";

/**
 * TTL cache for Places and Gemini responses, so the demo doesn't pay for (or wait on) the
 * same search twice. Memory first; behind it the Supabase `api_cache` table when Supabase is
 * configured (see supabase/migrations), otherwise JSON files in the OS temp dir.
 * Every failure is swallowed: a broken cache must never break a search.
 */

type Entry = { value: unknown; expiresAt: number };

const memory = new Map<string, Entry>();
const MEMORY_MAX = 500;

const supabaseConfigured = () =>
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY) && process.env.COMEDA_CACHE !== "file";

/* ---------- file store ---------- */

const dir = path.join(tmpdir(), "comeda-cache");
const fileFor = (key: string) => path.join(dir, `${createHash("sha256").update(key).digest("hex").slice(0, 32)}.json`);

async function fileGet(key: string): Promise<Entry | undefined> {
  try {
    const entry = JSON.parse(await readFile(fileFor(key), "utf8")) as Entry & { key: string };
    return entry.key === key ? entry : undefined;
  } catch {
    return undefined;
  }
}

async function fileSet(key: string, entry: Entry) {
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(fileFor(key), JSON.stringify({ key, ...entry }));
  } catch {
    /* read-only filesystem: memory still works */
  }
}

/* ---------- Supabase store ---------- */

async function supabaseGet(key: string): Promise<Entry | undefined> {
  try {
    const { data } = await adminClient().from("api_cache").select("value, expires_at").eq("key", key).maybeSingle();
    return data ? { value: data.value, expiresAt: Date.parse(data.expires_at) } : undefined;
  } catch {
    return undefined;
  }
}

async function supabaseSet(key: string, entry: Entry) {
  try {
    await adminClient()
      .from("api_cache")
      .upsert({ key, value: entry.value, expires_at: new Date(entry.expiresAt).toISOString() });
  } catch {
    /* table missing or Supabase down: memory still works */
  }
}

/* ---------- public API ---------- */

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  const now = Date.now();
  const hot = memory.get(key);
  if (hot && hot.expiresAt > now) return hot.value as T;
  const cold = supabaseConfigured() ? await supabaseGet(key) : await fileGet(key);
  if (!cold || cold.expiresAt <= now) return undefined;
  remember(key, cold);
  return cold.value as T;
}

export async function cacheSet(key: string, value: unknown, ttlMs: number): Promise<void> {
  const entry = { value, expiresAt: Date.now() + ttlMs };
  remember(key, entry);
  await (supabaseConfigured() ? supabaseSet(key, entry) : fileSet(key, entry));
}

function remember(key: string, entry: Entry) {
  if (memory.size >= MEMORY_MAX) memory.delete(memory.keys().next().value!);
  memory.set(key, entry);
}

export const HOUR = 3_600_000;

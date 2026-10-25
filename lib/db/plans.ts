import { planFromRow, savePlanResultFromJson, type SavePlanPayload } from "@/lib/db/mappers";
import { maybe, unwrap, type Db } from "@/lib/db/types";
import type { Json } from "@/lib/supabase/database.types";
import type { Plan } from "@/lib/types";

/* Plans. Saving is one transaction in the database (save_plan): slots reconciled, the plan stored,
   planned orders rewritten, placed orders left alone. Build the payload with savePlanPayload(). */

export async function latestPlan(db: Db, eventId: string): Promise<Plan | null> {
  const row = maybe(await db.from("plans").select("*").eq("event_id", eventId).order("created_at", { ascending: false }).limit(1).maybeSingle());
  return row ? planFromRow(row) : null;
}

/** Saves (and with `approve: true` approves) a plan. Returns the plan id and new slot ids by client id. */
export async function savePlan(db: Db, eventId: string, payload: SavePlanPayload | Record<string, unknown>) {
  return savePlanResultFromJson(unwrap(await db.rpc("save_plan", { p_event_id: eventId, p_plan: payload as unknown as Json })));
}

import type { SlotRules } from "@/lib/allowance";
import { rulesFromSlotRow, rulesToSlotUpdate, slotFromRow } from "@/lib/db/mappers";
import { unwrap, type Db } from "@/lib/db/types";
import type { MealSlot } from "@/lib/types";

/* Meal slots and their meal check rules. Plans create and reconcile slots in bulk (plans.ts);
   these are for reading and per-slot edits. */

export async function listSlots(db: Db, eventId: string): Promise<(MealSlot & { rules: SlotRules })[]> {
  const rows = unwrap(await db.from("meal_slots").select("*").eq("event_id", eventId).order("serves_at"));
  return rows.map((row) => ({ ...slotFromRow(row), rules: rulesFromSlotRow(row) }));
}

/** Changes a slot's meal check rules (organisers only). */
export async function updateSlotRules(db: Db, eventId: string, slotId: string, rules: Partial<SlotRules>): Promise<MealSlot & { rules: SlotRules }> {
  const row = unwrap(await db.from("meal_slots").update(rulesToSlotUpdate(rules)).eq("id", slotId).eq("event_id", eventId).select().single());
  return { ...slotFromRow(row), rules: rulesFromSlotRow(row) };
}

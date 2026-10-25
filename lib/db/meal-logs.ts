import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { mealLogFromRow, orderFromRow, serveResultFromJson, type ServeResult } from "@/lib/db/mappers";
import { unwrap, type Db, type MealLogRow, type OrderRow } from "@/lib/db/types";
import type { MealLog, Order } from "@/lib/types";

/* The meal check. Serving goes through serve_meal(), which checks the slot's allowance under a lock,
   so two phones scanning the same badge can't both serve. Undo stamps the log rather than deleting it. */

export async function listMealLogs(db: Db, eventId: string, { slotId, includeUndone = false }: { slotId?: string; includeUndone?: boolean } = {}): Promise<MealLog[]> {
  let q = db.from("meal_logs").select("*").eq("event_id", eventId);
  if (slotId) q = q.eq("slot_id", slotId);
  if (!includeUndone) q = q.is("undone_at", null);
  const rows = unwrap(await q.order("served_at").limit(50_000));
  return rows.map(mealLogFromRow);
}

/** Serves one meal, or says why not (`code`: not-open, closed, used, seconds-later). */
export async function serveMeal(db: Db, slotId: string, attendeeId: string, method: MealLog["method"] = "qr"): Promise<ServeResult> {
  return serveResultFromJson(unwrap(await db.rpc("serve_meal", { p_slot_id: slotId, p_attendee_id: attendeeId, p_method: method })));
}

/** Undoes a serve. 404 if it isn't visible or was already undone. */
export async function undoMeal(db: Db, logId: string): Promise<MealLog> {
  return mealLogFromRow(unwrap(await db.rpc("undo_meal", { p_log_id: logId })));
}

export type MealLogChange =
  | { type: "served"; log: MealLog }
  | { type: "undone"; log: MealLog };

/**
 * Live meal check for one event (step F): every device sees serves and undos as they happen.
 * Use the browser client from a Client Component, and call the returned function to unsubscribe.
 * RLS applies, so only members of the event receive anything.
 */
export function subscribeToMealLogs(db: Db, eventId: string, onChange: (change: MealLogChange) => void): () => void {
  const channel = db
    .channel(`meal_logs:${eventId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "meal_logs", filter: `event_id=eq.${eventId}` }, (payload: RealtimePostgresChangesPayload<MealLogRow>) => {
      if (payload.eventType === "INSERT") onChange({ type: "served", log: mealLogFromRow(payload.new) });
      else if (payload.eventType === "UPDATE" && payload.new.undone_at) onChange({ type: "undone", log: mealLogFromRow(payload.new) });
    })
    .subscribe();
  return () => {
    void db.removeChannel(channel);
  };
}

/** Live order status and quantities for one event. */
export function subscribeToOrders(db: Db, eventId: string, onChange: (order: Order, type: "INSERT" | "UPDATE" | "DELETE") => void): () => void {
  const channel = db
    .channel(`orders:${eventId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `event_id=eq.${eventId}` }, (payload: RealtimePostgresChangesPayload<OrderRow>) => {
      if (payload.eventType === "DELETE") {
        if (payload.old.id) onChange({ id: payload.old.id } as Order, "DELETE");
      } else onChange(orderFromRow(payload.new), payload.eventType);
    })
    .subscribe();
  return () => {
    void db.removeChannel(channel);
  };
}

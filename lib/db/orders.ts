import { orderFromRow } from "@/lib/db/mappers";
import { unwrap, type Db } from "@/lib/db/types";
import type { OrderPatch } from "@/lib/db/validate";
import type { Json } from "@/lib/supabase/database.types";
import type { Order } from "@/lib/types";

/* Orders: one per meal slot, created by plans. Organisers change status, quantities and platform;
   staff only read. ordered_at follows the status (database trigger). */

export async function listOrders(db: Db, eventId: string): Promise<Order[]> {
  const rows = unwrap(await db.from("orders").select("*").eq("event_id", eventId));
  return rows.map(orderFromRow);
}

export async function updateOrder(db: Db, eventId: string, orderId: string, patch: OrderPatch): Promise<Order> {
  const update = {
    ...(patch.status ? { status: patch.status } : {}),
    ...(patch.platform ? { platform: patch.platform } : {}),
    ...(patch.lines ? { lines: patch.lines as unknown as Json } : {}),
  };
  return orderFromRow(unwrap(await db.from("orders").update(update).eq("id", orderId).eq("event_id", eventId).select().single()));
}

import { undoMeal } from "@/lib/db";
import { authed, ids, json } from "@/lib/server/api";

type Ctx = { params: Promise<{ eventId: string; logId: string }> };

/** DELETE /api/events/:eventId/meals/:logId → { log }: undoes a serve (the log is kept, stamped undone). Any member. */
export const DELETE = authed<Ctx>(async (_request, { db }, { params }) => {
  const { logId } = await ids(params);
  return json({ log: await undoMeal(db, logId) });
});

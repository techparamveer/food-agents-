import { latestPlan, savePlan } from "@/lib/db";
import { checkPlanSave } from "@/lib/db/validate";
import { authed, body, ids, json, valid } from "@/lib/server/api";

type Ctx = { params: Promise<{ eventId: string }> };

/** GET /api/events/:eventId/plan → { plan | null }: the latest saved plan. */
export const GET = authed<Ctx>(async (_request, { db }, { params }) => {
  const { eventId } = await ids(params);
  return json({ plan: await latestPlan(db, eventId) });
});

/**
 * POST /api/events/:eventId/plan → 201 { planId, slotIds }. Organisers only.
 * Body: savePlanPayload(applyPlan(data, mealPlan, now), { approve }) from lib/db/mappers.ts. One transaction:
 * slots reconciled (new client ids → database ids in `slotIds`), plan stored, planned orders rewritten,
 * placed orders untouched. `approve: true` marks the plan approved.
 */
export const POST = authed<Ctx>(async (request, { db }, { params }) => {
  const { eventId } = await ids(params);
  const payload = valid(checkPlanSave(await body(request, 1_000_000)));
  return json(await savePlan(db, eventId, payload), 201);
});

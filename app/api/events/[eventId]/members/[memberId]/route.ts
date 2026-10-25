import { removeMember, setMemberRole } from "@/lib/db";
import { ApiError, authed, body, ids, json } from "@/lib/server/api";

type Ctx = { params: Promise<{ eventId: string; memberId: string }> };

/** PATCH /api/events/:eventId/members/:memberId { role } → { member }. Organisers only. */
export const PATCH = authed<Ctx>(async (request, { db }, { params }) => {
  const { memberId } = await ids(params);
  const { role } = (await body(request)) as { role?: unknown };
  if (role !== "staff" && role !== "organiser") throw new ApiError(400, 'role must be "staff" or "organiser"');
  return json({ member: await setMemberRole(db, memberId, role) });
});

/** DELETE /api/events/:eventId/members/:memberId → 204. Organisers remove anyone; anyone can leave. The last organiser stays. */
export const DELETE = authed<Ctx>(async (_request, { db }, { params }) => {
  const { memberId } = await ids(params);
  if (!(await removeMember(db, memberId))) throw new ApiError(404, "Not found");
  return new Response(null, { status: 204 });
});

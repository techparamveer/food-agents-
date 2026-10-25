import { inviteMember, listMembers } from "@/lib/db";
import { checkInvite } from "@/lib/db/validate";
import { authed, body, ids, json, valid } from "@/lib/server/api";

type Ctx = { params: Promise<{ eventId: string }> };

/** GET /api/events/:eventId/members → { members }: organisers, staff and pending invites. */
export const GET = authed<Ctx>(async (_request, { db }, { params }) => {
  const { eventId } = await ids(params);
  return json({ members: await listMembers(db, eventId) });
});

/** POST /api/events/:eventId/members { email, role? = "staff" } → 201 { member }. Organisers only.
    The invitee joins when they first sign in with that email. No email is sent yet: share the sign-in link. */
export const POST = authed<Ctx>(async (request, { db }, { params }) => {
  const { eventId } = await ids(params);
  const { email, role } = valid(checkInvite(await body(request)));
  return json({ member: await inviteMember(db, eventId, email, role) }, 201);
});

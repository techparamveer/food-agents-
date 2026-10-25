import { memberFromRow } from "@/lib/db/mappers";
import { unwrap, type Db, type EventRole, type Member } from "@/lib/db/types";

/* The team: organisers and staff. Staff are invited by email and join when they first sign in
   with that address (accept_invites() runs in /auth/confirm). */

export async function listMembers(db: Db, eventId: string): Promise<Member[]> {
  const rows = unwrap(await db.from("event_members").select("*").eq("event_id", eventId).order("created_at"));
  return rows.map(memberFromRow);
}

/** Invites an email to the event (organisers only). Inviting the same address twice is a 409. */
export async function inviteMember(db: Db, eventId: string, email: string, role: EventRole = "staff"): Promise<Member> {
  const row = unwrap(
    await db.from("event_members").insert({ event_id: eventId, invited_email: email.trim().toLowerCase(), role }).select().single(),
  );
  return memberFromRow(row);
}

export async function setMemberRole(db: Db, memberId: string, role: EventRole): Promise<Member> {
  return memberFromRow(unwrap(await db.from("event_members").update({ role }).eq("id", memberId).select().single()));
}

/** Removes a member or cancels an invite. The last organiser can't be removed. */
export async function removeMember(db: Db, memberId: string): Promise<boolean> {
  const rows = unwrap(await db.from("event_members").delete().eq("id", memberId).select("id"));
  return rows.length > 0;
}

/** Claims the signed-in user's pending invites; returns how many. */
export async function acceptInvites(db: Db): Promise<number> {
  return unwrap(await db.rpc("accept_invites"));
}

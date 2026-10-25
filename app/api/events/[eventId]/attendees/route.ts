import { importAttendeesCsv, insertAttendees, listAttendees, MAX_IMPORT_ROWS } from "@/lib/db";
import type { AttendeeImportRow } from "@/lib/db/mappers";
import { ApiError, authed, body, ids, json, textBody } from "@/lib/server/api";

type Ctx = { params: Promise<{ eventId: string }> };

/** GET /api/events/:eventId/attendees → { attendees }. */
export const GET = authed<Ctx>(async (_request, { db }, { params }) => {
  const { eventId } = await ids(params);
  return json({ attendees: await listAttendees(db, eventId) });
});

/**
 * POST /api/events/:eventId/attendees → { imported, failed, results: [{ line, attendeeId? , error? }] }. Organisers only.
 * Send the CSV as `text/csv` (columns: name or first/last name, email, discord, dietary, qr hash), or JSON
 * `{ rows: [{ name, email?, discord_handle?, dietary?, qr_hash? }] }`. Good rows are imported even when others fail.
 */
export const POST = authed<Ctx>(async (request, { db }, { params }) => {
  const { eventId } = await ids(params);
  if ((request.headers.get("content-type") ?? "").includes("text/csv")) {
    const csv = await textBody(request, 2_000_000);
    try {
      return json(await importAttendeesCsv(db, eventId, csv));
    } catch (error) {
      if (error instanceof Error && !("status" in error)) throw new ApiError(400, error.message);
      throw error;
    }
  }
  const { rows } = (await body(request, 2_000_000)) as { rows?: unknown };
  if (!Array.isArray(rows) || rows.length > MAX_IMPORT_ROWS) throw new ApiError(400, `Send rows: a list of at most ${MAX_IMPORT_ROWS}`);
  return json(await insertAttendees(db, eventId, rows.map((r, i) => ({ ...(r as AttendeeImportRow), line: i + 1 }))));
});

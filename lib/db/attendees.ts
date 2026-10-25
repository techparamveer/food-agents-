import { attendeesFromCsv, type CsvError } from "@/lib/db/csv";
import { attendeeFromRow, type AttendeeImportRow } from "@/lib/db/mappers";
import { HASH_PATTERN } from "@/lib/qr";
import { maybe, unwrap, type Db } from "@/lib/db/types";
import type { Attendee } from "@/lib/types";

/* Attendees: students are records, never users. Imported from CSV; each gets a random QR hash
   unless the file brings its own (lib/qr.ts). */

export async function listAttendees(db: Db, eventId: string): Promise<Attendee[]> {
  const rows = unwrap(await db.from("attendees").select("*").eq("event_id", eventId).order("name").limit(10_000));
  return rows.map(attendeeFromRow);
}

/** The attendee a scanned hash belongs to, at this event. */
export async function findAttendeeByQrHash(db: Db, eventId: string, qrHash: string): Promise<Attendee | null> {
  const row = maybe(await db.from("attendees").select("*").eq("event_id", eventId).eq("qr_hash", qrHash.trim().toLowerCase()).maybeSingle());
  return row ? attendeeFromRow(row) : null;
}

export type ImportRowResult = { line: number; attendeeId?: string; error?: string };
export type ImportResult = { imported: number; failed: number; results: ImportRowResult[] };

/** Inserts rows (organisers only). One bad row never blocks the rest: each gets its own result. */
export async function insertAttendees(db: Db, eventId: string, input: (AttendeeImportRow & { line?: number })[]): Promise<ImportResult> {
  // A hash lib/qr.ts wouldn't accept could never be scanned, so it fails here rather than in the database.
  const unscannable = input.filter((r) => r.qr_hash && !HASH_PATTERN.test(r.qr_hash.trim().toLowerCase()));
  const rows = input.filter((r) => !unscannable.includes(r));
  const rejected = unscannable.map((r, i): ImportRowResult => ({ line: r.line ?? i + 1, error: "Invalid QR hash" }));
  if (!rows.length) return summarise(rejected);
  const payload = rows.map((r): AttendeeImportRow => ({
    name: r.name,
    ...(r.email ? { email: r.email } : {}),
    ...(r.discord_handle ? { discord_handle: r.discord_handle } : {}),
    ...(r.dietary ? { dietary: r.dietary } : {}),
    ...(r.qr_hash ? { qr_hash: r.qr_hash } : {}),
  }));
  const out = unwrap(await db.rpc("import_attendees", { p_event_id: eventId, p_rows: payload }));
  const results = out
    .sort((a, b) => a.row_index - b.row_index)
    .map((r): ImportRowResult => {
      const line = rows[r.row_index]?.line ?? r.row_index + 1;
      return r.error ? { line, error: r.error } : { line, attendeeId: r.attendee_id };
    });
  return summarise([...results, ...rejected].sort((x, y) => x.line - y.line));
}

/** Parses and imports a CSV. Rows the parser rejects and rows the database rejects come back together, by line. */
export async function importAttendeesCsv(db: Db, eventId: string, csv: string): Promise<ImportResult> {
  const parsed = attendeesFromCsv(csv);
  const inserted = await insertAttendees(db, eventId, parsed.rows);
  const parseErrors = parsed.errors.map((e: CsvError): ImportRowResult => ({ line: e.line, error: e.error }));
  return summarise([...inserted.results, ...parseErrors].sort((a, b) => a.line - b.line));
}

function summarise(results: ImportRowResult[]): ImportResult {
  const failed = results.filter((r) => r.error).length;
  return { imported: results.length - failed, failed, results };
}

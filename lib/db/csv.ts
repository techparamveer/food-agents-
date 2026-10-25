import { HASH_PATTERN } from "@/lib/qr";
import type { AttendeeImportRow } from "@/lib/db/mappers";
import type { Dietary } from "@/lib/types";

/* Attendee CSV import: parse, map headers, validate each row. Pure, so it runs in the browser
   (instant feedback) and on the server (the source of truth before import_attendees()).
   Lines are 1-based file lines (the header is line 1), so errors point at what the organiser sees. */

export const MAX_IMPORT_ROWS = 5000;

/** RFC 4180-ish: quoted fields, doubled quotes, commas and newlines inside quotes, CRLF, a BOM. */
export function parseCsv(text: string): string[][] {
  return parseRecords(text).map((r) => r.cells);
}

/** Records with the file line each starts on (a quoted field can span lines). */
function parseRecords(text: string): { cells: string[]; line: number }[] {
  const records: { cells: string[]; line: number }[] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let start = 1;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else {
        if (c === "\n") line++;
        field += c;
      }
    } else if (c === '"' && field === "") quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      records.push({ cells: row, line: start });
      row = [];
      field = "";
      line++;
      start = line;
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    records.push({ cells: row, line: start });
  }
  return records;
}

type Column = "name" | "first" | "last" | "email" | "discord" | "dietary" | "qr";

const HEADERS: Record<string, Column> = {
  name: "name",
  "full name": "name",
  fullname: "name",
  attendee: "name",
  "attendee name": "name",
  "first name": "first",
  firstname: "first",
  "given name": "first",
  "last name": "last",
  lastname: "last",
  surname: "last",
  "family name": "last",
  email: "email",
  "e-mail": "email",
  "email address": "email",
  discord: "discord",
  "discord handle": "discord",
  "discord username": "discord",
  "discord name": "discord",
  dietary: "dietary",
  diet: "dietary",
  "dietary needs": "dietary",
  "dietary requirements": "dietary",
  "dietary requirement": "dietary",
  qr: "qr",
  "qr hash": "qr",
  "qr code": "qr",
  qr_hash: "qr",
};

const DIETARY_WORDS: Record<string, Dietary | null> = {
  "": null,
  none: null,
  no: null,
  "n/a": null,
  na: null,
  standard: null,
  veg: "veg",
  vegetarian: "veg",
  vegan: "vegan",
  halal: "halal",
  gf: "gf",
  "gluten free": "gf",
  "gluten-free": "gf",
  coeliac: "gf",
  celiac: "gf",
};

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type CsvRow = AttendeeImportRow & { line: number };
export type CsvError = { line: number; error: string };
export type CsvResult = { rows: CsvRow[]; errors: CsvError[]; columns: Column[] };

/** Valid attendee rows and per-line errors. Throws only for a file it can't read at all. */
export function attendeesFromCsv(text: string): CsvResult {
  const table = parseRecords(text).filter((r) => r.cells.some((f) => f.trim() !== ""));
  if (!table.length) throw new Error("The CSV is empty.");
  const header = table[0].cells.map((h) => HEADERS[h.trim().toLowerCase().replace(/\s+/g, " ")]);
  const at = (c: Column) => header.indexOf(c);
  if (at("name") < 0 && at("first") < 0) throw new Error('Add a "name" column (or "first name" and "last name").');
  if (table.length - 1 > MAX_IMPORT_ROWS) throw new Error(`At most ${MAX_IMPORT_ROWS.toLocaleString("en-GB")} attendees per import.`);

  const rows: CsvRow[] = [];
  const errors: CsvError[] = [];
  const seenEmails = new Map<string, number>();
  const seenQr = new Map<string, number>();
  for (const { cells, line } of table.slice(1)) {
    const get = (c: Column) => (at(c) >= 0 ? (cells[at(c)] ?? "").trim() : "");
    const name = get("name") || [get("first"), get("last")].filter(Boolean).join(" ");
    const email = get("email").toLowerCase();
    const discord = get("discord").replace(/^@/, "");
    const dietaryText = get("dietary").toLowerCase();
    const qr = get("qr").toLowerCase();

    const problem = !name
      ? "Name is required"
      : name.length > 120
        ? "Name must be 1–120 characters"
        : email && !EMAIL.test(email)
          ? `Invalid email: ${email}`
          : email && seenEmails.has(email)
            ? `Duplicate email (also on line ${seenEmails.get(email)})`
            : discord.length > 40
              ? "Discord handle is too long"
              : !Object.hasOwn(DIETARY_WORDS, dietaryText)
                ? `Unknown dietary need "${get("dietary")}" (use vegetarian, vegan, halal or gluten-free)`
                : qr && !HASH_PATTERN.test(qr)
                  ? "Invalid QR hash"
                  : qr && seenQr.has(qr)
                    ? `Duplicate QR hash (also on line ${seenQr.get(qr)})`
                    : null;
    if (problem) {
      errors.push({ line, error: problem });
      continue;
    }

    if (email) seenEmails.set(email, line);
    if (qr) seenQr.set(qr, line);
    const dietary = DIETARY_WORDS[dietaryText];
    rows.push({
      line,
      name,
      ...(email ? { email } : {}),
      ...(discord ? { discord_handle: discord } : {}),
      ...(dietary ? { dietary } : {}),
      ...(qr ? { qr_hash: qr } : {}),
    });
  }

  return { rows, errors, columns: header.filter((c): c is Column => Boolean(c)) };
}

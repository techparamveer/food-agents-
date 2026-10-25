/* Comeda's data layer. Repositories take a typed Supabase client and run as its user (RLS applies):
   on the server, `await createClient()` from lib/supabase/server.ts; in the browser (Realtime only),
   `createClient()` from lib/supabase/client.ts. Mappers turn rows into lib/types.ts domain types. */

export * from "@/lib/db/types";
export * from "@/lib/db/mappers";
export * from "@/lib/db/events";
export * from "@/lib/db/members";
export * from "@/lib/db/slots";
export * from "@/lib/db/plans";
export * from "@/lib/db/orders";
export * from "@/lib/db/attendees";
export * from "@/lib/db/meal-logs";
export { attendeesFromCsv, parseCsv, MAX_IMPORT_ROWS, type CsvResult, type CsvRow, type CsvError } from "@/lib/db/csv";

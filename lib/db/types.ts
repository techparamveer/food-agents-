import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database, Enums, Tables } from "@/lib/supabase/database.types";

/* Shared by the repositories. A `Db` is any typed Supabase client: the server one from
   lib/supabase/server.ts (RLS as the signed-in organiser) or the browser one for Realtime. */

export type Db = SupabaseClient<Database>;

export type EventRow = Tables<"events">;
export type MemberRow = Tables<"event_members">;
export type SlotRow = Tables<"meal_slots">;
export type PlanRow = Tables<"plans">;
export type OrderRow = Tables<"orders">;
export type AttendeeRow = Tables<"attendees">;
export type MealLogRow = Tables<"meal_logs">;

export type EventRole = Enums<"event_role">;

/** Someone on an event's team, or a pending invite (no user yet). */
export type Member = {
  id: string;
  eventId: string;
  userId: string | null;
  /** The invited address. Null for the creator, who wasn't invited. */
  email: string | null;
  role: EventRole;
  pending: boolean;
  acceptedAt: string | null;
};

/** A database failure with the HTTP status an API route should answer with. */
export class DbError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "DbError";
  }
}

/** Postgres / PostgREST error codes → HTTP status. RLS hides rows rather than failing, so "not found"
    is also what a caller sees for someone else's event. */
export function statusFor(code: string | undefined): number {
  switch (code) {
    case "42501": // insufficient_privilege: RLS refused an insert, or a role check in an RPC
      return 403;
    case "P0002": // no_data_found (raised by RPCs)
    case "PGRST116": // .single() found no row
      return 404;
    case "23505": // unique_violation
      return 409;
    case "23502": // not_null_violation
    case "23503": // foreign_key_violation
    case "23514": // check_violation
    case "22023": // invalid_parameter_value
    case "22P02": // invalid_text_representation (bad uuid or enum)
    case "22007": // invalid_datetime_format
    case "22008": // datetime_field_overflow
    case "P0001": // raise_exception (RPC business rules)
      return 400;
    default:
      return 500;
  }
}

export function toDbError(error: PostgrestError | { message: string; code?: string }): DbError {
  return new DbError(error.message, statusFor(error.code), error.code);
}

/** Unwraps a Supabase response: the data, or a thrown DbError. */
export function unwrap<T>({ data, error }: { data: T; error: PostgrestError | null }): NonNullable<T> {
  if (error) throw toDbError(error);
  if (data === null || data === undefined) throw new DbError("Not found", 404);
  return data;
}

/** Like unwrap, for queries where no row is a normal answer (maybeSingle). */
export function maybe<T>({ data, error }: { data: T | null; error: PostgrestError | null }): T | null {
  if (error) throw toDbError(error);
  return data;
}

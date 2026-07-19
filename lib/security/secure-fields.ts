import { decryptPii, encryptPii } from "@/lib/security/pii";

type Row = Record<string, unknown>;

const EVENT_FIELDS = ["title", "description", "public_note", "admin_note", "rejection_reason"] as const;
const CHANGE_FIELDS = ["reason", "proposed_title", "proposed_description", "proposed_public_note", "proposed_admin_note", "rejection_reason"] as const;
const MESSAGE_FIELDS = ["title", "content"] as const;

function transform<T>(row: T, fields: readonly string[], mode: "encrypt" | "decrypt"): T {
  if (!row || typeof row !== "object") return row;
  const result: Row = { ...(row as Row) };
  for (const field of fields) {
    const value = result[field];
    if (typeof value === "string") result[field] = mode === "encrypt" ? encryptPii(value) : decryptPii(value);
  }
  return result as T;
}

export function encryptCalendarEventFields<T>(row: T) { return transform(row, EVENT_FIELDS, "encrypt"); }
export function decryptCalendarEvent<T>(row: T) { return transform(row, EVENT_FIELDS, "decrypt"); }
export function decryptCalendarEvents<T>(rows: T[] | null | undefined) { return (rows ?? []).map(decryptCalendarEvent); }

export function encryptEventChangeFields<T>(row: T) { return transform(row, CHANGE_FIELDS, "encrypt"); }
export function decryptEventChange<T>(row: T) { return transform(row, CHANGE_FIELDS, "decrypt"); }
export function decryptEventChanges<T>(rows: T[] | null | undefined) { return (rows ?? []).map(decryptEventChange); }

export function encryptMessageFields<T>(row: T) { return transform(row, MESSAGE_FIELDS, "encrypt"); }
export function decryptMessage<T>(row: T) { return transform(row, MESSAGE_FIELDS, "decrypt"); }
export function decryptMessages<T>(rows: T[] | null | undefined) { return (rows ?? []).map(decryptMessage); }


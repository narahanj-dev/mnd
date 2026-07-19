import { createHmac } from "node:crypto";
import type { createAdminClient } from "@/lib/supabase/admin";
import { SecurityError } from "@/lib/security/errors";

function pepper() {
  const value = process.env.PASSWORD_HISTORY_PEPPER?.trim();
  if (!value || value.length < 32) {
    throw new Error("PASSWORD_HISTORY_PEPPER 환경변수는 32자 이상이어야 합니다.");
  }
  return value;
}

function fingerprint(userId: string, password: string) {
  return createHmac("sha256", pepper()).update(`${userId}:${password}`, "utf8").digest("hex");
}

type AdminClient = ReturnType<typeof createAdminClient>;

export async function ensurePasswordNotReused(admin: AdminClient, userId: string, password: string) {
  const hash = fingerprint(userId, password);
  const { data, error } = await admin
    .from("password_history")
    .select("id")
    .eq("user_id", userId)
    .eq("password_fingerprint", hash)
    .limit(1);
  if (error) throw new SecurityError("PASSWORD_HISTORY_ERROR", 500, "비밀번호 이력을 확인하지 못했습니다.");
  if ((data ?? []).length > 0) {
    throw new SecurityError("PASSWORD_REUSED", 400, "최근 사용한 비밀번호는 다시 사용할 수 없습니다.");
  }
}

export async function insertPasswordRecord(
  admin: AdminClient,
  userId: string,
  password: string,
  options?: { allowExisting?: boolean },
) {
  const payload = {
    user_id: userId,
    password_fingerprint: fingerprint(userId, password),
    ...(options?.allowExisting ? { created_at: new Date().toISOString() } : {}),
  };
  const query = options?.allowExisting
    ? admin.from("password_history").upsert(payload, { onConflict: "user_id,password_fingerprint" }).select("id").single()
    : admin.from("password_history").insert(payload).select("id").single();
  const { data, error } = await query;
  if (error || !data?.id) throw new SecurityError("PASSWORD_HISTORY_ERROR", 500, "비밀번호 이력을 저장하지 못했습니다.");
  return String(data.id);
}

export async function removePasswordRecord(admin: AdminClient, recordId: string) {
  const { error } = await admin.from("password_history").delete().eq("id", recordId);
  if (error) console.error("[password-history-rollback]", error);
}

export async function prunePasswordHistory(admin: AdminClient, userId: string) {
  const { data: history, error: historyError } = await admin
    .from("password_history")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (historyError) throw new SecurityError("PASSWORD_HISTORY_ERROR", 500, "비밀번호 이력을 정리하지 못했습니다.");
  const obsolete = (history ?? []).slice(5).map((item) => item.id as string);
  if (obsolete.length > 0) {
    const { error: deleteError } = await admin.from("password_history").delete().in("id", obsolete);
    if (deleteError) throw new SecurityError("PASSWORD_HISTORY_ERROR", 500, "비밀번호 이력을 정리하지 못했습니다.");
  }
}

export async function recordPassword(
  admin: AdminClient,
  userId: string,
  password: string,
  options?: { allowExisting?: boolean },
) {
  await insertPasswordRecord(admin, userId, password, options);
  await prunePasswordHistory(admin, userId);
}

export function passwordExpired(passwordChangedAt: string | null | undefined) {
  if (!passwordChangedAt) return true;
  const changed = new Date(passwordChangedAt);
  if (Number.isNaN(changed.getTime())) return true;
  const expires = new Date(changed);
  expires.setUTCMonth(expires.getUTCMonth() + 6);
  return expires.getTime() <= Date.now();
}

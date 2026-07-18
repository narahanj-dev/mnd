import { createHmac } from "node:crypto";
import type { createAdminClient } from "@/lib/supabase/admin";

function pepper() {
  const value = process.env.PASSWORD_HISTORY_PEPPER?.trim();
  if (!value) throw new Error("PASSWORD_HISTORY_PEPPER 환경변수가 설정되지 않았습니다.");
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
  if (error) throw new Error(error.message);
  if ((data ?? []).length > 0) {
    throw new Error("최근 사용한 비밀번호는 다시 사용할 수 없습니다.");
  }
}

export async function recordPassword(admin: AdminClient, userId: string, password: string) {
  const passwordFingerprint = fingerprint(userId, password);
  const { error } = await admin.from("password_history").insert({
    user_id: userId,
    password_fingerprint: passwordFingerprint,
  });
  if (error) throw new Error(error.message);

  const { data: history, error: historyError } = await admin
    .from("password_history")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (historyError) throw new Error(historyError.message);
  const obsolete = (history ?? []).slice(5).map((item) => item.id as string);
  if (obsolete.length > 0) {
    const { error: deleteError } = await admin.from("password_history").delete().in("id", obsolete);
    if (deleteError) throw new Error(deleteError.message);
  }
}

export function passwordExpired(passwordChangedAt: string | null | undefined) {
  if (!passwordChangedAt) return true;
  const changed = new Date(passwordChangedAt);
  if (Number.isNaN(changed.getTime())) return true;
  const expires = new Date(changed);
  expires.setUTCMonth(expires.getUTCMonth() + 6);
  return expires.getTime() <= Date.now();
}

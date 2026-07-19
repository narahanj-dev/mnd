import { createClient } from "@supabase/supabase-js";
import { SecurityError } from "@/lib/security/errors";

export async function verifyCurrentPassword(options: {
  userId: string;
  email?: string | null;
  password: string;
}) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey || !options.email) {
    throw new SecurityError("REAUTH_CONFIG", 503, "중요 작업 재인증 설정을 확인하세요.");
  }

  const verifier = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { data, error } = await verifier.auth.signInWithPassword({
    email: options.email,
    password: options.password,
  });
  try { await verifier.auth.signOut(); } catch {}

  if (error || data.user?.id !== options.userId) {
    throw new SecurityError("REAUTH_FAILED", 403, "현재 비밀번호가 일치하지 않습니다.");
  }
}

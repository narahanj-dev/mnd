import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEPARTMENTS } from "@/lib/constants";
import { birthMonthDay, encryptProfileValues, encryptSignupRequestValues, loginIdHash, loginIdToAuthEmail, sanitizedAuthUserMetadata } from "@/lib/security/pii";
import { validatePassword } from "@/lib/security/password-policy";
import { verifySignupInviteCode } from "@/lib/security/signup-invite-code";
import { assertSameOrigin, clientIp } from "@/lib/security/request";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { SecurityError, safeErrorResponse } from "@/lib/security/errors";
import { recordPassword } from "@/lib/security/password-history";
import { writeAuditLog } from "@/lib/security/audit";

const schema = z.object({
  name: z.string().trim().min(1).max(50),
  department: z.enum(DEPARTMENTS),
  birthMonth: z.coerce.number().int().min(1).max(12),
  birthDay: z.coerce.number().int().min(1).max(31),
  requestedLoginId: z.string().trim().regex(/^[A-Za-z0-9_-]{4,30}$/),
  inviteCode: z.string().min(1).max(100),
  password: z.string().min(1).max(100),
  confirmPassword: z.string().min(1).max(100),
  reason: z.string().trim().max(500).optional(),
});

export async function POST(request: Request) {
  let createdUserId: string | null = null;
  try {
    assertSameOrigin(request);
    const ip = clientIp(request);
    await enforceRateLimit({ purpose: "signup-ip", identity: ip, limit: 3, windowSeconds: 3600 });

    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new SecurityError("INVALID_INPUT", 400, "입력 내용을 확인하세요. 아이디는 영문·숫자·밑줄·하이픈 4~30자입니다.");
    await enforceRateLimit({ purpose: "signup-login-id", identity: parsed.data.requestedLoginId.toLowerCase(), limit: 3, windowSeconds: 86400 });

    if (parsed.data.password !== parsed.data.confirmPassword) {
      throw new SecurityError("PASSWORD_MISMATCH", 400, "비밀번호 확인이 일치하지 않습니다.");
    }
    if (!verifySignupInviteCode(parsed.data.inviteCode)) {
      throw new SecurityError("INVALID_INVITE", 403, "회원가입 코드가 올바르지 않습니다.");
    }

    const policyError = validatePassword(parsed.data.password, {
      loginId: parsed.data.requestedLoginId,
      displayName: parsed.data.name,
    });
    if (policyError) throw new SecurityError("WEAK_PASSWORD", 400, policyError);

    const monthDay = birthMonthDay(`${String(parsed.data.birthMonth).padStart(2, "0")}-${String(parsed.data.birthDay).padStart(2, "0")}`);
    const admin = createAdminClient();
    const hash = loginIdHash(parsed.data.requestedLoginId);
    const [{ data: existingProfile }, { data: existingRequest }] = await Promise.all([
      admin.from("profiles").select("id").eq("login_id_hash", hash).maybeSingle(),
      admin.from("signup_requests").select("id").eq("requested_login_id_hash", hash).eq("status", "pending").maybeSingle(),
    ]);
    if (existingProfile || existingRequest) {
      throw new SecurityError("DUPLICATE_LOGIN", 409, "이미 사용 중이거나 신청된 아이디입니다.");
    }

    const now = new Date().toISOString();
    const createResult = await admin.auth.admin.createUser({
      email: loginIdToAuthEmail(parsed.data.requestedLoginId),
      password: parsed.data.password,
      email_confirm: true,
      user_metadata: sanitizedAuthUserMetadata(false),
      app_metadata: { role: "user", signup_pending: true, session_version: 1 },
    });
    if (createResult.error || !createResult.data.user) {
      if (/already|exists|registered|duplicate/i.test(createResult.error?.message ?? "")) {
        throw new SecurityError("DUPLICATE_LOGIN", 409, "이미 사용 중이거나 신청된 아이디입니다.");
      }
      throw createResult.error ?? new Error("Auth user creation failed");
    }
    createdUserId = createResult.data.user.id;

    const { error: profileError } = await admin.from("profiles").insert({
      id: createdUserId,
      ...encryptProfileValues({
        login_id: parsed.data.requestedLoginId,
        display_name: parsed.data.name,
        birth_month_day: monthDay,
      }),
      department: parsed.data.department,
      role: "user",
      account_status: "pending",
      must_change_password: false,
      password_changed_at: now,
      session_version: 1,
    });
    if (profileError) throw profileError;

    const { error: requestError } = await admin.from("signup_requests").insert({
      ...encryptSignupRequestValues({
        name: parsed.data.name,
        requested_login_id: parsed.data.requestedLoginId,
        birth_month_day: monthDay,
        reason: parsed.data.reason || null,
      }),
      auth_user_id: createdUserId,
      department: parsed.data.department,
      status: "pending",
    });
    if (requestError) throw requestError;

    await recordPassword(admin, createdUserId, parsed.data.password, { allowExisting: true });
    await writeAuditLog({ request, action: "signup.request", targetUserId: createdUserId, success: true, metadata: { department: parsed.data.department } });
    return Response.json({ ok: true });
  } catch (error) {
    if (createdUserId) {
      try { await createAdminClient().auth.admin.deleteUser(createdUserId); } catch (cleanupError) { console.error("[signup-cleanup]", cleanupError); }
    }
    await writeAuditLog({ request, action: "signup.request", targetUserId: createdUserId, success: false });
    return safeErrorResponse(error, "signup-request");
  }
}

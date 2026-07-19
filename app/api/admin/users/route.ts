import { z } from "zod";
import { requireAdmin, requireUser, authErrorResponse } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEPARTMENTS } from "@/lib/constants";
import { decryptProfile, decryptProfiles, encryptProfileValues, loginIdHash, loginIdToAuthEmail, sanitizedAuthUserMetadata } from "@/lib/security/pii";
import { validatePassword } from "@/lib/security/password-policy";
import { recordPassword } from "@/lib/security/password-history";
import type { Profile } from "@/types";
import { requireAal2 } from "@/lib/security/mfa";
import { assertSameOrigin, clientIp } from "@/lib/security/request";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { SecurityError } from "@/lib/security/errors";
import { encryptMessageFields } from "@/lib/security/secure-fields";
import { writeAuditLog } from "@/lib/security/audit";
import { verifyCurrentPassword } from "@/lib/security/reauth";

function safeManagedProfile(profile: Profile) {
  return {
    id: profile.id, login_id: profile.login_id, display_name: profile.display_name, department: profile.department,
    role: profile.role, account_status: profile.account_status, must_change_password: profile.must_change_password,
    created_at: profile.created_at, updated_at: profile.updated_at, last_login_at: profile.last_login_at,
  };
}

export async function GET(request: Request) {
  try {
    const { user, profile, supabase } = await requireUser();
    if (profile.role !== "user") await requireAal2(supabase);
    const admin = createAdminClient();

    if (profile.role === "user") {
      const { data: rawOwnProfile, error } = await admin.from("profiles").select("*").eq("id", user.id).single();
      const ownProfile = decryptProfile(rawOwnProfile) as Profile | null;
      if (error || !ownProfile) throw new SecurityError("NOT_FOUND", 404, "사용자 정보를 찾을 수 없습니다.");
      return Response.json({
        users: [safeManagedProfile(ownProfile)], departments: [], selectedDepartment: profile.department,
        currentUserId: user.id, currentUserRole: profile.role, currentUserDepartment: profile.department,
      });
    }

    const requestedDepartment = new URL(request.url).searchParams.get("department")?.trim() || null;
    const allowedDepartments = profile.role === "admin" ? [...DEPARTMENTS] : [profile.department];
    if (requestedDepartment && !allowedDepartments.includes(requestedDepartment)) {
      throw new SecurityError("FORBIDDEN", 403, "이 부서의 사용자를 관리할 권한이 없습니다.");
    }

    const { data: departmentRows, error: departmentError } = await admin.from("profiles").select("department").eq("account_status", "active").in("department", allowedDepartments);
    if (departmentError) throw departmentError;
    const departments = allowedDepartments.map((name) => ({
      name,
      userCount: (departmentRows ?? []).filter((item) => item.department === name).length,
    }));

    let users: Profile[] = [];
    if (requestedDepartment) {
      let query = admin.from("profiles").select("*").eq("department", requestedDepartment).eq("account_status", "active");
      if (profile.role === "department_admin") query = query.neq("role", "admin");
      const { data, error } = await query;
      if (error) throw error;
      users = decryptProfiles(data as Record<string, unknown>[]).map((item) => item as unknown as Profile)
        .sort((a, b) => a.display_name.localeCompare(b.display_name, "ko"));
    }

    return Response.json({
      users: users.map(safeManagedProfile), departments, selectedDepartment: requestedDepartment,
      currentUserId: user.id, currentUserRole: profile.role, currentUserDepartment: profile.department,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

const schema = z.object({
  loginId: z.string().regex(/^[A-Za-z0-9_-]{4,30}$/),
  password: z.string().min(1).max(100),
  currentPassword: z.string().min(1).max(100),
  displayName: z.string().trim().min(1).max(50),
  department: z.enum(DEPARTMENTS),
  role: z.enum(["user", "department_admin", "admin"]).default("user"),
});

export async function POST(request: Request) {
  let actorId: string | null = null;
  let targetId: string | null = null;
  try {
    assertSameOrigin(request);
    const { user } = await requireAdmin();
    actorId = user.id;
    await enforceRateLimit({ purpose: "user-create", identity: `${user.id}:${clientIp(request)}`, limit: 10, windowSeconds: 600 });
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new SecurityError("INVALID_INPUT", 400, "계정 입력값을 확인하세요.");
    await enforceRateLimit({ purpose: "privileged-reauth", identity: `${user.id}:${clientIp(request)}`, limit: 5, windowSeconds: 1800 });
    await verifyCurrentPassword({ userId: user.id, email: user.email, password: parsed.data.currentPassword });

    const policyError = validatePassword(parsed.data.password, { loginId: parsed.data.loginId, displayName: parsed.data.displayName });
    if (policyError) throw new SecurityError("WEAK_PASSWORD", 400, policyError);

    const admin = createAdminClient();
    const { data: duplicate } = await admin.from("profiles").select("id").eq("login_id_hash", loginIdHash(parsed.data.loginId)).maybeSingle();
    if (duplicate) throw new SecurityError("DUPLICATE_LOGIN", 409, "이미 사용 중인 아이디입니다.");

    const { data, error } = await admin.auth.admin.createUser({
      email: loginIdToAuthEmail(parsed.data.loginId),
      password: parsed.data.password,
      email_confirm: true,
      app_metadata: { role: parsed.data.role, session_version: 1 },
      user_metadata: sanitizedAuthUserMetadata(true),
    });
    if (error || !data.user) throw error ?? new Error("user creation failed");
    targetId = data.user.id;

    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { error: profileError } = await admin.from("profiles").upsert({
      id: data.user.id,
      ...encryptProfileValues({ login_id: parsed.data.loginId, display_name: parsed.data.displayName }),
      department: parsed.data.department,
      role: parsed.data.role,
      account_status: "active",
      must_change_password: true,
      temporary_password_expires_at: expiresAt,
      session_version: 1,
      password_changed_at: now,
    });
    if (profileError) {
      await admin.auth.admin.deleteUser(data.user.id);
      throw profileError;
    }

    try { await recordPassword(admin, data.user.id, parsed.data.password); }
    catch (historyError) { await admin.auth.admin.deleteUser(data.user.id); throw historyError; }

    await admin.from("messages").insert(encryptMessageFields({
      recipient_id: data.user.id,
      title: "계정 생성 완료",
      content: "계정이 생성되었습니다. 초기 비밀번호는 24시간 안에 로그인하여 변경해야 합니다.",
      message_type: "account_created",
    }));
    await writeAuditLog({ request, action: "user.create", actorId: user.id, targetUserId: data.user.id, success: true, metadata: { role: parsed.data.role, department: parsed.data.department } });
    return Response.json({ ok: true });
  } catch (error) {
    await writeAuditLog({ request, action: "user.create", actorId, targetUserId: targetId, success: false });
    return authErrorResponse(error);
  }
}

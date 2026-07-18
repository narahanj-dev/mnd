import { z } from "zod";
import {
  requireAdmin,
  requireUser,
  authErrorResponse,
} from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEPARTMENTS, loginIdToEmail } from "@/lib/constants";
import type { Profile } from "@/types";

export async function GET(request: Request) {
  try {
    const { user, profile } = await requireUser();
    const admin = createAdminClient();

    if (profile.role === "user") {
      const { data: ownProfile, error } = await admin
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single<Profile>();

      if (error || !ownProfile) {
        return Response.json(
          { error: error?.message ?? "사용자 정보를 찾을 수 없습니다." },
          { status: 404 },
        );
      }

      return Response.json({
        users: [ownProfile],
        departments: [],
        selectedDepartment: profile.department,
        currentUserId: user.id,
        currentUserRole: profile.role,
        currentUserDepartment: profile.department,
      });
    }

    const requestedDepartment =
      new URL(request.url).searchParams.get("department")?.trim() || null;
    const allowedDepartments =
      profile.role === "admin" ? [...DEPARTMENTS] : [profile.department];

    if (
      requestedDepartment &&
      !allowedDepartments.includes(requestedDepartment)
    ) {
      return Response.json(
        { error: "이 부서의 사용자를 관리할 권한이 없습니다." },
        { status: 403 },
      );
    }

    const { data: departmentRows, error: departmentError } = await admin
      .from("profiles")
      .select("department")
      .eq("account_status", "active")
      .in("department", allowedDepartments);

    if (departmentError)
      return Response.json({ error: departmentError.message }, { status: 400 });

    const departments = allowedDepartments.map((name) => ({
      name,
      userCount: (departmentRows ?? []).filter(
        (item) => item.department === name,
      ).length,
    }));

    let users: Profile[] = [];
    if (requestedDepartment) {
      const { data, error } = await admin
        .from("profiles")
        .select("*")
        .eq("department", requestedDepartment)
        .order("display_name", { ascending: true });
      if (error)
        return Response.json({ error: error.message }, { status: 400 });
      users = (data ?? []) as Profile[];
    }

    return Response.json({
      users,
      departments,
      selectedDepartment: requestedDepartment,
      currentUserId: user.id,
      currentUserRole: profile.role,
      currentUserDepartment: profile.department,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

const schema = z.object({
  loginId: z.string().regex(/^[A-Za-z0-9_-]{4,30}$/),
  password: z.string().min(4).max(100),
  displayName: z.string().min(1).max(50),
  department: z.enum(DEPARTMENTS),
  role: z.enum(["user", "department_admin", "admin"]).default("user"),
});

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(
        { error: "계정 입력값을 확인하세요." },
        { status: 400 },
      );
    }

    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.createUser({
      email: loginIdToEmail(parsed.data.loginId),
      password: parsed.data.password,
      email_confirm: true,
      app_metadata: { role: parsed.data.role },
      user_metadata: {
        login_id: parsed.data.loginId,
        display_name: parsed.data.displayName,
        department: parsed.data.department,
        must_change_password: true,
      },
    });

    if (error || !data.user) {
      return Response.json(
        { error: error?.message ?? "사용자 생성 실패" },
        { status: 400 },
      );
    }

    const { error: profileError } = await admin.from("profiles").upsert({
      id: data.user.id,
      login_id: parsed.data.loginId,
      display_name: parsed.data.displayName,
      department: parsed.data.department,
      role: parsed.data.role,
      account_status: "active",
      must_change_password: true,
    });

    if (profileError) {
      await admin.auth.admin.deleteUser(data.user.id);
      return Response.json({ error: profileError.message }, { status: 400 });
    }

    await admin.from("messages").insert({
      recipient_id: data.user.id,
      title: "계정 생성 완료",
      content: `아이디 ${parsed.data.loginId} 계정이 생성되었습니다. 첫 로그인 후 비밀번호를 변경하세요.`,
      message_type: "account_created",
    });

    return Response.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}

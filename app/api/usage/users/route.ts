import { authErrorResponse, requireUser } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UsageUserSummary } from "@/types";

export async function GET() {
  try {
    const { user, profile } = await requireUser();
    const admin = createAdminClient();

    let query = admin
      .from("profiles")
      .select("id,login_id,display_name,department,role")
      .eq("account_status", "active")
      .order("department", { ascending: true })
      .order("display_name", { ascending: true });

    if (profile.role === "user") {
      query = query.eq("id", user.id);
    } else if (profile.role === "department_admin") {
      query = query.eq("department", profile.department);
    }

    const { data, error } = await query.returns<UsageUserSummary[]>();
    if (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    return Response.json({
      users: data ?? [],
      viewerRole: profile.role,
      viewerDepartment: profile.department,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

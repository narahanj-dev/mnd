import { Header } from "@/components/common/Header";
import { PasswordChangeGate } from "@/components/auth/PasswordChangeGate";
import { canManageUser, requireUser } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Profile } from "@/types";
import { passwordExpired } from "@/lib/security/password-history";
import { redirect } from "next/navigation";
import { SecurityError } from "@/lib/security/errors";

type ApprovalTargetRelation = Pick<Profile, "department" | "role"> | Pick<Profile, "department" | "role">[] | null;

function relatedProfile(relation: ApprovalTargetRelation) {
  if (Array.isArray(relation)) return relation[0] ?? null;
  return relation;
}

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  let authResult: Awaited<ReturnType<typeof requireUser>>;
  try {
    authResult = await requireUser({ allowPasswordChangeRequired: true });
  } catch (error) {
    if (error instanceof SecurityError && error.code === "SESSION_EXPIRED") redirect("/login?reason=session-timeout");
    redirect("/login");
  }
  const { user, profile, supabase } = authResult;

  if (profile.role === "admin" || profile.role === "department_admin") {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (process.env.REQUIRE_ADMIN_MFA !== "false" && aal?.currentLevel !== "aal2") redirect("/mfa");
  }

  const admin = createAdminClient();
  const { count: unreadCount } = await admin
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("recipient_id", user.id)
    .eq("is_read", false);

  let pendingCount = 0;
  if (profile.role === "admin" || profile.role === "department_admin") {
    const [{ data: pendingEvents }, { data: pendingChanges }] = await Promise.all([
      admin.from("calendar_events").select("profile:profiles!calendar_events_user_id_fkey(department,role)").eq("status", "pending"),
      admin.from("event_change_requests").select("event:calendar_events!event_change_requests_event_id_fkey(profile:profiles!calendar_events_user_id_fkey(department,role))").eq("status", "pending"),
    ]);

    const visibleEventCount = (pendingEvents ?? []).filter((event) => {
      const targetProfile = relatedProfile(event.profile as ApprovalTargetRelation);
      return Boolean(targetProfile && canManageUser(profile, targetProfile));
    }).length;
    const visibleChangeCount = (pendingChanges ?? []).filter((changeRequest) => {
      const eventRelation = Array.isArray(changeRequest.event) ? changeRequest.event[0] : changeRequest.event;
      const targetProfile = relatedProfile(eventRelation?.profile as ApprovalTargetRelation);
      return Boolean(targetProfile && canManageUser(profile, targetProfile));
    }).length;
    pendingCount = visibleEventCount + visibleChangeCount;
  }

  return (
    <PasswordChangeGate required={profile.must_change_password || passwordExpired(profile.password_changed_at)}>
      <div className="min-h-screen">
        <Header profile={profile} unreadCount={unreadCount ?? 0} pendingCount={pendingCount} />
        <main className="mx-auto max-w-[1500px] px-4 py-6">{children}</main>
      </div>
    </PasswordChangeGate>
  );
}

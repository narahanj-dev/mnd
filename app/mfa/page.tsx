import { redirect } from "next/navigation";
import { MfaGate } from "@/components/auth/MfaGate";
import { requireUser } from "@/lib/auth/guards";

export default async function MfaPage() {
  try {
    const { profile, supabase } = await requireUser({ allowPasswordChangeRequired: true });
    if (profile.role === "user") redirect("/calendar");
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel === "aal2") redirect("/calendar");
  } catch {
    redirect("/login");
  }
  return <main className="min-h-screen px-4 py-10"><MfaGate /></main>;
}

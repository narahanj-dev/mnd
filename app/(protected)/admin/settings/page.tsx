import { AdminSettingsForm } from "@/components/admin/AdminSettingsForm";
import { requireAdmin } from "@/lib/auth/guards";

export default async function SettingsPage() {
  const { profile } = await requireAdmin();
  return <AdminSettingsForm profile={profile} />;
}

import { UserManagement } from "@/components/admin/UserManagement";
import { requireUser } from "@/lib/auth/guards";

export default async function UsersPage() {
  await requireUser({ allowPasswordChangeRequired: true });
  return <UserManagement />;
}

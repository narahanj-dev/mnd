import { requireUserManager } from "@/lib/auth/guards";
import { redirect } from "next/navigation";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  try {
    await requireUserManager();
  } catch {
    redirect("/calendar");
  }
  return children;
}

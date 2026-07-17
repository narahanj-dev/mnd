import { LoginForm } from "@/components/auth/LoginForm";
import { createClient } from "@/lib/supabase/server";
import { CalendarCheck2 } from "lucide-react";
import { redirect } from "next/navigation";

export default async function LoginPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/calendar");

  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,#dbeafe,transparent_45%)] p-4">
      <section className="card w-full max-w-md p-7 sm:p-9">
        <div className="mb-7 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-700 text-white"><CalendarCheck2 size={30} /></div>
          <h1 className="text-2xl font-black tracking-tight">부서 공동 연차달력</h1>
          <p className="mt-2 text-sm text-slate-500">휴가·외출·일정·기념일 통합 관리</p>
        </div>
        <LoginForm />
      </section>
    </main>
  );
}

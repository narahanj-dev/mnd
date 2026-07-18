import { LoginForm } from "@/components/auth/LoginForm";
import { createClient } from "@/lib/supabase/server";
import { CalendarCheck2, Megaphone } from "lucide-react";
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
          <p className="mt-2 text-sm text-slate-500">연가·외출·일정·기념일 통합 관리</p>
        </div>

        <aside className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left" aria-label="로그인 공지사항">
          <div className="flex items-center gap-2 text-amber-900">
            <Megaphone size={18} aria-hidden="true" />
            <h2 className="text-sm font-black">공지사항</h2>
          </div>
          <ul className="mt-2.5 space-y-1.5 pl-5 text-sm font-semibold leading-6 text-amber-950 marker:text-amber-600">
            <li className="list-disc">회원가입 시 아이디에 군번을 사용하지 마세요.</li>
            <li className="list-disc">기존 가입자는 본인 이름을 영문 자판(영타)으로 입력해 로그인한 뒤, 사용자 관리에서 아이디를 변경할 수 있습니다.</li>
          </ul>
        </aside>

        <LoginForm />
      </section>
    </main>
  );
}

import { LoginForm } from "@/components/auth/LoginForm";
import { createClient } from "@/lib/supabase/server";
import { CalendarCheck2, Megaphone, TimerOff } from "lucide-react";
import { redirect } from "next/navigation";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/calendar");

  const { reason } = await searchParams;
  const sessionTimedOut = reason === "session-timeout";

  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,#dbeafe,transparent_45%)] p-4">
      <section className="card w-full max-w-md p-7 sm:p-9">
        <div className="mb-7 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-700 text-white"><CalendarCheck2 size={30} /></div>
          <h1 className="text-2xl font-black tracking-tight">부서 공동 연차달력</h1>
          <p className="mt-2 text-sm text-slate-500">휴가·외출·일정·기념일 통합 관리</p>
        </div>

        {sessionTimedOut && (
          <div className="mb-5 flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold leading-6 text-rose-800">
            <TimerOff size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
            보안을 위해 300초 타이머가 만료되어 자동 로그아웃되었습니다. 다시 로그인하세요.
          </div>
        )}

        <aside className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left" aria-label="로그인 공지사항">
          <div className="flex items-center gap-2 text-amber-900">
            <Megaphone size={18} aria-hidden="true" />
            <h2 className="text-sm font-black">공지사항</h2>
          </div>
          <ul className="mt-2.5 space-y-1.5 pl-5 text-sm font-semibold leading-6 text-amber-950 marker:text-amber-600">
            <li className="list-disc">회원가입 시 희망 아이디로 군번 및 숫자로만 이루어진 아이디는 사용할 수 없습니다.</li>
            <li className="list-disc">관리자가 비밀번호를 초기화하면 임시 비밀번호는 mnd890701!로 변경되며, 로그인 후 반드시 새 비밀번호로 변경해야 합니다.</li>
          </ul>
        </aside>

        <LoginForm />
      </section>
    </main>
  );
}

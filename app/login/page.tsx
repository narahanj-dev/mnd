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
  const signupDisabled = reason === "signup-disabled";

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

        {signupDisabled && (
          <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold leading-6 text-amber-900">
            회원가입 신청 기능은 종료되었습니다. 신규 계정은 관리자에게 요청하세요.
          </div>
        )}

        <aside className="notice-panel mb-6 rounded-2xl p-4 text-left" aria-label="로그인 공지사항">
          <div className="notice-panel-title flex items-center gap-2">
            <Megaphone size={18} aria-hidden="true" />
            <h2 className="text-sm font-black">공지사항</h2>
          </div>
          <div className="mt-3 space-y-2">
            <div className="critical-notice rounded-xl px-4 py-3 text-left text-sm font-black leading-6" role="note">
              중요: 신규 사용자 계정은 관리자가 직접 생성하여 전달합니다.
            </div>
            <div className="critical-notice rounded-xl px-4 py-3 text-left text-sm font-black leading-6" role="note">
              중요: 아이디 또는 임시 비밀번호가 필요한 경우 관리자에게 문의하시기 바랍니다.
            </div>
          </div>
        </aside>

        <LoginForm />
      </section>
    </main>
  );
}

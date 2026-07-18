"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { DEPARTMENTS } from "@/lib/constants";
import { parseJsonResponse } from "@/lib/utils";

export function SignupRequestForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
      await parseJsonResponse(await fetch("/api/signup-request", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(form.entries())),
      }));
      alert("회원가입 신청이 접수되었습니다. 관리자 승인을 기다려주세요.");
      router.push("/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "신청에 실패했습니다.");
    } finally { setLoading(false); }
  }

  return (
    <form onSubmit={submit} className="card mx-auto max-w-xl space-y-4 p-6 sm:p-8">
      <h1 className="text-2xl font-black">회원가입 신청</h1>
      <p className="text-sm text-slate-500">신청 후 관리자가 실제 계정과 임시 비밀번호를 발급합니다.</p>
      <label className="block text-sm font-bold">이름<input name="name" className="input mt-1" required maxLength={50} /></label>
      <label className="block text-sm font-bold">생년월일<input name="birthDate" type="date" className="input mt-1" required max={new Date().toISOString().slice(0, 10)} /></label>
      <label className="block text-sm font-bold">소속 부서<select name="department" className="input mt-1" required defaultValue=""><option value="" disabled>부서를 선택하세요</option>{DEPARTMENTS.map((department) => <option key={department} value={department}>{department}</option>)}</select></label>
      <label className="block text-sm font-bold">희망 아이디<input name="requestedLoginId" className="input mt-1" required minLength={4} maxLength={30} /></label>
      <label className="block text-sm font-bold">신청 사유<textarea name="reason" className="input mt-1 min-h-28" maxLength={500} /></label>
      {error && <p className="text-sm font-semibold text-rose-700">{error}</p>}
      <div className="flex justify-end gap-2"><button type="button" onClick={() => router.back()} className="btn-secondary">취소</button><button className="btn-primary" disabled={loading}>{loading ? "접수 중..." : "신청하기"}</button></div>
    </form>
  );
}

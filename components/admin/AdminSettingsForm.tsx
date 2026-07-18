"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { parseJsonResponse } from "@/lib/utils";
import type { Profile } from "@/types";

export function AdminSettingsForm({ profile }: { profile: Profile }) {
  const router = useRouter(); const [loading, setLoading] = useState(false); const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setMessage(""); const form = new FormData(event.currentTarget); const payload: Record<string,string> = {};
    const loginId = String(form.get("loginId") || "").trim(); const displayName = String(form.get("displayName") || "").trim(); const password = String(form.get("password") || "");
    if (loginId && loginId !== profile.login_id) payload.loginId = loginId; if (displayName && displayName !== profile.display_name) payload.displayName = displayName; if (password) payload.password = password;
    try { await parseJsonResponse(await fetch("/api/admin/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })); setMessage("관리자 설정을 변경했습니다."); router.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "변경에 실패했습니다."); }
    finally { setLoading(false); }
  }
  return <form onSubmit={submit} className="card max-w-2xl space-y-5 p-6"><h1 className="text-2xl font-black">관리자 설정</h1><p className="text-sm text-slate-500">초기 관리자 12345 / 12345는 개발용입니다. 운영 전 반드시 변경하세요.</p><label className="block text-sm font-bold">관리자 표시 이름<input name="displayName" defaultValue={profile.display_name} className="input mt-1" required /></label><label className="block text-sm font-bold">관리자 로그인 군번<input name="loginId" defaultValue={profile.login_id} className="input mt-1" required /></label><label className="block text-sm font-bold">새 비밀번호<input name="password" type="password" className="input mt-1" minLength={6} placeholder="변경할 때만 입력" /></label>{message && <p className="rounded-lg bg-slate-50 p-3 text-sm font-semibold">{message}</p>}<button className="btn-primary" disabled={loading}>{loading ? "저장 중..." : "설정 저장"}</button></form>;
}

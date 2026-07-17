"use client";

import { useCallback, useEffect, useState } from "react";
import { parseJsonResponse } from "@/lib/utils";

type RequestItem = { id: string; name: string; department: string; contact: string; requested_login_id: string; reason: string | null; status: "pending" | "approved" | "rejected"; rejection_reason: string | null; created_at: string };
export function SignupRequestList() {
  const [items, setItems] = useState<RequestItem[]>([]);
  const load = useCallback(async () => { const data = await parseJsonResponse<{ requests: RequestItem[] }>(await fetch("/api/admin/signup-requests", { cache: "no-store" })); setItems(data.requests); }, []);
  useEffect(() => { load(); }, [load]);
  async function decide(item: RequestItem, decision: "approve" | "reject") {
    let body: Record<string, string> = { decision };
    if (decision === "approve") { const loginId = prompt("발급할 아이디", item.requested_login_id)?.trim(); if (!loginId) return; const password = prompt("임시 비밀번호(4자 이상)")?.trim(); if (!password) return; body = { ...body, loginId, password }; }
    else { const reason = prompt("거절 사유")?.trim(); if (!reason) return; body.reason = reason; }
    await parseJsonResponse(await fetch(`/api/admin/signup-requests/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })); await load();
  }
  return <div><h1 className="mb-5 text-2xl font-black">회원가입 신청</h1><div className="space-y-4">{items.length === 0 ? <div className="card p-8 text-center text-slate-500">신청 내역이 없습니다.</div> : items.map((item) => <article key={item.id} className="card p-5"><div className="flex flex-wrap justify-between gap-4"><div><div className="font-black">{item.name} · {item.department}</div><p className="mt-1 text-sm text-slate-600">희망 아이디 {item.requested_login_id} · 연락처 {item.contact}</p>{item.reason && <p className="mt-2 text-sm">신청 사유: {item.reason}</p>}<p className="mt-2 text-xs text-slate-400">{new Date(item.created_at).toLocaleString("ko-KR")}</p>{item.rejection_reason && <p className="mt-2 text-sm text-rose-700">거절 사유: {item.rejection_reason}</p>}</div><div>{item.status === "pending" ? <div className="flex gap-2"><button className="btn-primary" onClick={() => decide(item, "approve")}>승인</button><button className="btn-danger" onClick={() => decide(item, "reject")}>거절</button></div> : <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-bold">{item.status === "approved" ? "승인 완료" : "거절"}</span>}</div></div></article>)}</div></div>;
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { EVENT_TYPE_LABELS } from "@/lib/constants";
import { parseJsonResponse } from "@/lib/utils";
import type { CalendarEvent } from "@/types";

export function ApprovalList() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const load = useCallback(async () => { const data = await parseJsonResponse<{ events: CalendarEvent[] }>(await fetch("/api/events", { cache: "no-store" })); setEvents(data.events.filter((event) => event.status === "pending")); }, []);
  useEffect(() => { load(); }, [load]);
  async function decide(id: string, decision: "approve" | "reject") {
    let reason = ""; if (decision === "reject") { reason = prompt("거절 사유를 입력하세요.")?.trim() ?? ""; if (!reason) return; }
    if (!confirm(decision === "approve" ? "이 일정을 승인하시겠습니까?" : "이 일정을 거절하시겠습니까?")) return;
    await parseJsonResponse(await fetch(`/api/admin/approvals/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, reason }) })); await load();
  }
  return <div><h1 className="mb-5 text-2xl font-black">일정 승인</h1>{events.length === 0 ? <div className="card p-8 text-center text-slate-500">승인 대기 일정이 없습니다.</div> : <div className="space-y-4">{events.map((event) => <article key={event.id} className="card p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="font-black">[{EVENT_TYPE_LABELS[event.event_type]}] {event.title}</div><p className="mt-2 text-sm text-slate-600">신청자 {event.profile?.display_name} · {event.profile?.department}</p><p className="text-sm text-slate-600">{event.start_date} ~ {event.end_date} · {event.all_day ? "종일" : `${event.start_time?.slice(0,5)}~${event.end_time?.slice(0,5)}`}</p>{event.description && <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">{event.description}</p>}{event.admin_note && <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">관리자 메모: {event.admin_note}</p>}</div><div className="flex gap-2"><button className="btn-primary" onClick={() => decide(event.id, "approve")}>승인</button><button className="btn-danger" onClick={() => decide(event.id, "reject")}>거절</button></div></div></article>)}</div>}</div>;
}

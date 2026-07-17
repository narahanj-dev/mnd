"use client";

import { useCallback, useEffect, useState } from "react";
import { EVENT_TYPE_LABELS } from "@/lib/constants";
import { parseJsonResponse } from "@/lib/utils";
import type { CalendarEvent } from "@/types";
import { StatusBadge } from "@/components/common/StatusBadge";

export function MyEventsList({ userId, isAdmin }: { userId: string; isAdmin: boolean }) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try { const data = await parseJsonResponse<{ events: CalendarEvent[] }>(await fetch("/api/events", { cache: "no-store" })); setEvents(data.events.filter((event) => event.user_id === userId)); }
    finally { setLoading(false); }
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  async function action(id: string, type: "cancel" | "delete") {
    if (!confirm(type === "cancel" ? "이 일정의 취소를 요청하시겠습니까?" : "이 일정을 삭제하시겠습니까?")) return;
    await parseJsonResponse(await fetch(`/api/events/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: type }) }));
    await load();
  }

  if (loading) return <p>일정을 불러오는 중...</p>;
  return <div><h1 className="mb-5 text-2xl font-black">내 일정</h1>{events.length === 0 ? <div className="card p-8 text-center text-slate-500">등록한 일정이 없습니다.</div> : <div className="grid gap-4 lg:grid-cols-2">{events.map((event) => <article key={event.id} className="card p-5"><div className="flex items-center justify-between gap-3"><strong>[{EVENT_TYPE_LABELS[event.event_type]}] {event.title}</strong><StatusBadge status={event.status} /></div><p className="mt-3 text-sm text-slate-600">{event.start_date} ~ {event.end_date} · {event.all_day ? "종일" : `${event.start_time?.slice(0,5)}~${event.end_time?.slice(0,5)}`}</p><p className="mt-1 text-xs text-slate-400">등록일 {new Date(event.created_at).toLocaleString("ko-KR")}</p>{event.rejection_reason && <p className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">거절 사유: {event.rejection_reason}</p>}<div className="mt-4 flex justify-end gap-2">{event.status === "approved" && <button className="btn-secondary text-sm" onClick={() => action(event.id, "cancel")}>취소 요청</button>}{isAdmin && <button className="btn-danger text-sm" onClick={() => action(event.id, "delete")}>삭제</button>}</div></article>)}</div>}</div>;
}

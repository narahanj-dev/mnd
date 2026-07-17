"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EVENT_TYPE_LABELS } from "@/lib/constants";
import { parseJsonResponse } from "@/lib/utils";
import type { CalendarEvent, EventChangeRequest } from "@/types";
import { StatusBadge } from "@/components/common/StatusBadge";
import { EventEditModal } from "./EventEditModal";

export function MyEventsList({ userId, isAdmin }: { userId: string; isAdmin: boolean }) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [requests, setRequests] = useState<EventChangeRequest[]>([]);
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [eventData, requestData] = await Promise.all([
        parseJsonResponse<{ events: CalendarEvent[] }>(await fetch("/api/events", { cache: "no-store" })),
        parseJsonResponse<{ requests: EventChangeRequest[] }>(await fetch("/api/event-change-requests", { cache: "no-store" })),
      ]);
      setEvents(isAdmin ? eventData.events : eventData.events.filter((event) => event.user_id === userId));
      setRequests(requestData.requests);
    } finally {
      setLoading(false);
    }
  }, [isAdmin, userId]);

  useEffect(() => { load(); }, [load]);

  const latestRequestByEvent = useMemo(() => {
    const map = new Map<string, EventChangeRequest>();
    requests.forEach((request) => { if (!map.has(request.event_id)) map.set(request.event_id, request); });
    return map;
  }, [requests]);

  async function remove(event: CalendarEvent) {
    const reason = prompt(isAdmin ? "사용자에게 전달할 삭제 사유를 입력하세요." : "관리자에게 전달할 삭제 사유를 입력하세요.")?.trim();
    if (!reason) return;
    if (!confirm(isAdmin ? "이 일정을 즉시 삭제하시겠습니까?" : "이 일정의 삭제 승인을 요청하시겠습니까?")) return;
    const result = await parseJsonResponse<{ message?: string }>(await fetch(`/api/events/${event.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", reason }),
    }));
    alert(result.message ?? (isAdmin ? "일정이 삭제되었습니다." : "삭제 요청이 접수되었습니다."));
    await load();
  }

  if (loading) return <p>일정을 불러오는 중...</p>;
  return (
    <div>
      <h1 className="mb-5 text-2xl font-black">{isAdmin ? "전체 일정 관리" : "내 일정"}</h1>
      {events.length === 0 ? <div className="card p-8 text-center text-slate-500">등록한 일정이 없습니다.</div> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {events.map((event) => {
            const changeRequest = latestRequestByEvent.get(event.id);
            const pendingChange = changeRequest?.status === "pending";
            const manageable = isAdmin ? !["cancelled", "rejected"].includes(event.status) : event.status === "approved";
            return (
              <article key={event.id} className="card p-5">
                <div className="flex items-center justify-between gap-3"><strong>[{EVENT_TYPE_LABELS[event.event_type]}] {event.title}</strong><StatusBadge status={event.status} /></div>
                {isAdmin && <p className="mt-2 text-sm font-semibold text-slate-700">등록자 {event.profile?.display_name ?? "사용자"} · {event.profile?.department ?? "미지정"}</p>}
                <p className="mt-3 text-sm text-slate-600">{event.start_date} ~ {event.end_date} · {event.all_day ? "종일" : `${event.start_time?.slice(0, 5)}~${event.end_time?.slice(0, 5)}`}</p>
                <p className="mt-1 text-xs text-slate-400">등록일 {new Date(event.created_at).toLocaleString("ko-KR")}</p>
                {event.rejection_reason && <p className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">거절 사유: {event.rejection_reason}</p>}
                {changeRequest && (
                  <div className={`mt-3 rounded-lg p-3 text-sm ${changeRequest.status === "pending" ? "bg-amber-50 text-amber-800" : changeRequest.status === "rejected" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-800"}`}>
                    최근 {changeRequest.request_type === "update" ? "수정" : "삭제"} 요청: {changeRequest.status === "pending" ? "승인 대기" : changeRequest.status === "approved" ? "승인" : "거절"}<br />
                    사유: {changeRequest.reason}
                    {changeRequest.rejection_reason && <><br />거절 사유: {changeRequest.rejection_reason}</>}
                  </div>
                )}
                {manageable && (
                  <div className="mt-4 flex justify-end gap-2">
                    <button className="btn-secondary text-sm" disabled={!isAdmin && pendingChange} onClick={() => setEditing(event)}>{isAdmin ? "수정" : "수정 요청"}</button>
                    <button className="btn-danger text-sm" disabled={!isAdmin && pendingChange} onClick={() => remove(event)}>{isAdmin ? "삭제" : "삭제 요청"}</button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
      {editing && <EventEditModal event={editing} isAdmin={isAdmin} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  );
}

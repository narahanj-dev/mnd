"use client";

import { useCallback, useEffect, useState } from "react";
import { EVENT_TYPE_LABELS } from "@/lib/constants";
import { parseJsonResponse } from "@/lib/utils";
import type { CalendarEvent, EventChangeRequest } from "@/types";

export function ApprovalList() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [changeRequests, setChangeRequests] = useState<EventChangeRequest[]>([]);

  const load = useCallback(async () => {
    const [eventData, requestData] = await Promise.all([
      parseJsonResponse<{ events: CalendarEvent[] }>(await fetch("/api/events", { cache: "no-store" })),
      parseJsonResponse<{ requests: EventChangeRequest[] }>(await fetch("/api/event-change-requests?status=pending", { cache: "no-store" })),
    ]);
    setEvents(eventData.events.filter((event) => event.status === "pending"));
    setChangeRequests(requestData.requests);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function decideEvent(id: string, decision: "approve" | "reject") {
    let reason = "";
    if (decision === "reject") {
      reason = prompt("거절 사유를 입력하세요.")?.trim() ?? "";
      if (!reason) return;
    }
    if (!confirm(decision === "approve" ? "이 일정을 승인하시겠습니까?" : "이 일정을 거절하시겠습니까?")) return;
    await parseJsonResponse(await fetch(`/api/admin/approvals/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, reason }),
    }));
    await load();
  }

  async function decideChange(id: string, decision: "approve" | "reject") {
    let reason = "";
    if (decision === "reject") {
      reason = prompt("거절 사유를 입력하세요. 기존 일정은 그대로 유지됩니다.")?.trim() ?? "";
      if (!reason) return;
    }
    if (!confirm(decision === "approve" ? "이 변경 요청을 승인하시겠습니까?" : "이 변경 요청을 거절하시겠습니까?")) return;
    await parseJsonResponse(await fetch(`/api/admin/event-change-requests/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, reason }),
    }));
    await load();
  }

  const empty = events.length === 0 && changeRequests.length === 0;
  return (
    <div>
      <h1 className="mb-5 text-2xl font-black">일정 승인</h1>
      {empty ? <div className="card p-8 text-center text-slate-500">승인 대기 요청이 없습니다.</div> : (
        <div className="space-y-6">
          {events.length > 0 && (
            <section>
              <h2 className="mb-3 text-lg font-black">신규 일정 요청</h2>
              <div className="space-y-4">
                {events.map((event) => (
                  <article key={event.id} className="card p-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="font-black">[{EVENT_TYPE_LABELS[event.event_type]}] {event.title}</div>
                        <p className="mt-2 text-sm text-slate-600">신청자 {event.profile?.display_name} · {event.profile?.department}</p>
                        <p className="text-sm text-slate-600">{event.start_date} ~ {event.end_date} · {event.all_day ? "종일" : `${event.start_time?.slice(0, 5)}~${event.end_time?.slice(0, 5)}`}</p>
                        {event.description && <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">{event.description}</p>}
                        {event.admin_note && <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">관리자 메모: {event.admin_note}</p>}
                      </div>
                      <div className="flex gap-2"><button className="btn-primary" onClick={() => decideEvent(event.id, "approve")}>승인</button><button className="btn-danger" onClick={() => decideEvent(event.id, "reject")}>거절</button></div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          {changeRequests.length > 0 && (
            <section>
              <h2 className="mb-3 text-lg font-black">일정 수정·삭제 요청</h2>
              <div className="space-y-4">
                {changeRequests.map((request) => {
                  const event = request.event;
                  if (!event) return null;
                  return (
                    <article key={request.id} className="card p-5">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="font-black">[{request.request_type === "update" ? "수정" : "삭제"} 요청] {event.title}</div>
                          <p className="mt-2 text-sm text-slate-600">요청자 {request.requester?.display_name ?? event.profile?.display_name} · {request.requester?.department ?? event.profile?.department}</p>
                          <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
                            <strong>현재 일정</strong><br />
                            [{EVENT_TYPE_LABELS[event.event_type]}] {event.title}<br />
                            {event.start_date} ~ {event.end_date} · {event.all_day ? "종일" : `${event.start_time?.slice(0, 5)}~${event.end_time?.slice(0, 5)}`}
                          </div>
                          {request.request_type === "update" && request.proposed_event_type && (
                            <div className="mt-2 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
                              <strong>변경 요청 내용</strong><br />
                              [{EVENT_TYPE_LABELS[request.proposed_event_type]}] {request.proposed_title}<br />
                              {request.proposed_start_date} ~ {request.proposed_end_date} · {request.proposed_all_day ? "종일" : `${request.proposed_start_time?.slice(0, 5)}~${request.proposed_end_time?.slice(0, 5)}`}
                            </div>
                          )}
                          <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800"><strong>요청 사유:</strong> {request.reason}</p>
                        </div>
                        <div className="flex gap-2"><button className="btn-primary" onClick={() => decideChange(request.id, "approve")}>승인</button><button className="btn-danger" onClick={() => decideChange(request.id, "reject")}>거절</button></div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

import { X } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { parseJsonResponse } from "@/lib/utils";
import type { CalendarEvent } from "@/types";

export function EventFormModal({ date, events, onClose, onSaved }: { date: string; events: CalendarEvent[]; onClose: () => void; onSaved: () => void }) {
  const [showForm, setShowForm] = useState(events.length === 0);
  const [allDay, setAllDay] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError("");
    const form = new FormData(event.currentTarget);
    const payload = {
      eventType: form.get("eventType"), title: form.get("title"), startDate: form.get("startDate"), endDate: form.get("endDate"),
      allDay, startTime: allDay ? null : form.get("startTime"), endTime: allDay ? null : form.get("endTime"),
      description: form.get("description"), publicNote: form.get("publicNote"), adminNote: form.get("adminNote"),
    };
    try {
      const result = await parseJsonResponse<{ message?: string }>(await fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }));
      alert(result.message ?? "일정 추가 요청이 접수되었습니다. 관리자의 승인이 완료될 때까지 기다려 주세요.");
      onSaved(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : "등록에 실패했습니다."); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onMouseDown={(e) => e.currentTarget === e.target && onClose()}>
      <section className="card max-h-[90vh] w-full max-w-2xl overflow-y-auto p-5" role="dialog" aria-modal="true">
        <div className="flex items-start justify-between"><div><h2 className="text-xl font-black">{date} 일정</h2><p className="text-sm text-slate-500">해당 날짜의 일정 확인 및 추가</p></div><button onClick={onClose} className="rounded-lg p-2 hover:bg-slate-100" aria-label="닫기"><X /></button></div>
        {events.length > 0 && (
          <div className="mt-5 space-y-2">
            {events.map((item) => <div key={item.id} className="rounded-xl border border-slate-200 p-3"><div className="font-bold">[{item.event_type === "leave" ? "휴가" : item.event_type === "outing" ? "외출" : item.event_type === "schedule" ? "일정" : "기념일"}] {item.profile?.display_name} · {item.title}</div><div className="mt-1 text-sm text-slate-500">{item.all_day ? "종일" : `${item.start_time?.slice(0,5)}~${item.end_time?.slice(0,5)}`}</div></div>)}
            {!showForm && <button className="btn-primary mt-2" onClick={() => setShowForm(true)}>+ 일정 추가</button>}
          </div>
        )}
        {showForm && (
          <form onSubmit={submit} className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="text-sm font-bold">종류<select name="eventType" className="input mt-1"><option value="leave">휴가</option><option value="outing">외출</option><option value="schedule">일정</option><option value="anniversary">기념일</option></select></label>
            <label className="text-sm font-bold">제목<input name="title" className="input mt-1" required maxLength={100} /></label>
            <label className="text-sm font-bold">시작일<input name="startDate" type="date" defaultValue={date} className="input mt-1" required /></label>
            <label className="text-sm font-bold">종료일<input name="endDate" type="date" defaultValue={date} className="input mt-1" required /></label>
            <label className="flex items-center gap-2 text-sm font-bold md:col-span-2"><input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> 종일 일정</label>
            {!allDay && <><label className="text-sm font-bold">시작 시간<input name="startTime" type="time" className="input mt-1" required /></label><label className="text-sm font-bold">종료 시간<input name="endTime" type="time" className="input mt-1" required /></label></>}
            <label className="text-sm font-bold md:col-span-2">상세 내용<textarea name="description" className="input mt-1 min-h-20" maxLength={2000} /></label>
            <label className="text-sm font-bold md:col-span-2">공개 메모<textarea name="publicNote" className="input mt-1 min-h-16" maxLength={500} /></label>
            <label className="text-sm font-bold md:col-span-2">관리자에게만 전달할 메모<textarea name="adminNote" className="input mt-1 min-h-16" maxLength={500} /></label>
            {error && <p className="text-sm font-semibold text-rose-700 md:col-span-2">{error}</p>}
            <div className="flex justify-end gap-2 md:col-span-2"><button type="button" className="btn-secondary" onClick={onClose}>취소</button><button className="btn-primary" disabled={loading}>{loading ? "추가 중..." : "추가하기"}</button></div>
          </form>
        )}
      </section>
    </div>
  );
}

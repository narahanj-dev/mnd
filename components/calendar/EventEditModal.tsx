"use client";

import { X } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { EVENT_TYPE_OPTIONS } from "@/lib/constants";
import { parseJsonResponse } from "@/lib/utils";
import type { CalendarEvent } from "@/types";

export function EventEditModal({
  event,
  isAdmin,
  onClose,
  onSaved,
}: {
  event: CalendarEvent;
  isAdmin: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [allDay, setAllDay] = useState(event.all_day);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const close = (keyboardEvent: KeyboardEvent) => keyboardEvent.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(formEvent.currentTarget);
    const payload = {
      action: "update",
      reason: form.get("reason"),
      eventType: form.get("eventType"),
      title: form.get("title"),
      startDate: form.get("startDate"),
      endDate: form.get("endDate"),
      allDay,
      startTime: allDay ? null : form.get("startTime"),
      endTime: allDay ? null : form.get("endTime"),
      description: form.get("description"),
      publicNote: form.get("publicNote"),
      adminNote: form.get("adminNote"),
    };
    try {
      const result = await parseJsonResponse<{ message?: string }>(await fetch(`/api/events/${event.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }));
      alert(result.message ?? (isAdmin ? "일정이 수정되었습니다." : "일정 수정 요청이 접수되었습니다."));
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "수정 요청에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onMouseDown={(e) => e.currentTarget === e.target && onClose()}>
      <form onSubmit={submit} className="card max-h-[90vh] w-full max-w-2xl overflow-y-auto p-5" role="dialog" aria-modal="true">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-black">일정 수정</h2>
            <p className="text-sm text-slate-500">{isAdmin ? "수정 내용은 즉시 반영되고 사유가 사용자에게 전송됩니다." : "관리자 승인 전까지 기존 일정이 달력에 유지됩니다."}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 hover:bg-slate-100" aria-label="닫기"><X /></button>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="text-sm font-bold">종류
            <select name="eventType" defaultValue={event.event_type} className="input mt-1">
              {EVENT_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="text-sm font-bold">제목<input name="title" defaultValue={event.title} className="input mt-1" required maxLength={100} /></label>
          <label className="text-sm font-bold">시작일<input name="startDate" type="date" defaultValue={event.start_date} className="input mt-1" required /></label>
          <label className="text-sm font-bold">종료일<input name="endDate" type="date" defaultValue={event.end_date} className="input mt-1" required /></label>
          <label className="flex items-center gap-2 text-sm font-bold md:col-span-2"><input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> 종일 일정</label>
          {!allDay && <>
            <label className="text-sm font-bold">시작 시간<input name="startTime" type="time" defaultValue={event.start_time?.slice(0, 5) ?? ""} className="input mt-1" required /></label>
            <label className="text-sm font-bold">종료 시간<input name="endTime" type="time" defaultValue={event.end_time?.slice(0, 5) ?? ""} className="input mt-1" required /></label>
          </>}
          <label className="text-sm font-bold md:col-span-2">상세 내용<textarea name="description" defaultValue={event.description ?? ""} className="input mt-1 min-h-20" maxLength={2000} /></label>
          <label className="text-sm font-bold md:col-span-2">공개 메모<textarea name="publicNote" defaultValue={event.public_note ?? ""} className="input mt-1 min-h-16" maxLength={500} /></label>
          <label className="text-sm font-bold md:col-span-2">관리자 메모<textarea name="adminNote" defaultValue={event.admin_note ?? ""} className="input mt-1 min-h-16" maxLength={500} /></label>
          <label className="text-sm font-bold md:col-span-2">수정 사유<textarea name="reason" className="input mt-1 min-h-20" required maxLength={1000} placeholder={isAdmin ? "사용자에게 전달할 수정 사유" : "관리자에게 전달할 수정 사유"} /></label>
          {error && <p className="text-sm font-semibold text-rose-700 md:col-span-2">{error}</p>}
          <div className="flex justify-end gap-2 md:col-span-2"><button type="button" className="btn-secondary" onClick={onClose}>취소</button><button className="btn-primary" disabled={loading}>{loading ? "처리 중..." : isAdmin ? "즉시 수정" : "수정 승인 요청"}</button></div>
        </div>
      </form>
    </div>
  );
}

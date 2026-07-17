import type { EventStatus, EventType } from "@/types";

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  leave: "휴가",
  outing: "외출",
  schedule: "일정",
  anniversary: "기념일",
};

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  pending: "승인 대기",
  approved: "승인 완료",
  rejected: "승인 거절",
  cancellation_requested: "취소 요청",
  cancelled: "취소 완료",
};

export const EVENT_TYPE_STYLES: Record<EventType, string> = {
  leave: "bg-blue-100 text-blue-800 border-blue-200",
  outing: "bg-emerald-100 text-emerald-800 border-emerald-200",
  schedule: "bg-violet-100 text-violet-800 border-violet-200",
  anniversary: "bg-amber-100 text-amber-800 border-amber-200",
};

export const LOGIN_EMAIL_DOMAIN = "leave-calendar.local";

export function loginIdToEmail(loginId: string) {
  return `${loginId.trim()}@${LOGIN_EMAIL_DOMAIN}`;
}

import type { EventStatus, EventType, UserRole } from "@/types";

export const EVENT_TYPE_OPTIONS: { value: EventType; label: string }[] = [
  { value: "leave", label: "휴가" },
  { value: "overnight", label: "외박" },
  { value: "weekend_outing", label: "주말외출" },
  { value: "weekday_outing", label: "평일외출" },
  { value: "anniversary", label: "기념일" },
];

export const EVENT_TYPE_VALUES = ["leave", "overnight", "weekend_outing", "weekday_outing", "anniversary"] as const;

export const DEPARTMENT_CAPACITY_EVENT_TYPES: readonly EventType[] = [
  "leave",
  "overnight",
  "weekend_outing",
  "weekday_outing",
];

export const WEEKDAY_DEPARTMENT_CAPACITY_PERCENT = 25;
export const WEEKEND_DEPARTMENT_CAPACITY_PERCENT = 35;

export function departmentCapacityThreshold(day: Date) {
  return day.getDay() === 0 || day.getDay() === 6
    ? WEEKEND_DEPARTMENT_CAPACITY_PERCENT
    : WEEKDAY_DEPARTMENT_CAPACITY_PERCENT;
}

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  leave: "휴가",
  overnight: "외박",
  weekend_outing: "주말외출",
  weekday_outing: "평일외출",
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
  overnight: "bg-indigo-100 text-indigo-800 border-indigo-200",
  weekend_outing: "bg-emerald-100 text-emerald-800 border-emerald-200",
  weekday_outing: "bg-cyan-100 text-cyan-800 border-cyan-200",
  anniversary: "bg-amber-100 text-amber-800 border-amber-200",
};

export const USER_ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: "admin", label: "관리자" },
  { value: "department_admin", label: "부서관리자" },
  { value: "user", label: "일반사용자" },
];

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  admin: "관리자",
  department_admin: "부서관리자",
  user: "일반사용자",
};

export const DEPARTMENTS = ["교향악대", "관악대", "전통악대", "팡파르대", "대대본부"] as const;



export const LEAVE_SUBTYPE_OPTIONS = ["연가", "포상", "위로", "청원"] as const;
export const OVERNIGHT_SUBTYPE_OPTIONS = ["정기외박", "포상외박"] as const;

export const EVENT_SUBTYPE_OPTIONS: Partial<Record<EventType, readonly string[]>> = {
  leave: LEAVE_SUBTYPE_OPTIONS,
  overnight: OVERNIGHT_SUBTYPE_OPTIONS,
};

export function formatEventLabel(eventType: EventType, title: string | null | undefined) {
  const normalizedTitle = title?.trim();
  return normalizedTitle ? `${EVENT_TYPE_LABELS[eventType]}(${normalizedTitle})` : EVENT_TYPE_LABELS[eventType];
}

export function isValidEventTitle(eventType: EventType, title: string) {
  const options = EVENT_SUBTYPE_OPTIONS[eventType];
  return !options || options.includes(title);
}

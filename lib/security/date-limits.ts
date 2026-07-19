import { SecurityError } from "@/lib/security/errors";

export const MAX_CALENDAR_RANGE_DAYS = 1500;
export const MAX_EVENT_DURATION_DAYS = 366;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function parseIsoDate(value: string, fieldName = "날짜") {
  if (!DATE_PATTERN.test(value)) {
    throw new SecurityError("INVALID_DATE", 400, `${fieldName} 형식을 확인하세요.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new SecurityError("INVALID_DATE", 400, `${fieldName}를 확인하세요.`);
  }
  return date;
}

export function inclusiveDays(startDate: string, endDate: string) {
  const start = parseIsoDate(startDate, "시작일");
  const end = parseIsoDate(endDate, "종료일");
  if (end < start) {
    throw new SecurityError("INVALID_DATE", 400, "종료일은 시작일보다 빠를 수 없습니다.");
  }
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

export function assertEventDuration(startDate: string, endDate: string) {
  if (inclusiveDays(startDate, endDate) > MAX_EVENT_DURATION_DAYS) {
    throw new SecurityError(
      "EVENT_RANGE_TOO_LARGE",
      400,
      `일정은 최대 ${MAX_EVENT_DURATION_DAYS}일까지 등록할 수 있습니다.`,
    );
  }
}

export function assertCalendarRange(startDate: string, endDate: string) {
  if (inclusiveDays(startDate, endDate) > MAX_CALENDAR_RANGE_DAYS) {
    throw new SecurityError(
      "CALENDAR_RANGE_TOO_LARGE",
      400,
      "한 번에 조회할 수 있는 달력 기간을 초과했습니다.",
    );
  }
}

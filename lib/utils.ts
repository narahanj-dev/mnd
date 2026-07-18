import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

function readableError(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value instanceof Error && value.message.trim()) return value.message.trim();
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["message", "error_description", "details", "hint", "code"]) {
      const candidate = record[key];
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    }
    try {
      const serialized = JSON.stringify(value);
      if (serialized && serialized !== "{}") return serialized;
    } catch {
      // 직렬화할 수 없는 오류는 아래 기본 문구를 사용합니다.
    }
  }
  return null;
}

export async function parseJsonResponse<T>(response: Response): Promise<T> {
  const rawText = await response.text();
  let data: (T & { error?: unknown; message?: unknown }) | null = null;

  if (rawText) {
    try {
      data = JSON.parse(rawText) as T & { error?: unknown; message?: unknown };
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const message = readableError(data?.error)
      ?? readableError(data?.message)
      ?? readableError(rawText)
      ?? `요청 처리 중 오류가 발생했습니다. (${response.status})`;
    throw new Error(message);
  }

  return (data ?? ({} as T)) as T;
}

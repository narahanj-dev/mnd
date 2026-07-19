import { randomUUID } from "node:crypto";

export class SecurityError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly publicMessage: string,
  ) {
    super(code);
  }
}

export function safeErrorResponse(error: unknown, context = "api") {
  if (error instanceof SecurityError) {
    return Response.json({ error: error.publicMessage }, { status: error.status });
  }

  const reference = randomUUID();
  console.error(`[${context}] reference=${reference}`, error);
  return Response.json(
    { error: "서버 오류가 발생했습니다. 잠시 후 다시 시도하세요.", reference },
    { status: 500 },
  );
}

export function databaseFailure(context: string, error: unknown): never {
  console.error(`[database:${context}]`, error);
  throw new SecurityError("DATABASE_ERROR", 500, "요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요.");
}

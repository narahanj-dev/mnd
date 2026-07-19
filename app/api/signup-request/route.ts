import { safeErrorResponse } from "@/lib/security/errors";
import { assertSameOrigin } from "@/lib/security/request";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    return Response.json(
      { error: "회원가입 신청 기능은 종료되었습니다. 관리자에게 계정 생성을 요청하세요." },
      { status: 403 },
    );
  } catch (error) {
    return safeErrorResponse(error, "signup-disabled");
  }
}

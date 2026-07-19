import { requireUserManager, authErrorResponse } from "@/lib/auth/guards";
import { assertSameOrigin } from "@/lib/security/request";

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    await requireUserManager();
    return Response.json(
      { error: "가입 신청 승인 기능은 종료되었습니다. 사용자 관리에서 계정을 직접 생성하세요." },
      { status: 410 },
    );
  } catch (error) {
    return authErrorResponse(error);
  }
}

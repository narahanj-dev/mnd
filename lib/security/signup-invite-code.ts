import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

export function verifySignupInviteCode(input: string) {
  const expected = process.env.SIGNUP_INVITE_CODE?.trim();
  if (!expected) {
    throw new Error("SIGNUP_INVITE_CODE 환경변수가 설정되지 않았습니다.");
  }

  return timingSafeEqual(digest(input.trim()), digest(expected));
}

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEPARTMENTS } from "@/lib/constants";
import { birthMonthDay, encryptSignupRequestValues, loginIdHash } from "@/lib/security/pii";

const schema = z.object({
  name: z.string().trim().min(1).max(50),
  department: z.enum(DEPARTMENTS),
  birthMonth: z.coerce.number().int().min(1).max(12),
  birthDay: z.coerce.number().int().min(1).max(31),
  requestedLoginId: z.string().trim().regex(/^[A-Za-z0-9_-]{4,30}$/),
  reason: z.string().trim().max(500).optional(),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "입력 내용을 확인하세요. 아이디는 영문·숫자·밑줄·하이픈 4~30자입니다." }, { status: 400 });
  }

  let monthDay: string;
  try {
    monthDay = birthMonthDay(`${String(parsed.data.birthMonth).padStart(2, "0")}-${String(parsed.data.birthDay).padStart(2, "0")}`);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "생일 월/일을 확인하세요." }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    const hash = loginIdHash(parsed.data.requestedLoginId);
    const [{ data: existingProfile }, { data: existingRequest }] = await Promise.all([
      admin.from("profiles").select("id").eq("login_id_hash", hash).maybeSingle(),
      admin.from("signup_requests").select("id").eq("requested_login_id_hash", hash).eq("status", "pending").maybeSingle(),
    ]);
    if (existingProfile || existingRequest) {
      return Response.json({ error: "이미 사용 중이거나 신청된 아이디입니다." }, { status: 409 });
    }

    const { error } = await admin.from("signup_requests").insert({
      ...encryptSignupRequestValues({
        name: parsed.data.name,
        requested_login_id: parsed.data.requestedLoginId,
        birth_month_day: monthDay,
        reason: parsed.data.reason || null,
      }),
      department: parsed.data.department,
    });
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "서버 암호화 설정을 확인하세요." }, { status: 500 });
  }
}

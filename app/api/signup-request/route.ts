import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEPARTMENTS } from "@/lib/constants";

const schema = z.object({
  name: z.string().min(1).max(50),
  department: z.enum(DEPARTMENTS),
  contact: z.string().min(1).max(100),
  birthDate: z.string().date(),
  requestedLoginId: z.string().regex(/^[A-Za-z0-9_-]{4,30}$/),
  reason: z.string().max(500).optional(),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "입력 내용을 확인하세요. 군번은 영문·숫자·밑줄·하이픈 4~30자입니다." }, { status: 400 });
  if (parsed.data.birthDate > new Date().toISOString().slice(0, 10)) {
    return Response.json({ error: "생년월일은 오늘 이후 날짜로 입력할 수 없습니다." }, { status: 400 });
  }
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("signup_requests").insert({
      name: parsed.data.name,
      department: parsed.data.department,
      contact: parsed.data.contact,
      birth_date: parsed.data.birthDate,
      requested_login_id: parsed.data.requestedLoginId,
      reason: parsed.data.reason || null,
    });
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ ok: true });
  } catch { return Response.json({ error: "서버 설정을 확인하세요." }, { status: 500 }); }
}

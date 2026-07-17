import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
const schema = z.object({
  name: z.string().min(1).max(50), department: z.string().min(1).max(80), contact: z.string().min(1).max(100),
  requestedLoginId: z.string().regex(/^[A-Za-z0-9_-]{4,30}$/), reason: z.string().max(500).optional(),
});
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "입력 내용을 확인하세요. 아이디는 영문·숫자·밑줄·하이픈 4~30자입니다." }, { status: 400 });
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("signup_requests").insert({ name: parsed.data.name, department: parsed.data.department, contact: parsed.data.contact, requested_login_id: parsed.data.requestedLoginId, reason: parsed.data.reason || null });
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ ok: true });
  } catch { return Response.json({ error: "서버 설정을 확인하세요." }, { status: 500 }); }
}

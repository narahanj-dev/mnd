import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

function secureCookieOptions(options: Record<string, unknown>) {
  return {
    ...options,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
  };
}

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, secureCookieOptions(options)),
            );
          } catch {
            // Server Component에서는 쿠키 쓰기가 제한될 수 있으며 proxy에서 갱신한다.
          }
        },
      },
    },
  );
}

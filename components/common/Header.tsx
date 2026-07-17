"use client";

import { BarChart3, CalendarDays, Inbox, LogOut, ShieldCheck, UserRound, Users } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import type { Profile } from "@/types";

const baseLinks = [
  { href: "/calendar", label: "달력", icon: CalendarDays },
  { href: "/usage", label: "사용현황", icon: BarChart3 },
  { href: "/my-events", label: "내 일정", icon: UserRound },
  { href: "/messages", label: "쪽지", icon: Inbox },
];
const approvalLink = { href: "/approvals", label: "일정 승인", icon: ShieldCheck };
const userManagementLink = { href: "/users", label: "사용자 관리", icon: Users };
const adminOnlyLinks = [
  { href: "/admin/signup-requests", label: "가입 신청", icon: Inbox },
  { href: "/admin/settings", label: "관리자 설정", icon: ShieldCheck },
];

export function Header({
  profile,
  unreadCount = 0,
  pendingCount = 0,
}: {
  profile: Profile;
  unreadCount?: number;
  pendingCount?: number;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const links =
    profile.role === "admin"
      ? [...baseLinks, approvalLink, adminOnlyLinks[0], userManagementLink, adminOnlyLinks[1]]
      : profile.role === "department_admin"
        ? [...baseLinks, approvalLink, userManagementLink]
        : baseLinks;

  async function logout() {
    if (!confirm("로그아웃하시겠습니까?")) return;
    setLoading(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1500px] items-center gap-4 px-4 py-3">
        <Link href="/calendar" className="shrink-0 font-black text-slate-900">
          부서 공동 연차달력
        </Link>
        <nav className="flex flex-1 gap-1 overflow-x-auto" aria-label="주요 메뉴">
          {links.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href);
            const count =
              href === "/messages"
                ? unreadCount
                : href === "/approvals"
                  ? pendingCount
                  : 0;
            return (
              <Link
                key={href}
                href={href}
                className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold ${
                  active
                    ? "bg-blue-100 text-blue-800"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                <Icon size={16} /> {label}
                {count > 0 && (
                  <span className="rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] text-white">
                    {count}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="hidden text-right text-xs text-slate-500 md:block">
          <div className="font-bold text-slate-800">{profile.display_name}</div>
          <div>{profile.department}</div>
        </div>
        <button
          onClick={logout}
          disabled={loading}
          className="btn-secondary flex items-center gap-1.5 text-sm"
          aria-label="로그아웃"
        >
          <LogOut size={16} /> <span className="hidden sm:inline">로그아웃</span>
        </button>
      </div>
    </header>
  );
}

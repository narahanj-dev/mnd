import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "부서 공동 연차달력",
  description: "연가, 외출, 일정, 기념일을 승인 기반으로 관리하는 공동 달력",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}

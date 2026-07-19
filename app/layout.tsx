import type { Metadata } from "next";
import { headers } from "next/headers";
import { ThemeToggle } from "@/components/common/ThemeToggle";
import "./globals.css";

export const metadata: Metadata = {
  title: "부서 공동 휴가달력",
  description: "휴가, 외박, 외출, 기념일을 승인 기반으로 관리하는 공동 달력",
};

const themeInitScript = `
(() => {
  try {
    const savedTheme = localStorage.getItem("leave-calendar-theme");
    const theme = savedTheme === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch {
    document.documentElement.dataset.theme = "light";
    document.documentElement.style.colorScheme = "light";
  }
})();
`;

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="ko" suppressHydrationWarning>
      <head><script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeInitScript }} /></head>
      <body>{children}<ThemeToggle /></body>
    </html>
  );
}

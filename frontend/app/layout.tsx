import type { Metadata } from "next";
import Sidebar from "@/components/layout/Sidebar";
import "./globals.css";

/* 页面元数据：系统标题和描述 */
export const metadata: Metadata = {
  title: "竞品图案规则拆解系统",
  description: "AI 驱动的竞品图案分析与提示词生成系统",
};

/* 根布局组件：左侧 Sidebar + 右侧主内容区 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full">
      <body className="min-h-full font-mono bg-codex-bg text-codex-text">
        {/* 侧边栏导航 */}
        <Sidebar />
        {/* 主内容区：左侧留出 64px 给 Sidebar */}
        <main className="ml-16 min-h-screen">{children}</main>
      </body>
    </html>
  );
}

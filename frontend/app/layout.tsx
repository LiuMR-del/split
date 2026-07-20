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
    <html lang="zh-CN" className="h-full" suppressHydrationWarning>
      <head>
        {/* 主题防闪烁（FOUC）：内联脚本在浏览器解析 HTML 时同步执行，
            赶在首次绘制前把 localStorage 存的主题类加到 <html> 上。
            默认暗色（不存在或非 light 值都不加 class），只有存了 'light' 才加。
            参考 Next.js 官方文档 preventing-flash-before-hydration.md 的 Themes 一节。 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(localStorage.getItem("split:theme")==="light")document.documentElement.classList.add("light")}catch(e){}})()`,
          }}
        />
      </head>
      <body className="min-h-full font-mono bg-codex-bg text-codex-text">
        {/* 侧边栏导航 */}
        <Sidebar />
        {/* 主内容区：左侧留出 64px 给 Sidebar */}
        <main className="ml-16 min-h-screen">{children}</main>
      </body>
    </html>
  );
}

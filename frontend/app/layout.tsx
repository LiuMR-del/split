import type { Metadata } from "next";
import Sidebar from "@/components/layout/Sidebar";
import ThemeToggle from "@/components/layout/ThemeToggle";
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
    // suppressHydrationWarning：下面的内联脚本会在 hydrate 前改这个元素的 class，
    // 让 React 接受 DOM 现状而不是把它当成 mismatch 报错
    <html lang="zh-CN" className="h-full" suppressHydrationWarning>
      <head>
        {/* 主题防闪烁（FOUC）：脚本在浏览器解析 HTML 时同步执行，赶在首次绘制前
            读取 localStorage 里存的主题并加上 light class，避免刷新时先闪一下
            默认暗色再跳变浅色。try/catch 包裹：隐私模式等场景访问 localStorage
            会抛异常，不能让这段脚本本身把整个页面炸白屏 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(localStorage.getItem('split:theme')==='light'){document.documentElement.classList.add('light')}}catch(e){}})()`,
          }}
        />
      </head>
      <body className="min-h-full font-mono bg-codex-bg text-codex-text">
        {/* 侧边栏导航 */}
        <Sidebar />
        {/* 主题切换按钮：独立右上角悬浮，不嵌入 Sidebar */}
        <ThemeToggle />
        {/* 主内容区：左侧留出 64px 给 Sidebar */}
        <main className="ml-16 min-h-screen">{children}</main>
      </body>
    </html>
  );
}

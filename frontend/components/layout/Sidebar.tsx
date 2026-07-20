"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/* localStorage key，与 layout.tsx 内联防闪烁脚本用的 key 必须一致 */
const THEME_STORAGE_KEY = "split:theme";

/* 侧边栏导航项定义 */
const navItems = [
  { emoji: "🏠", label: "首页", href: "/" },
  { emoji: "📸", label: "分析", href: "/analyze" },
  { emoji: "📋", label: "规则库", href: "/rules" },
  { emoji: "📚", label: "图库", href: "/library" },
  { emoji: "🎨", label: "生图", href: "/gen" },
  { emoji: "⚙️", label: "设置", href: "/settings" },
];

/* 侧边栏组件：固定在左侧，64px 宽，深色背景 */
export default function Sidebar() {
  const pathname = usePathname();
  /* 主题状态：懒初始化直接读 DOM 上的 class（layout.tsx 内联脚本已在渲染前设置好），
   * 不读 localStorage 是因为 SSR 时 window 不存在——用 DOM class 判断能保证首次渲染
   * 就和内联脚本的判断结果一致，不会有一次额外的切换闪烁 */
  const [isLight, setIsLight] = useState(false);

  /* 挂载后同步一次实际 DOM 状态（SSR 阶段 useState 初始值恒为 false，
   * 这里用 effect 补上浏览器端的真实值，避免服务端渲染和客户端初始状态不一致） */
  useEffect(() => {
    setIsLight(document.documentElement.classList.contains("light"));
  }, []);

  /* 切换主题：更新 DOM class + 持久化到 localStorage + 更新按钮图标状态 */
  const toggleTheme = () => {
    const next = !isLight;
    document.documentElement.classList.toggle("light", next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next ? "light" : "dark");
    } catch {
      /* localStorage 不可用（隐私模式等）时静默失败，仅当前会话生效 */
    }
    setIsLight(next);
  };

  return (
    <aside className="fixed left-0 top-0 h-screen w-16 flex flex-col items-center py-6 bg-codex-bg border-r border-codex-border z-50">
      {/* 导航图标列表 */}
      <nav className="flex flex-col items-center gap-2 mt-4">
        {navItems.map((item) => {
          /* 判断当前页面是否匹配（首页精确匹配，其他前缀匹配） */
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              className={`
                relative flex items-center justify-center w-10 h-10 rounded-lg
                transition-all duration-200 group
                ${
                  isActive
                    ? "bg-codex-accent/10"
                    : "hover:bg-codex-card"
                }
              `}
            >
              {/* 左侧激活指示条 */}
              {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-codex-accent rounded-r" />
              )}
              {/* 导航图标 */}
              <span className="text-xl">{item.emoji}</span>
            </Link>
          );
        })}
      </nav>

      {/* 主题切换按钮：固定在底部，与导航项视觉区隔 */}
      <button
        onClick={toggleTheme}
        title={isLight ? "切换为暗色" : "切换为浅色"}
        className="
          mt-auto flex items-center justify-center w-10 h-10 rounded-lg
          text-xl transition-colors duration-200
          hover:bg-codex-card cursor-pointer
        "
      >
        {isLight ? "☀️" : "🌙"}
      </button>
    </aside>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
    </aside>
  );
}

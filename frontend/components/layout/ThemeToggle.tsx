"use client";

import { useState } from "react";

/* localStorage key，需与 layout.tsx 内联防闪烁脚本使用的 key 保持一致 */
const THEME_STORAGE_KEY = "split:theme";

/* 主题切换按钮：固定在右上角悬浮，独立于 Sidebar（不随左侧导航栏布局） */
export default function ThemeToggle() {
  /* 懒初始化直接读 DOM 上的 class（layout.tsx 内联脚本已在渲染前设置好），
   * SSR 阶段 document 不存在，返回 false（默认暗色），与内联脚本的默认行为一致 */
  const [isLight, setIsLight] = useState(() => {
    if (typeof document === "undefined") return false;
    return document.documentElement.classList.contains("light");
  });

  /* 切换主题：同步 DOM class + 持久化到 localStorage + 更新按钮图标状态 */
  const handleToggle = () => {
    const next = !isLight;
    document.documentElement.classList.toggle("light", next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next ? "light" : "dark");
    } catch {
      /* 隐私模式/存储被禁用时静默失败，仅当前会话生效 */
    }
    setIsLight(next);
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      title={isLight ? "切换为暗色" : "切换为浅色"}
      aria-label={isLight ? "切换为暗色" : "切换为浅色"}
      className="fixed top-4 right-4 z-50 flex items-center justify-center w-10 h-10 rounded-full bg-codex-card border border-codex-border hover:border-codex-accent transition-colors cursor-pointer"
    >
      {/* 图标代表当前主题（暗色显示月亮，浅色显示太阳），SSR 默认值与
       * 客户端实际偏好可能不同，用 suppressHydrationWarning 避免误报 mismatch */}
      <span className="text-xl" suppressHydrationWarning>
        {isLight ? "☀️" : "🌙"}
      </span>
    </button>
  );
}

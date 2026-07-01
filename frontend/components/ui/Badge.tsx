'use client';

/**
 * 标签徽章组件
 * 支持 SABC 等级变体和默认样式
 * Codex 深色风格
 */

import { ReactNode } from 'react';

type BadgeVariant = 'S' | 'A' | 'B' | 'C' | 'default';

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

/* 各变体对应的样式 */
const variantStyles: Record<BadgeVariant, string> = {
  S: 'bg-green-900/50 text-codex-success border-codex-success',
  A: 'bg-blue-900/50 text-codex-accent border-codex-accent',
  B: 'bg-yellow-900/50 text-codex-warning border-codex-warning',
  C: 'bg-red-900/50 text-codex-danger border-codex-danger',
  default: 'bg-codex-card text-codex-text-secondary border-codex-border',
};

export default function Badge({
  children,
  variant = 'default',
  className = '',
}: BadgeProps) {
  return (
    <span
      className={`
        inline-flex items-center
        rounded-full px-2 py-0.5
        text-xs font-mono
        border
        ${variantStyles[variant]}
        ${className}
      `}
    >
      {children}
    </span>
  );
}

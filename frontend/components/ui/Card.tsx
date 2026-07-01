'use client';

/**
 * 卡片容器组件
 * 支持 hoverable 悬浮高亮效果
 * Codex 深色风格
 */

import { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  hoverable?: boolean;
}

export default function Card({
  children,
  className = '',
  onClick,
  hoverable = false,
}: CardProps) {
  return (
    <div
      onClick={onClick}
      className={`
        bg-codex-card border border-codex-border rounded-lg p-4
        transition-colors duration-150
        ${hoverable ? 'hover:border-codex-accent cursor-pointer' : ''}
        ${onClick ? 'cursor-pointer' : ''}
        ${className}
      `}
    >
      {children}
    </div>
  );
}

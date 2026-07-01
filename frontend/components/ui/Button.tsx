'use client';

/**
 * 通用按钮组件
 * 支持 variant（primary/secondary/danger/ghost）、size（sm/md/lg）、loading 状态
 * Codex 深色风格
 */

import { ButtonHTMLAttributes } from 'react';

/* 按钮变体类型 */
type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

/* 按钮尺寸类型 */
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

/* 各变体对应的样式 */
const variantStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-codex-accent text-white hover:bg-codex-accent/80 active:bg-codex-accent/70',
  secondary:
    'bg-codex-card text-codex-text border border-codex-border hover:bg-codex-border/50 active:bg-codex-border/70',
  danger:
    'bg-codex-danger text-white hover:bg-codex-danger/80 active:bg-codex-danger/70',
  ghost:
    'bg-transparent text-codex-text hover:bg-codex-card active:bg-codex-border/50',
};

/* 各尺寸对应的样式 */
const sizeStyles: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-base',
};

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  /* loading 或 disabled 时禁用按钮 */
  const isDisabled = loading || disabled;

  return (
    <button
      className={`
        inline-flex items-center justify-center gap-2
        rounded-md font-mono font-medium
        transition-colors duration-150
        cursor-pointer
        disabled:opacity-50 disabled:cursor-not-allowed
        ${variantStyles[variant]}
        ${sizeStyles[size]}
        ${className}
      `}
      disabled={isDisabled}
      {...rest}
    >
      {/* loading 旋转动画 */}
      {loading && (
        <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
      )}
      {children}
    </button>
  );
}

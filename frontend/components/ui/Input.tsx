'use client';

/**
 * 通用输入框组件
 * 支持 label、placeholder、type（text/password）、error 状态
 * type=password 时右侧有显示/隐藏切换按钮
 * Codex 深色风格
 */

import { InputHTMLAttributes, useState } from 'react';

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  type?: 'text' | 'password';
  error?: string;
}

export default function Input({
  label,
  type = 'text',
  error,
  className = '',
  id,
  ...rest
}: InputProps) {
  /* 控制密码可见性 */
  const [showPassword, setShowPassword] = useState(false);

  /* 实际渲染的 input type：密码框根据可见性切换 */
  const inputType = type === 'password' && showPassword ? 'text' : type;

  /* 生成唯一 id（label 关联用） */
  const inputId = id || `input-${label?.replace(/\s+/g, '-') || 'field'}`;

  return (
    <div className="flex flex-col gap-1.5">
      {/* 标签 */}
      {label && (
        <label
          htmlFor={inputId}
          className="text-sm text-codex-text-secondary font-mono"
        >
          {label}
        </label>
      )}

      {/* 输入框容器 */}
      <div className="relative">
        <input
          id={inputId}
          type={inputType}
          className={`
            w-full px-3 py-2 text-sm font-mono
            bg-codex-card text-codex-text
            border rounded-md
            placeholder:text-codex-text-secondary/50
            transition-colors duration-150
            focus:outline-none focus:border-codex-accent focus:ring-1 focus:ring-codex-accent/30
            ${error ? 'border-codex-danger' : 'border-codex-border'}
            ${type === 'password' ? 'pr-10' : ''}
            ${className}
          `}
          {...rest}
        />

        {/* 密码显示/隐藏切换按钮 */}
        {type === 'password' && (
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="
              absolute right-2 top-1/2 -translate-y-1/2
              text-codex-text-secondary hover:text-codex-text
              transition-colors duration-150
              cursor-pointer select-none
              text-sm
            "
            tabIndex={-1}
            aria-label={showPassword ? '隐藏密码' : '显示密码'}
          >
            {showPassword ? '🙈' : '👁'}
          </button>
        )}
      </div>

      {/* 错误信息 */}
      {error && (
        <p className="text-xs text-codex-danger font-mono">{error}</p>
      )}
    </div>
  );
}

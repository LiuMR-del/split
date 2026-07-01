'use client';

/**
 * 通用下拉选择框组件
 * 支持 label、options、value、onChange
 * Codex 深色风格
 */

import { SelectHTMLAttributes } from 'react';

/* 选项类型 */
interface SelectOption {
  label: string;
  value: string;
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  label?: string;
  options: SelectOption[];
  value?: string;
  onChange?: (value: string) => void;
}

export default function Select({
  label,
  options,
  value,
  onChange,
  className = '',
  id,
  ...rest
}: SelectProps) {
  /* 生成唯一 id（label 关联用） */
  const selectId = id || `select-${label?.replace(/\s+/g, '-') || 'field'}`;

  return (
    <div className="flex flex-col gap-1.5">
      {/* 标签 */}
      {label && (
        <label
          htmlFor={selectId}
          className="text-sm text-codex-text-secondary font-mono"
        >
          {label}
        </label>
      )}

      {/* 下拉框 */}
      <select
        id={selectId}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        className={`
          w-full min-w-0 px-3 py-2 text-sm font-mono
          bg-codex-card text-codex-text
          border border-codex-border rounded-md
          transition-colors duration-150
          focus:outline-none focus:border-codex-accent focus:ring-1 focus:ring-codex-accent/30
          cursor-pointer
          appearance-none
          bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2020%2020%22%20fill%3D%22%238b949e%22%3E%3Cpath%20fill-rule%3D%22evenodd%22%20d%3D%22M5.23%207.21a.75.75%200%20011.06.02L10%2011.168l3.71-3.938a.75.75%200%20111.08%201.04l-4.25%204.5a.75.75%200%2001-1.08%200l-4.25-4.5a.75.75%200%2001.02-1.06z%22%20clip-rule%3D%22evenodd%22%2F%3E%3C%2Fsvg%3E')]
          bg-[length:1.25rem_1.25rem]
          bg-[position:right_0.5rem_center]
          bg-no-repeat
          pr-8
          ${className}
        `}
        {...rest}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} title={opt.label}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

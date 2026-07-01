'use client';

/**
 * 多选标签选择器组件
 * 从受控词表中选择标签，已选的显示为可删除的 Badge
 * Codex 深色风格
 */

import { useState, useMemo } from 'react';
import Badge from '@/components/ui/Badge';

interface TagSelectorProps {
  label: string;
  options: string[];        /* 受控词表选项列表 */
  selected: string[];       /* 已选中的标签 */
  onChange: (selected: string[]) => void;
}

export default function TagSelector({
  label,
  options,
  selected,
  onChange,
}: TagSelectorProps) {
  const [inputValue, setInputValue] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);

  /* 过滤可选项：未选中 + 匹配搜索 */
  const filteredOptions = useMemo(() => {
    return options.filter(
      (opt) =>
        !selected.includes(opt) &&
        opt.toLowerCase().includes(inputValue.toLowerCase())
    );
  }, [options, selected, inputValue]);

  /* 添加标签 */
  const handleAdd = (tag: string) => {
    if (!selected.includes(tag)) {
      onChange([...selected, tag]);
    }
    setInputValue('');
    setShowDropdown(false);
  };

  /* 删除标签 */
  const handleRemove = (tag: string) => {
    onChange(selected.filter((t) => t !== tag));
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm text-codex-text-secondary font-mono">
        {label}
      </label>

      {/* 已选标签展示 */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-1">
          {selected.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-mono border bg-codex-card text-codex-text border-codex-border"
            >
              {tag}
              <button
                type="button"
                onClick={() => handleRemove(tag)}
                className="text-codex-text-secondary hover:text-codex-danger transition-colors cursor-pointer ml-0.5"
                aria-label={`删除 ${tag}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* 搜索输入 + 下拉选项 */}
      <div className="relative">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            setShowDropdown(true);
          }}
          onFocus={() => setShowDropdown(true)}
          onBlur={() => {
            /* 延迟关闭，让点击事件先触发 */
            setTimeout(() => setShowDropdown(false), 200);
          }}
          placeholder="输入搜索或点击选择..."
          className="
            w-full px-3 py-1.5 text-xs font-mono
            bg-codex-card text-codex-text
            border border-codex-border rounded-md
            placeholder:text-codex-text-secondary/50
            focus:outline-none focus:border-codex-accent focus:ring-1 focus:ring-codex-accent/30
            transition-colors duration-150
          "
        />

        {/* 下拉选项列表 */}
        {showDropdown && filteredOptions.length > 0 && (
          <div className="absolute z-10 mt-1 w-full max-h-40 overflow-y-auto bg-codex-card border border-codex-border rounded-md shadow-lg">
            {filteredOptions.map((opt) => (
              <button
                key={opt}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleAdd(opt)}
                className="w-full text-left px-3 py-1.5 text-xs font-mono text-codex-text hover:bg-codex-accent/10 transition-colors cursor-pointer"
              >
                {opt}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

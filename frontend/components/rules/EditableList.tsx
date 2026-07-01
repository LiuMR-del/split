'use client';

/**
 * 可编辑字符串列表组件
 * 支持增删每一项
 * Codex 深色风格
 */

import { useState } from 'react';
import Button from '@/components/ui/Button';

interface EditableListProps {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  icon?: string;           /* 每项前面的图标，如 🔒 */
  placeholder?: string;
}

export default function EditableList({
  label,
  items,
  onChange,
  icon,
  placeholder = '输入内容...',
}: EditableListProps) {
  const [newItem, setNewItem] = useState('');

  /* 添加 */
  const handleAdd = () => {
    const trimmed = newItem.trim();
    if (trimmed) {
      onChange([...items, trimmed]);
      setNewItem('');
    }
  };

  /* 按回车添加 */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  };

  /* 删除 */
  const handleRemove = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  /* 编辑 */
  const handleUpdate = (index: number, value: string) => {
    const updated = [...items];
    updated[index] = value;
    onChange(updated);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm text-codex-text-secondary font-mono">{label}</label>

      {/* 已有项目列表 */}
      {items.length > 0 && (
        <div className="space-y-1">
          {items.map((item, i) => (
            <div key={i} className="flex items-center gap-2">
              {icon && <span className="text-xs flex-shrink-0">{icon}</span>}
              <input
                value={item}
                onChange={(e) => handleUpdate(i, e.target.value)}
                className="flex-1 px-2 py-1 text-xs font-mono bg-codex-card text-codex-text border border-codex-border rounded focus:outline-none focus:border-codex-accent"
              />
              <button
                type="button"
                onClick={() => handleRemove(i)}
                className="text-codex-danger hover:text-codex-danger/80 cursor-pointer text-xs flex-shrink-0"
                title="删除"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 添加新项 */}
      <div className="flex items-center gap-2">
        <input
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="flex-1 px-2 py-1 text-xs font-mono bg-codex-card text-codex-text border border-codex-border rounded placeholder:text-codex-text-secondary/50 focus:outline-none focus:border-codex-accent"
        />
        <Button type="button" variant="ghost" size="sm" onClick={handleAdd}>
          +
        </Button>
      </div>
    </div>
  );
}

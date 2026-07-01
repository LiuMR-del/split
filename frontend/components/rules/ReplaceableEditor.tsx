'use client';

/**
 * 可替换元素编辑器
 * 第 3 层：每个维度一组（维度名 + 原始值 + 替代方案列表）
 * Codex 深色风格
 */

import { useState } from 'react';
import Button from '@/components/ui/Button';

/* 替代方案类型 */
interface ReplaceableItem {
  original: string;
  alternatives: string[];
}

interface ReplaceableEditorProps {
  elements: Record<string, ReplaceableItem>;
  onChange: (elements: Record<string, ReplaceableItem>) => void;
}

export default function ReplaceableEditor({
  elements,
  onChange,
}: ReplaceableEditorProps) {
  const [newDim, setNewDim] = useState('');

  /* 获取维度列表 */
  const dims = Object.keys(elements);

  /* 添加新维度 */
  const handleAddDim = () => {
    const trimmed = newDim.trim();
    if (trimmed && !elements[trimmed]) {
      onChange({ ...elements, [trimmed]: { original: '', alternatives: [] } });
      setNewDim('');
    }
  };

  /* 删除维度 */
  const handleRemoveDim = (dim: string) => {
    const updated = { ...elements };
    delete updated[dim];
    onChange(updated);
  };

  /* 更新原始值 */
  const handleUpdateOriginal = (dim: string, value: string) => {
    onChange({
      ...elements,
      [dim]: { ...elements[dim], original: value },
    });
  };

  /* 添加替代方案 */
  const handleAddAlt = (dim: string, alt: string) => {
    const trimmed = alt.trim();
    if (trimmed) {
      onChange({
        ...elements,
        [dim]: {
          ...elements[dim],
          alternatives: [...elements[dim].alternatives, trimmed],
        },
      });
    }
  };

  /* 删除替代方案 */
  const handleRemoveAlt = (dim: string, index: number) => {
    onChange({
      ...elements,
      [dim]: {
        ...elements[dim],
        alternatives: elements[dim].alternatives.filter((_, i) => i !== index),
      },
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <label className="text-sm text-codex-text-secondary font-mono">可替换元素</label>

      {/* 各维度 */}
      {dims.map((dim) => (
        <DimensionRow
          key={dim}
          dimension={dim}
          item={elements[dim]}
          onUpdateOriginal={(v) => handleUpdateOriginal(dim, v)}
          onAddAlt={(alt) => handleAddAlt(dim, alt)}
          onRemoveAlt={(i) => handleRemoveAlt(dim, i)}
          onRemoveDim={() => handleRemoveDim(dim)}
        />
      ))}

      {/* 添加新维度 */}
      <div className="flex items-center gap-2">
        <input
          value={newDim}
          onChange={(e) => setNewDim(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleAddDim();
            }
          }}
          placeholder="新维度名称..."
          className="flex-1 px-2 py-1 text-xs font-mono bg-codex-card text-codex-text border border-codex-border rounded placeholder:text-codex-text-secondary/50 focus:outline-none focus:border-codex-accent"
        />
        <Button type="button" variant="ghost" size="sm" onClick={handleAddDim}>
          + 添加维度
        </Button>
      </div>
    </div>
  );
}

/* 单个维度行 */
function DimensionRow({
  dimension,
  item,
  onUpdateOriginal,
  onAddAlt,
  onRemoveAlt,
  onRemoveDim,
}: {
  dimension: string;
  item: ReplaceableItem;
  onUpdateOriginal: (v: string) => void;
  onAddAlt: (alt: string) => void;
  onRemoveAlt: (index: number) => void;
  onRemoveDim: () => void;
}) {
  const [newAlt, setNewAlt] = useState('');

  return (
    <div className="border border-codex-border rounded-md p-3 bg-codex-card/50 space-y-2">
      {/* 维度名 + 删除按钮 */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono font-bold text-codex-text">{dimension}</span>
        <button
          type="button"
          onClick={onRemoveDim}
          className="text-codex-danger hover:text-codex-danger/80 cursor-pointer text-xs"
          title="删除维度"
        >
          ✕
        </button>
      </div>

      {/* 原始值 */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-codex-text-secondary font-mono min-w-[50px]">原始值</span>
        <input
          value={item.original}
          onChange={(e) => onUpdateOriginal(e.target.value)}
          className="flex-1 px-2 py-1 text-xs font-mono bg-codex-card text-codex-text border border-codex-border rounded focus:outline-none focus:border-codex-accent"
        />
      </div>

      {/* 替代方案列表 */}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-codex-text-secondary font-mono">替代方案</span>
        <div className="flex flex-wrap gap-1.5">
          {item.alternatives.map((alt, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-mono border bg-codex-card text-codex-text border-codex-border"
            >
              {alt}
              <button
                type="button"
                onClick={() => onRemoveAlt(i)}
                className="text-codex-text-secondary hover:text-codex-danger transition-colors cursor-pointer ml-0.5"
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-1">
          <input
            value={newAlt}
            onChange={(e) => setNewAlt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onAddAlt(newAlt);
                setNewAlt('');
              }
            }}
            placeholder="添加替代方案..."
            className="flex-1 px-2 py-1 text-xs font-mono bg-codex-card text-codex-text border border-codex-border rounded placeholder:text-codex-text-secondary/50 focus:outline-none focus:border-codex-accent"
          />
          <button
            type="button"
            onClick={() => {
              onAddAlt(newAlt);
              setNewAlt('');
            }}
            className="text-codex-accent hover:text-codex-accent/80 cursor-pointer text-xs font-mono"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}

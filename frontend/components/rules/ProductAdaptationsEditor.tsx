'use client';

/**
 * 产品适配编辑器
 * 第 4 层：每个产品一个可折叠卡片，可增删
 * Codex 深色风格
 */

import { useState } from 'react';
import Button from '@/components/ui/Button';
import EditableList from '@/components/rules/EditableList';

/* 产品适配类型 */
interface ProductAdaptation {
  canvas_ratio: string;
  adaptation_notes: string;
  simplify: string[];
  enhance: string[];
}

interface ProductAdaptationsEditorProps {
  adaptations: Record<string, ProductAdaptation>;
  onChange: (adaptations: Record<string, ProductAdaptation>) => void;
}

export default function ProductAdaptationsEditor({
  adaptations,
  onChange,
}: ProductAdaptationsEditorProps) {
  const [newName, setNewName] = useState('');

  const productNames = Object.keys(adaptations);

  /* 添加产品 */
  const handleAdd = () => {
    const trimmed = newName.trim();
    if (trimmed && !adaptations[trimmed]) {
      onChange({
        ...adaptations,
        [trimmed]: { canvas_ratio: '', adaptation_notes: '', simplify: [], enhance: [] },
      });
      setNewName('');
    }
  };

  /* 删除产品 */
  const handleRemove = (name: string) => {
    const updated = { ...adaptations };
    delete updated[name];
    onChange(updated);
  };

  /* 更新产品字段 */
  const handleUpdate = (name: string, field: string, value: unknown) => {
    onChange({
      ...adaptations,
      [name]: { ...adaptations[name], [field]: value },
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <label className="text-sm text-codex-text-secondary font-mono">产品适配</label>

      {productNames.map((name) => (
        <ProductCard
          key={name}
          name={name}
          adaptation={adaptations[name]}
          onUpdate={(field, value) => handleUpdate(name, field, value)}
          onRemove={() => handleRemove(name)}
        />
      ))}

      {/* 添加新产品 */}
      <div className="flex items-center gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleAdd();
            }
          }}
          placeholder="新产品名称..."
          className="flex-1 px-2 py-1 text-xs font-mono bg-codex-card text-codex-text border border-codex-border rounded placeholder:text-codex-text-secondary/50 focus:outline-none focus:border-codex-accent"
        />
        <Button type="button" variant="ghost" size="sm" onClick={handleAdd}>
          + 添加产品
        </Button>
      </div>
    </div>
  );
}

/* 单个产品卡片 */
function ProductCard({
  name,
  adaptation,
  onUpdate,
  onRemove,
}: {
  name: string;
  adaptation: ProductAdaptation;
  onUpdate: (field: string, value: unknown) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className="border border-codex-border rounded-md overflow-hidden">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-3 py-2 bg-codex-card">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 cursor-pointer"
        >
          <span className="text-xs text-codex-text-secondary">{open ? '▼' : '▶'}</span>
          <span className="text-xs font-mono font-bold text-codex-text">{name}</span>
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="text-codex-danger hover:text-codex-danger/80 cursor-pointer text-xs"
          title="删除产品"
        >
          ✕
        </button>
      </div>

      {/* 内容 */}
      {open && (
        <div className="px-3 py-3 bg-codex-bg/50 space-y-3">
          {/* 比例 */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-codex-text-secondary font-mono">比例</label>
            <input
              value={adaptation.canvas_ratio}
              onChange={(e) => onUpdate('canvas_ratio', e.target.value)}
              className="w-full px-2 py-1 text-xs font-mono bg-codex-card text-codex-text border border-codex-border rounded focus:outline-none focus:border-codex-accent"
            />
          </div>

          {/* 适配说明 */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-codex-text-secondary font-mono">适配说明</label>
            <textarea
              value={adaptation.adaptation_notes}
              onChange={(e) => onUpdate('adaptation_notes', e.target.value)}
              rows={2}
              className="w-full px-2 py-1 text-xs font-mono bg-codex-card text-codex-text border border-codex-border rounded resize-y focus:outline-none focus:border-codex-accent"
            />
          </div>

          {/* 简化项 */}
          <EditableList
            label="简化项"
            items={adaptation.simplify || []}
            onChange={(items) => onUpdate('simplify', items)}
            placeholder="添加简化项..."
          />

          {/* 增强项 */}
          <EditableList
            label="增强项"
            items={adaptation.enhance || []}
            onChange={(items) => onUpdate('enhance', items)}
            placeholder="添加增强项..."
          />
        </div>
      )}
    </div>
  );
}

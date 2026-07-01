'use client';

/**
 * 可编辑元素表格组件
 * 用于第 2 层必备元素的增删改
 * Codex 深色风格
 */

import Button from '@/components/ui/Button';

/* 元素类型 */
interface MustHaveElement {
  slot: string;
  description: string;
  position: string;
  visual_weight: string;
}

interface EditableElementsTableProps {
  elements: MustHaveElement[];
  onChange: (elements: MustHaveElement[]) => void;
}

export default function EditableElementsTable({
  elements,
  onChange,
}: EditableElementsTableProps) {
  /* 更新单个字段 */
  const handleUpdate = (index: number, field: keyof MustHaveElement, value: string) => {
    const updated = [...elements];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };

  /* 添加一行 */
  const handleAdd = () => {
    onChange([...elements, { slot: '', description: '', position: '', visual_weight: '' }]);
  };

  /* 删除一行 */
  const handleRemove = (index: number) => {
    onChange(elements.filter((_, i) => i !== index));
  };

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm text-codex-text-secondary font-mono">必备元素</label>
      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono border-collapse">
          <thead>
            <tr className="border-b border-codex-border">
              <th className="text-left py-1.5 px-2 text-codex-text-secondary">槽位</th>
              <th className="text-left py-1.5 px-2 text-codex-text-secondary">描述</th>
              <th className="text-left py-1.5 px-2 text-codex-text-secondary">位置</th>
              <th className="text-left py-1.5 px-2 text-codex-text-secondary">权重</th>
              <th className="text-left py-1.5 px-2 text-codex-text-secondary w-12">操作</th>
            </tr>
          </thead>
          <tbody>
            {elements.map((el, i) => (
              <tr key={i} className="border-b border-codex-border/50">
                <td className="py-1 px-1">
                  <input
                    value={el.slot}
                    onChange={(e) => handleUpdate(i, 'slot', e.target.value)}
                    className="w-full px-2 py-1 text-xs font-mono bg-codex-card text-codex-text border border-codex-border rounded focus:outline-none focus:border-codex-accent"
                  />
                </td>
                <td className="py-1 px-1">
                  <input
                    value={el.description}
                    onChange={(e) => handleUpdate(i, 'description', e.target.value)}
                    className="w-full px-2 py-1 text-xs font-mono bg-codex-card text-codex-text border border-codex-border rounded focus:outline-none focus:border-codex-accent"
                  />
                </td>
                <td className="py-1 px-1">
                  <input
                    value={el.position}
                    onChange={(e) => handleUpdate(i, 'position', e.target.value)}
                    className="w-full px-2 py-1 text-xs font-mono bg-codex-card text-codex-text border border-codex-border rounded focus:outline-none focus:border-codex-accent"
                  />
                </td>
                <td className="py-1 px-1">
                  <input
                    value={el.visual_weight}
                    onChange={(e) => handleUpdate(i, 'visual_weight', e.target.value)}
                    className="w-full px-2 py-1 text-xs font-mono bg-codex-card text-codex-text border border-codex-border rounded focus:outline-none focus:border-codex-accent"
                  />
                </td>
                <td className="py-1 px-1 text-center">
                  <button
                    type="button"
                    onClick={() => handleRemove(i)}
                    className="text-codex-danger hover:text-codex-danger/80 cursor-pointer text-sm"
                    title="删除行"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={handleAdd}>
        + 添加元素
      </Button>
    </div>
  );
}

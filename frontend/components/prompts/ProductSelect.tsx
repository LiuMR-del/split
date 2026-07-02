'use client';

/**
 * 目标产品选择组件
 * 从规则卡的 layer_4_product.adaptations 提取产品选项，
 * 额外提供"自定义"选项——AI 分析有时会漏识别竞品图的真实产品类型
 * （比如把相框误判成毛毯），选中自定义后可以手动填正确的产品名，
 * 不需要跑去编辑页面改规则卡才能用某个产品生成提示词。
 *
 * PromptVersionA / PromptVersionB 共用同一份"从 ruleCard 取产品下拉项"逻辑，
 * 之前两处重复维护，这里统一成一个组件。
 */

import { useState } from 'react';
import Select from '@/components/ui/Select';

const CUSTOM_VALUE = '__custom_product__';

/** 规则卡没有产品适配数据时的兜底选项 */
const FALLBACK_OPTIONS = [
  { label: 'Blanket 毛毯', value: 'Blanket 毛毯' },
  { label: 'T-Shirt T恤', value: 'T-Shirt T恤' },
  { label: 'Mug 马克杯', value: 'Mug 马克杯' },
  { label: 'Poster 海报', value: 'Poster 海报' },
];

/** 从规则卡提取产品选项列表（不含自定义项，由组件统一追加） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getProductOptionsFromRuleCard(ruleCard: any): Array<{ label: string; value: string }> {
  const adaptations = ruleCard?.layer_4_product?.adaptations;
  if (!adaptations || typeof adaptations !== 'object' || Object.keys(adaptations).length === 0) {
    return FALLBACK_OPTIONS;
  }
  return Object.keys(adaptations).map((key) => ({ label: key, value: key }));
}

interface ProductSelectProps {
  /** 从规则卡提取出的产品选项（不含自定义项） */
  options: Array<{ label: string; value: string }>;
  value: string;
  onChange: (value: string) => void;
  label?: string;
}

export default function ProductSelect({
  options,
  value,
  onChange,
  label = '🎯 目标产品',
}: ProductSelectProps) {
  /* 是否处于自定义文本输入模式 */
  const [customMode, setCustomMode] = useState(false);

  const handleSelectChange = (val: string) => {
    if (val === CUSTOM_VALUE) {
      setCustomMode(true);
      onChange('');
      return;
    }
    onChange(val);
  };

  const handleRestoreSelect = () => {
    setCustomMode(false);
    onChange('');
  };

  if (customMode) {
    return (
      <div className="flex flex-col gap-1.5">
        <label className="text-sm text-codex-text-secondary font-mono">{label}</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="手动输入产品名称，如 Frame 竖版相框"
            autoFocus
            className="
              flex-1 px-3 py-2 text-sm font-mono
              bg-codex-card text-codex-text
              border border-codex-accent rounded-md
              placeholder:text-codex-text-secondary/50
              focus:outline-none focus:ring-1 focus:ring-codex-accent/30
            "
          />
          <button
            onClick={handleRestoreSelect}
            className="
              px-2 py-1 text-xs font-mono rounded-md shrink-0
              bg-codex-card text-codex-text-secondary
              border border-codex-border
              hover:text-codex-text hover:border-codex-accent
              transition-colors duration-150
              cursor-pointer whitespace-nowrap
            "
            title="恢复下拉选择"
          >
            ↩ 恢复下拉
          </button>
        </div>
        <p className="text-[11px] font-mono text-codex-text-secondary">
          💡 AI 识别的产品列表不准确时（比如竞品图实际是相框却没列出来），可以在这里手动填写
        </p>
      </div>
    );
  }

  return (
    <Select
      label={label}
      options={[
        { label: '— 请选择目标产品 —', value: '' },
        ...options,
        { label: '✏️ 自定义...', value: CUSTOM_VALUE },
      ]}
      value={value}
      onChange={handleSelectChange}
    />
  );
}

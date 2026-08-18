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
 *
 * 三期阶段一：自定义输入过的产品名会持久化到后端（lib/userPrefs.ts），
 * 下次打开任何规则卡都直接出现在下拉框里（带 ✏️ 前缀），不用重新打字；
 * 自定义输入模式下可以在 chips 区删除不再需要的。
 */

import { useState, useEffect } from 'react';
import Select from '@/components/ui/Select';
import { fetchPrefs, removeCustomProduct, getCachedPrefs } from '@/lib/userPrefs';

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
  /* 2026-08-18：过滤掉 `Unknown 未识别`——那是 AI 确实判断不出载体时的兜底值
   * （见后端 prompts/rule_extraction.py 第 4 层），拿它当目标产品会让生图提示词
   * 首句变成 "Create a Unknown print-on-demand design."。此时回落到内置常见产品，
   * 用户可自行选或用"✏️ 自定义"填。 */
  const keys = Object.keys(adaptations).filter((k) => !/未识别|^Unknown\b/.test(k));
  if (keys.length === 0) {
    return FALLBACK_OPTIONS;
  }
  return keys.map((key) => ({ label: key, value: key }));
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
  /* 三期阶段一：后端持久化的自定义产品名。懒初始化直接读模块缓存——
   * A/B/C 三个实例中后挂载的那些可以立即拿到值，不用等 effect 跑完再闪一下。 */
  const [savedProducts, setSavedProducts] = useState<string[]>(
    () => getCachedPrefs()?.custom_products ?? []
  );

  /* 挂载时拉一次偏好（模块级缓存 + 并发去重，三个实例只发一次请求）。
   * 失败时 fetchPrefs 内部已静默降级为空数组，这里不用额外 catch。 */
  useEffect(() => {
    let cancelled = false;
    fetchPrefs().then((prefs) => {
      if (!cancelled) setSavedProducts(prefs.custom_products);
    });
    return () => { cancelled = true; };
  }, []);

  /* 已保存产品里排除掉规则卡本身就有的项（避免同名重复出现两次） */
  const knownValues = new Set(options.map((o) => o.value));
  const extraSavedProducts = savedProducts.filter((p) => !knownValues.has(p));

  /* 删除一条已保存的自定义产品 */
  const handleRemoveSaved = async (name: string) => {
    const list = await removeCustomProduct(name);
    setSavedProducts(list);
  };

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

  /* 点击 chip：选中该产品并退回下拉模式（下拉里已合并了这些已保存项，能正常选中显示） */
  const handlePickSaved = (name: string) => {
    setCustomMode(false);
    onChange(name);
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

        {/* 三期阶段一：已保存的自定义产品 chips —— 点选直接用，× 删除 */}
        {extraSavedProducts.length > 0 && (
          <div className="space-y-1">
            <p className="text-[11px] font-mono text-codex-text-secondary">已保存的自定义产品：</p>
            <div className="flex flex-wrap gap-1.5">
              {extraSavedProducts.map((name) => (
                <span
                  key={name}
                  className="
                    inline-flex items-center gap-1 px-2 py-0.5
                    text-[11px] font-mono rounded
                    bg-codex-bg text-codex-text
                    border border-codex-border
                  "
                >
                  <button
                    onClick={() => handlePickSaved(name)}
                    className="hover:text-codex-accent transition-colors cursor-pointer"
                    title="使用这个产品"
                  >
                    {name}
                  </button>
                  <button
                    onClick={() => handleRemoveSaved(name)}
                    className="text-codex-text-secondary hover:text-codex-danger transition-colors cursor-pointer"
                    title="删除这个已保存的产品"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        <p className="text-[11px] font-mono text-codex-text-secondary">
          💡 AI 识别的产品列表不准确时（比如竞品图实际是相框却没列出来），可以在这里手动填写；
          生成后会自动保存，下次在任何规则卡的下拉框里都能直接选
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
        /* 三期阶段一：已保存的自定义产品，带 ✏️ 前缀与规则卡自带项区分（value 用原始产品名） */
        ...extraSavedProducts.map((p) => ({ label: `✏️ ${p}`, value: p })),
        { label: '✏️ 自定义...', value: CUSTOM_VALUE },
      ]}
      value={value}
      onChange={handleSelectChange}
    />
  );
}

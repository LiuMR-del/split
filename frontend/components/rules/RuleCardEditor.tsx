'use client';

/**
 * 规则卡编辑组件
 * 6 层结构全部可编辑
 * Codex 深色风格
 */

import { useState } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Badge from '@/components/ui/Badge';
import TagSelector from '@/components/rules/TagSelector';
import EditableElementsTable from '@/components/rules/EditableElementsTable';
import EditableList from '@/components/rules/EditableList';
import ReplaceableEditor from '@/components/rules/ReplaceableEditor';
import ProductAdaptationsEditor from '@/components/rules/ProductAdaptationsEditor';

/* ===== 类型定义 ===== */
interface MustHaveElement {
  slot: string;
  description: string;
  position: string;
  visual_weight: string;
}

interface ReplaceableItem {
  original: string;
  alternatives: string[];
}

interface ProductAdaptation {
  canvas_ratio: string;
  adaptation_notes: string;
  simplify: string[];
  enhance: string[];
}

interface RuleCardData {
  rule_id: string;
  rule_name: string;
  reuse_level: string;
  source_images: string[];
  created_date: string;
  last_updated: string;
  layer_0_core: {
    core_selling_point: string;
    selling_point_type: string;
    why_it_sells: string;
    lock_rule: string;
  };
  layer_1_commercial: {
    target_audience: string[];
    use_scenario: string[];
    purchase_motivation: string;
    core_emotion: string[];
    price_sensitivity: string;
  };
  layer_2_visual: {
    layout_formula: string;
    must_have_elements: MustHaveElement[];
    style: string;
    color_mood: string;
    text_hierarchy: string;
  };
  layer_3_variable: {
    replaceable_elements: Record<string, ReplaceableItem>;
    must_not_change: string[];
  };
  layer_4_product: {
    adaptations: Record<string, ProductAdaptation>;
  };
  layer_5_data: {
    source_sales_rank: string;
    proven_platforms: string[];
    seasonal_dependency: string;
    ip_dependency: string;
    reuse_level: string;
    reuse_level_reason: string;
  };
}

/* 受控词表类型 */
interface Vocabularies {
  target_audience: string[];
  use_scenario: string[];
  core_emotion: string[];
  style: string[];
  color_mood: string[];
  selling_point_type: string[];
}

interface RuleCardEditorProps {
  ruleCard: RuleCardData;
  onSave: (data: RuleCardData) => void;
  vocabularies: Vocabularies;
}

/* 可折叠 Section 子组件 */
function Section({
  title,
  icon,
  borderColor = 'border-codex-border',
  warning,
  children,
  defaultOpen = true,
}: {
  title: string;
  icon: string;
  borderColor?: string;
  warning?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={`border ${borderColor} rounded-lg overflow-hidden`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 bg-codex-card hover:bg-codex-border/30 transition-colors cursor-pointer"
      >
        <span className="text-sm font-mono text-codex-text font-medium">
          {icon} {title}
        </span>
        <span className="text-codex-text-secondary text-xs">
          {open ? '▼' : '▶'}
        </span>
      </button>
      {open && (
        <div className="px-4 py-3 bg-codex-bg/50 space-y-4">
          {warning && (
            <div className="px-3 py-2 bg-yellow-900/20 border border-codex-warning/50 rounded-md">
              <p className="text-xs text-codex-warning font-mono">⚠️ {warning}</p>
            </div>
          )}
          {children}
        </div>
      )}
    </div>
  );
}

/* 多行文本输入 */
function TextArea({
  label,
  value,
  onChange,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm text-codex-text-secondary font-mono">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className="
          w-full px-3 py-2 text-sm font-mono
          bg-codex-card text-codex-text
          border border-codex-border rounded-md
          placeholder:text-codex-text-secondary/50
          resize-y
          focus:outline-none focus:border-codex-accent focus:ring-1 focus:ring-codex-accent/30
          transition-colors duration-150
        "
      />
    </div>
  );
}

export default function RuleCardEditor({
  ruleCard,
  onSave,
  vocabularies,
}: RuleCardEditorProps) {
  /* 深拷贝做编辑态 */
  const [data, setData] = useState<RuleCardData>(JSON.parse(JSON.stringify(ruleCard)));
  /* 记录原始数据用于撤销 */
  const [original] = useState<RuleCardData>(JSON.parse(JSON.stringify(ruleCard)));

  /* ===== 更新辅助函数 ===== */

  /* 更新 layer_0 */
  const updateL0 = (field: string, value: string) => {
    setData((prev) => ({
      ...prev,
      layer_0_core: { ...prev.layer_0_core, [field]: value },
    }));
  };

  /* 更新 layer_1 */
  const updateL1 = (field: string, value: unknown) => {
    setData((prev) => ({
      ...prev,
      layer_1_commercial: { ...prev.layer_1_commercial, [field]: value },
    }));
  };

  /* 更新 layer_2 */
  const updateL2 = (field: string, value: unknown) => {
    setData((prev) => ({
      ...prev,
      layer_2_visual: { ...prev.layer_2_visual, [field]: value },
    }));
  };

  /* 更新 layer_3 */
  const updateL3 = (field: string, value: unknown) => {
    setData((prev) => ({
      ...prev,
      layer_3_variable: { ...prev.layer_3_variable, [field]: value },
    }));
  };

  /* 更新 layer_4 */
  const updateL4 = (field: string, value: unknown) => {
    setData((prev) => ({
      ...prev,
      layer_4_product: { ...prev.layer_4_product, [field]: value },
    }));
  };

  /* 更新 layer_5 */
  const updateL5 = (field: string, value: unknown) => {
    setData((prev) => ({
      ...prev,
      layer_5_data: { ...prev.layer_5_data, [field]: value },
    }));
  };

  /* 撤销修改 */
  const handleReset = () => {
    setData(JSON.parse(JSON.stringify(original)));
  };

  /* 保存 */
  const handleSave = () => {
    onSave(data);
  };

  /* 将词表数组转为 Select options 格式 */
  const toSelectOptions = (arr: string[]) => [
    { label: '— 请选择 —', value: '' },
    ...arr.map((v) => ({ label: v, value: v })),
  ];

  return (
    <div className="space-y-4">
      {/* 顶部：规则名称 + 等级 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 flex-1 mr-4">
          <Input
            value={data.rule_name}
            onChange={(e) => setData((prev) => ({ ...prev, rule_name: e.target.value }))}
            className="text-lg font-bold"
          />
        </div>
        <Badge variant={(data.reuse_level as 'S' | 'A' | 'B' | 'C') || 'default'}>
          {data.reuse_level} 级
        </Badge>
      </div>

      {/* ===== 第 0 层：核心卖点锚定 ===== */}
      <Section
        title="核心卖点锚定"
        icon="🔒"
        borderColor="border-orange-500/50"
        warning="修改核心卖点可能影响改款方向的准确性"
      >
        <Input
          label="核心卖点"
          value={data.layer_0_core.core_selling_point}
          onChange={(e) => updateL0('core_selling_point', e.target.value)}
        />
        <Select
          label="卖点类型"
          options={toSelectOptions(vocabularies.selling_point_type)}
          value={data.layer_0_core.selling_point_type}
          onChange={(v) => updateL0('selling_point_type', v)}
        />
        <TextArea
          label="为什么驱动下单"
          value={data.layer_0_core.why_it_sells}
          onChange={(v) => updateL0('why_it_sells', v)}
        />
        <TextArea
          label="锁定规则"
          value={data.layer_0_core.lock_rule}
          onChange={(v) => updateL0('lock_rule', v)}
        />
      </Section>

      {/* ===== 第 1 层：商业层 ===== */}
      <Section title="商业层" icon="💼">
        <TagSelector
          label="目标人群"
          options={vocabularies.target_audience}
          selected={data.layer_1_commercial.target_audience || []}
          onChange={(v) => updateL1('target_audience', v)}
        />
        <TagSelector
          label="使用场景"
          options={vocabularies.use_scenario}
          selected={data.layer_1_commercial.use_scenario || []}
          onChange={(v) => updateL1('use_scenario', v)}
        />
        <TextArea
          label="购买动机"
          value={data.layer_1_commercial.purchase_motivation}
          onChange={(v) => updateL1('purchase_motivation', v)}
        />
        <TagSelector
          label="核心情绪"
          options={vocabularies.core_emotion}
          selected={data.layer_1_commercial.core_emotion || []}
          onChange={(v) => updateL1('core_emotion', v)}
        />
        <Input
          label="价格敏感度"
          value={data.layer_1_commercial.price_sensitivity}
          onChange={(e) => updateL1('price_sensitivity', e.target.value)}
        />
      </Section>

      {/* ===== 第 2 层：视觉结构层 ===== */}
      <Section title="视觉结构层" icon="🎨">
        <Input
          label="构图公式"
          value={data.layer_2_visual.layout_formula}
          onChange={(e) => updateL2('layout_formula', e.target.value)}
        />
        <EditableElementsTable
          elements={data.layer_2_visual.must_have_elements || []}
          onChange={(v) => updateL2('must_have_elements', v)}
        />
        <Select
          label="风格"
          options={toSelectOptions(vocabularies.style)}
          value={data.layer_2_visual.style}
          onChange={(v) => updateL2('style', v)}
        />
        <Select
          label="色彩情绪"
          options={toSelectOptions(vocabularies.color_mood)}
          value={data.layer_2_visual.color_mood}
          onChange={(v) => updateL2('color_mood', v)}
        />
        <Input
          label="文字层级"
          value={data.layer_2_visual.text_hierarchy}
          onChange={(e) => updateL2('text_hierarchy', e.target.value)}
        />
      </Section>

      {/* ===== 第 3 层：可变边界层 ===== */}
      <Section title="可变边界层" icon="🔄">
        <ReplaceableEditor
          elements={data.layer_3_variable.replaceable_elements || {}}
          onChange={(v) => updateL3('replaceable_elements', v)}
        />
        <EditableList
          label="不能换的"
          items={data.layer_3_variable.must_not_change || []}
          onChange={(v) => updateL3('must_not_change', v)}
          icon="🔒"
          placeholder="添加不可替换项..."
        />
      </Section>

      {/* ===== 第 4 层：产品适配层 ===== */}
      <Section title="产品适配层" icon="📐">
        <ProductAdaptationsEditor
          adaptations={data.layer_4_product.adaptations || {}}
          onChange={(v) => updateL4('adaptations', v)}
        />
      </Section>

      {/* ===== 第 5 层：数据验证层 ===== */}
      <Section title="数据验证层" icon="📊">
        <Input
          label="来源排名"
          value={data.layer_5_data.source_sales_rank}
          onChange={(e) => updateL5('source_sales_rank', e.target.value)}
        />
        <EditableList
          label="验证平台"
          items={data.layer_5_data.proven_platforms || []}
          onChange={(v) => updateL5('proven_platforms', v)}
          placeholder="添加平台..."
        />
        <Input
          label="季节依赖"
          value={data.layer_5_data.seasonal_dependency}
          onChange={(e) => updateL5('seasonal_dependency', e.target.value)}
        />
        <Input
          label="IP 依赖"
          value={data.layer_5_data.ip_dependency}
          onChange={(e) => updateL5('ip_dependency', e.target.value)}
        />
        <Select
          label="复用等级"
          options={[
            { label: '— 请选择 —', value: '' },
            { label: 'S 级', value: 'S' },
            { label: 'A 级', value: 'A' },
            { label: 'B 级', value: 'B' },
            { label: 'C 级', value: 'C' },
          ]}
          value={data.layer_5_data.reuse_level}
          onChange={(v) => {
            updateL5('reuse_level', v);
            /* 同步顶层 reuse_level */
            setData((prev) => ({ ...prev, reuse_level: v }));
          }}
        />
        <TextArea
          label="等级理由"
          value={data.layer_5_data.reuse_level_reason}
          onChange={(v) => updateL5('reuse_level_reason', v)}
        />
      </Section>

      {/* ===== 底部按钮 ===== */}
      <div className="flex items-center gap-3 pt-4 border-t border-codex-border">
        <Button onClick={handleSave}>
          💾 保存修改
        </Button>
        <Button variant="secondary" onClick={handleReset}>
          ↩️ 撤销修改
        </Button>
      </div>
    </div>
  );
}

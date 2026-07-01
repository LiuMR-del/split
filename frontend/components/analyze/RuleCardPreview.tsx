'use client';

/**
 * 规则卡预览组件（只读模式）
 * 6 层结构展示，可折叠
 * Codex 深色风格
 */

import { useState } from 'react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';

/* 规则卡类型定义 */
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

interface RuleCardPreviewProps {
  ruleCard: RuleCardData;
  onSave: () => void;
  onDiscard: () => void;
}

/* 可折叠 Section 子组件 */
function Section({
  title,
  icon,
  borderColor = 'border-codex-border',
  children,
  defaultOpen = true,
}: {
  title: string;
  icon: string;
  borderColor?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={`border ${borderColor} rounded-lg overflow-hidden`}>
      <button
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
        <div className="px-4 py-3 bg-codex-bg/50 space-y-3">
          {children}
        </div>
      )}
    </div>
  );
}

/* 字段展示行 */
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-codex-text-secondary font-mono">{label}</span>
      <div className="text-sm text-codex-text font-mono">{value || '—'}</div>
    </div>
  );
}

/* 标签列表 */
function TagList({ items }: { items: string[] }) {
  if (!items || items.length === 0) return <span className="text-codex-text-secondary text-sm">—</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item, i) => (
        <Badge key={i}>{item}</Badge>
      ))}
    </div>
  );
}

export default function RuleCardPreview({ ruleCard, onSave, onDiscard }: RuleCardPreviewProps) {
  /* 安全解构 —— 每层为 undefined/null 时退化为空对象 */
  const layer_0_core = ruleCard?.layer_0_core ?? {} as RuleCardData['layer_0_core'];
  const layer_1_commercial = ruleCard?.layer_1_commercial ?? {} as RuleCardData['layer_1_commercial'];
  const layer_2_visual = ruleCard?.layer_2_visual ?? {} as RuleCardData['layer_2_visual'];
  const layer_3_variable = ruleCard?.layer_3_variable ?? {} as RuleCardData['layer_3_variable'];
  const layer_4_product = ruleCard?.layer_4_product ?? {} as RuleCardData['layer_4_product'];
  const layer_5_data = ruleCard?.layer_5_data ?? {} as RuleCardData['layer_5_data'];

  return (
    <div className="space-y-4">
      {/* 顶部：规则名称 + SABC 等级 */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-mono font-bold text-codex-text">
          {ruleCard?.rule_name || '未命名规则'}
        </h2>
        <Badge variant={(ruleCard?.reuse_level as 'S' | 'A' | 'B' | 'C') || 'default'}>
          {ruleCard?.reuse_level || '?'} 级
        </Badge>
      </div>

      {/* 第 0 层：核心卖点锚定 */}
      <Section title="核心卖点锚定" icon="🔒" borderColor="border-orange-500/50">
        <Field label="核心卖点" value={layer_0_core?.core_selling_point || '未能分析'} />
        <Field label="卖点类型" value={layer_0_core?.selling_point_type || '未能分析'} />
        <Field label="为什么驱动下单" value={
          <p className="whitespace-pre-wrap">{layer_0_core?.why_it_sells || '未能分析'}</p>
        } />
        <Field label="锁定规则" value={
          <p className="whitespace-pre-wrap">{layer_0_core?.lock_rule || '未能分析'}</p>
        } />
      </Section>

      {/* 第 1 层：商业层 */}
      <Section title="商业层" icon="💼">
        <Field label="目标人群" value={<TagList items={layer_1_commercial?.target_audience || []} />} />
        <Field label="使用场景" value={<TagList items={layer_1_commercial?.use_scenario || []} />} />
        <Field label="购买动机" value={
          <p className="whitespace-pre-wrap">{layer_1_commercial?.purchase_motivation || '未能分析'}</p>
        } />
        <Field label="核心情绪" value={<TagList items={layer_1_commercial?.core_emotion || []} />} />
        <Field label="价格敏感度" value={layer_1_commercial?.price_sensitivity || '未能分析'} />
      </Section>

      {/* 第 2 层：视觉结构层 */}
      <Section title="视觉结构层" icon="🎨">
        <Field label="构图公式" value={layer_2_visual?.layout_formula || '未能分析'} />
        {/* 必备元素表格 */}
        <div className="flex flex-col gap-1">
          <span className="text-xs text-codex-text-secondary font-mono">必备元素</span>
          {Array.isArray(layer_2_visual?.must_have_elements) && layer_2_visual.must_have_elements.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono border-collapse">
                <thead>
                  <tr className="border-b border-codex-border">
                    <th className="text-left py-1.5 px-2 text-codex-text-secondary">槽位</th>
                    <th className="text-left py-1.5 px-2 text-codex-text-secondary">描述</th>
                    <th className="text-left py-1.5 px-2 text-codex-text-secondary">位置</th>
                    <th className="text-left py-1.5 px-2 text-codex-text-secondary">权重</th>
                  </tr>
                </thead>
                <tbody>
                  {layer_2_visual.must_have_elements.map((el, i) => (
                    <tr key={i} className="border-b border-codex-border/50">
                      <td className="py-1.5 px-2 text-codex-text">{el?.slot || '—'}</td>
                      <td className="py-1.5 px-2 text-codex-text">{el?.description || '—'}</td>
                      <td className="py-1.5 px-2 text-codex-text">{el?.position || '—'}</td>
                      <td className="py-1.5 px-2 text-codex-text">{el?.visual_weight || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <span className="text-sm text-codex-text-secondary">—</span>
          )}
        </div>
        <Field label="风格" value={layer_2_visual?.style || '未能分析'} />
        <Field label="色彩情绪" value={layer_2_visual?.color_mood || '未能分析'} />
        <Field label="文字层级" value={layer_2_visual?.text_hierarchy || '未能分析'} />
      </Section>

      {/* 第 3 层：可变边界层 */}
      <Section title="可变边界层" icon="🔄">
        {/* 可替换元素 */}
        <div className="flex flex-col gap-1">
          <span className="text-xs text-codex-text-secondary font-mono">可替换元素</span>
          {layer_3_variable?.replaceable_elements && typeof layer_3_variable.replaceable_elements === 'object' && Object.keys(layer_3_variable.replaceable_elements).length > 0 ? (
            <div className="space-y-2">
              {Object.entries(layer_3_variable.replaceable_elements).map(([dim, item]) => (
                <div key={dim} className="flex items-center gap-2 text-sm font-mono">
                  <span className="text-codex-text-secondary min-w-[80px]">{dim}</span>
                  <span className="text-codex-text">{item?.original || '—'}</span>
                  <span className="text-codex-text-secondary">→</span>
                  <div className="flex flex-wrap gap-1">
                    {Array.isArray(item?.alternatives) ? item.alternatives.map((alt, i) => (
                      <Badge key={i}>{alt}</Badge>
                    )) : <span className="text-codex-text-secondary text-xs">—</span>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <span className="text-sm text-codex-text-secondary">—</span>
          )}
        </div>
        {/* 不能换的 */}
        <div className="flex flex-col gap-1">
          <span className="text-xs text-codex-text-secondary font-mono">不能换的</span>
          {Array.isArray(layer_3_variable?.must_not_change) && layer_3_variable.must_not_change.length > 0 ? (
            <ul className="space-y-1">
              {layer_3_variable.must_not_change.map((item, i) => (
                <li key={i} className="text-sm font-mono text-codex-text">
                  🔒 {item}
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-sm text-codex-text-secondary">—</span>
          )}
        </div>
      </Section>

      {/* 第 4 层：产品适配层 */}
      <Section title="产品适配层" icon="📐">
        {layer_4_product?.adaptations && typeof layer_4_product.adaptations === 'object' && Object.keys(layer_4_product.adaptations).length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {Object.entries(layer_4_product.adaptations).map(([name, adapt]) => (
              <div key={name} className="border border-codex-border rounded-md p-3 bg-codex-card">
                <h4 className="text-sm font-mono font-bold text-codex-text mb-2">{name}</h4>
                <div className="space-y-1.5 text-xs font-mono">
                  <p><span className="text-codex-text-secondary">比例：</span>{adapt?.canvas_ratio || '—'}</p>
                  <p><span className="text-codex-text-secondary">适配：</span>{adapt?.adaptation_notes || '—'}</p>
                  {Array.isArray(adapt?.simplify) && adapt.simplify.length > 0 && (
                    <p><span className="text-codex-text-secondary">简化：</span>{adapt.simplify.join('、')}</p>
                  )}
                  {Array.isArray(adapt?.enhance) && adapt.enhance.length > 0 && (
                    <p><span className="text-codex-text-secondary">增强：</span>{adapt.enhance.join('、')}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <span className="text-sm text-codex-text-secondary">—</span>
        )}
      </Section>

      {/* 第 5 层：数据验证层 */}
      <Section title="数据验证层" icon="📊">
        <Field label="来源排名" value={layer_5_data?.source_sales_rank || '未能分析'} />
        <Field label="验证平台" value={<TagList items={layer_5_data?.proven_platforms || []} />} />
        <Field label="季节依赖" value={layer_5_data?.seasonal_dependency || '未能分析'} />
        <Field label="IP 依赖" value={layer_5_data?.ip_dependency || '未能分析'} />
        <Field label="复用等级" value={
          <Badge variant={(layer_5_data?.reuse_level as 'S' | 'A' | 'B' | 'C') || 'default'}>
            {layer_5_data?.reuse_level || '?'} 级
          </Badge>
        } />
        <Field label="等级理由" value={
          <p className="whitespace-pre-wrap">{layer_5_data?.reuse_level_reason || '未能分析'}</p>
        } />
      </Section>

      {/* 底部按钮 */}
      <div className="flex items-center gap-3 pt-4 border-t border-codex-border">
        <Button onClick={onSave}>
          💾 保存到规则库
        </Button>
        <Button variant="ghost" onClick={onDiscard} className="text-codex-danger hover:text-codex-danger hover:bg-red-900/20">
          🗑 放弃
        </Button>
      </div>
    </div>
  );
}

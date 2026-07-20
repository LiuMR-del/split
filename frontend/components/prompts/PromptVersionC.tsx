'use client';

/**
 * 版本 C：自定义模板版
 * 用户可以对可变维度逐个选择选项，然后生成提示词
 */

import { useState, useEffect } from 'react';
import { apiGet, apiPost, unwrapData } from '@/lib/api';
import Button from '@/components/ui/Button';
import Select from '@/components/ui/Select';
import Card from '@/components/ui/Card';
import ProductSelect from '@/components/prompts/ProductSelect';
import PromptDisplay, { PromptResult } from '@/components/prompts/PromptDisplay';
import CollapsibleSection from '@/components/ui/CollapsibleSection';
import { getCustomValuesForRule, addCustomValue } from '@/lib/localStorage';

/* 二期批次一：界面精简开关，改 true 恢复显示 */
const SHOW_INFO_CARDS = false;

interface PromptVersionCProps {
  ruleId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ruleCard: any;
}

/* 模板下拉框结构（后端返回） */
interface TemplateField {
  field_name: string;
  label: string;
  options: Array<{ label: string; value: string; is_original?: boolean }>;
}

interface LockedField {
  label: string;
  value: string;
}

interface TemplateData {
  locked_fields: LockedField[];
  selectable_fields: TemplateField[];
  product_options: Array<{ label: string; value: string }>;
}

/* R5：把本地存储的历史自定义值合并进模板的各维度 options。
 * 历史值带 ✏️ 前缀，与原始选项去重后追加。这样下次打开同规则卡，自定义过的值
 * 直接出现在下拉框可点选，不用重新打字。
 * createdDate 用于校验归属（rule_id 可能被复用，用 created_date 区分新旧规则卡）。 */
function mergeCustomOptions(template: TemplateData, ruleId: string, createdDate: string): TemplateData {
  const customs = getCustomValuesForRule(ruleId, createdDate);
  return {
    ...template,
    selectable_fields: template.selectable_fields.map((field) => {
      const existingValues = new Set(field.options.map((o) => o.value));
      const customOpts = (customs[field.field_name] || [])
        .filter((v) => v && !existingValues.has(v))
        .map((v) => ({ label: `✏️ ${v}`, value: v, is_original: false }));
      return { ...field, options: [...field.options, ...customOpts] };
    }),
  };
}

export default function PromptVersionC({ ruleId, ruleCard }: PromptVersionCProps) {
  /* 模板结构数据 */
  const [template, setTemplate] = useState<TemplateData | null>(null);
  /* 各维度的选中值 */
  const [selections, setSelections] = useState<Record<string, string>>({});
  /* 自定义输入模式：记录哪些维度处于文本输入模式 */
  const [customMode, setCustomMode] = useState<Record<string, boolean>>({});
  /* 目标产品 */
  const [targetProduct, setTargetProduct] = useState('');
  /* 加载模板中 */
  const [loadingTemplate, setLoadingTemplate] = useState(true);
  /* 生成中 */
  const [generating, setGenerating] = useState(false);
  /* 错误信息 */
  const [error, setError] = useState('');
  /* 模板加载错误 */
  const [templateError, setTemplateError] = useState('');
  /* 生成结果 */
  const [result, setResult] = useState<PromptResult | null>(null);
  /* 配置区折叠状态：默认展开，生成成功后自动收起；点击标题栏可重新展开调整
   * （交互与"中文结构化提示词"一致：点标题栏切换，箭头旋转） */
  const [configExpanded, setConfigExpanded] = useState(true);

  /* 加载模板结构 */
  useEffect(() => {
    async function loadTemplate() {
      setLoadingTemplate(true);
      setTemplateError('');
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await apiGet<any>(`/api/prompts/template-c/${ruleId}`);
        // 后端返回 {"success": true, "data": {...}}
        const tmpl: TemplateData = unwrapData(res);
        // R5：合并本地存储的历史自定义值到各维度 options，下次打开可直接点选。
        // 传 created_date 校验归属，防 rule_id 复用导致旧规则卡的自定义值污染新卡
        setTemplate(mergeCustomOptions(tmpl, ruleId, ruleCard?.created_date || ''));

        /* 初始化各维度的默认选中值（选original） */
        const defaultSelections: Record<string, string> = {};
        if (tmpl.selectable_fields) {
          tmpl.selectable_fields.forEach((field) => {
            const orig = field.options.find(o => o.is_original);
            defaultSelections[field.field_name] = orig ? orig.value : (field.options[0]?.value || '');
          });
        }
        setSelections(defaultSelections);
        /* 默认选第一个产品 */
        if (tmpl.product_options && tmpl.product_options.length > 0 && !targetProduct) {
          setTargetProduct(tmpl.product_options[0].value);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : '加载模板失败';
        setTemplateError(msg);
      } finally {
        setLoadingTemplate(false);
      }
    }
    loadTemplate();
  }, [ruleId]);

  /* 更新某个维度的选中值 */
  const updateSelection = (dimension: string, value: string) => {
    /* 选中"自定义..."时，切换到文本输入模式 */
    if (value === '__custom__') {
      setCustomMode((prev) => ({ ...prev, [dimension]: true }));
      setSelections((prev) => ({ ...prev, [dimension]: '' }));
      return;
    }
    setSelections((prev) => ({ ...prev, [dimension]: value }));
  };

  /* 恢复下拉模式：关闭自定义输入，恢复原始值 */
  const restoreSelect = (dimension: string) => {
    setCustomMode((prev) => ({ ...prev, [dimension]: false }));
    /* 恢复为该维度的原始值 */
    if (template?.selectable_fields) {
      const field = template.selectable_fields.find((f) => f.field_name === dimension);
      const orig = field?.options.find((o) => o.is_original);
      setSelections((prev) => ({
        ...prev,
        [dimension]: orig ? orig.value : (field?.options[0]?.value || ''),
      }));
    }
  };

  /* 调用生成接口 */
  const handleGenerate = async () => {
    if (!targetProduct) {
      setError('请先选择目标产品');
      return;
    }

    setGenerating(true);
    setError('');
    setResult(null);

    // R5：把本次输入的自定义值（不在已知 options 里的）落盘到本地，下次可复用
    const createdDate = ruleCard?.created_date || '';
    if (template) {
      template.selectable_fields.forEach((field) => {
        const val = selections[field.field_name];
        if (!val || val.trim() === '__custom__') return;
        const knownValues = new Set(field.options.map((o) => o.value));
        if (!knownValues.has(val)) {
          addCustomValue(ruleId, createdDate, field.field_name, val);
        }
      });
      // 落盘后重合并 template，让"恢复下拉"即时看到刚输入的值，不用刷新页面
      setTemplate((prev) => (prev ? mergeCustomOptions(prev, ruleId, createdDate) : prev));
    }

    try {
      // #14：剔除空值和哨兵 __custom__，避免发 {"field_name": ""} 给后端导致该维度被误判为"已替换"（丢元素+进负向）
      // 前端为根因修复，后端 changes.get(field) or original 为兜底，双保险
      const cleanSelections = Object.fromEntries(
        Object.entries(selections).filter(
          ([, v]) => v && v.trim() && v.trim() !== '__custom__'
        )
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await apiPost<any>('/api/prompts/generate-c', {
        rule_id: ruleId,
        selections: cleanSelections,
        target_product: targetProduct,
      });
      // 后端返回 {"success": true, "data": {...}}
      setResult(unwrapData(res));
      /* 生成成功后配置区自动收起，聚焦到下方生图提示词 */
      setConfigExpanded(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '生成失败';
      setError(msg);
    } finally {
      setGenerating(false);
    }
  };

  /* 模板加载中骨架屏 */
  if (loadingTemplate) {
    return (
      <div className="animate-pulse space-y-3">
        <div className="h-20 bg-codex-border/30 rounded-lg" />
        <div className="h-10 bg-codex-border/30 rounded w-2/3" />
        <div className="h-10 bg-codex-border/30 rounded w-2/3" />
        <div className="h-10 bg-codex-border/30 rounded w-1/2" />
      </div>
    );
  }

  /* 模板加载失败 */
  if (templateError) {
    return (
      <div className="px-4 py-3 bg-red-900/20 border border-codex-danger rounded-md">
        <p className="text-sm font-mono text-codex-danger">
          ❌ 加载模板失败：{templateError}
        </p>
      </div>
    );
  }

  if (!template) return null;

  return (
    <div className="space-y-3">
      {/* 🔒 锁定字段区域 */}
      {SHOW_INFO_CARDS && (
      <Card className="bg-codex-bg border-l-4 border-l-orange-500">
        <h3 className="text-xs font-mono font-bold text-orange-400 mb-2">
          🔒 锁定字段（不可编辑）
        </h3>
        <div className="space-y-1.5 text-xs font-mono">
          {template.locked_fields.map((field, i) => (
            <div key={i} className="flex gap-2">
              <span className="text-codex-text-secondary min-w-[5rem] shrink-0">{field.label}：</span>
              <span className="text-codex-text break-words min-w-0">{field.value}</span>
            </div>
          ))}
        </div>
      </Card>
      )}

      {/* 配置区：可变维度下拉框 + 目标产品 + 生成按钮。折叠交互与"中文结构化提示词"一致
          （点标题栏展开/收起）；生成成功后自动收起，点击标题栏可重新展开调整并重新生成。 */}
      <CollapsibleSection
        title="🔧 可变维度（选择变体）"
        expanded={configExpanded}
        onExpandedChange={setConfigExpanded}
      >
        {/* 窄栏适配：单列排列所有下拉框 */}
        <div className="grid grid-cols-1 gap-2">
          {template.selectable_fields.map((field) => (
            <div key={field.field_name} className="flex flex-col gap-1.5">
              {/* 维度标签 */}
              <label className="text-sm text-codex-text-secondary font-mono">
                {field.label}
              </label>

              {customMode[field.field_name] ? (
                /* 自定义输入模式：文本框 + 恢复按钮 */
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={selections[field.field_name] || ''}
                    onChange={(e) =>
                      setSelections((prev) => ({
                        ...prev,
                        [field.field_name]: e.target.value,
                      }))
                    }
                    placeholder={`输入自定义${field.label}...`}
                    className="
                      flex-1 px-3 py-2 text-sm font-mono
                      bg-codex-card text-codex-text
                      border border-codex-accent rounded-md
                      placeholder:text-codex-text-secondary/50
                      focus:outline-none focus:ring-1 focus:ring-codex-accent/30
                    "
                  />
                  <button
                    onClick={() => restoreSelect(field.field_name)}
                    className="
                      px-2 py-1 text-xs font-mono rounded-md
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
              ) : (
                /* 普通下拉模式：末尾加"自定义..."选项 */
                <Select
                  options={[
                    ...field.options,
                    { label: '✏️ 自定义...', value: '__custom__' },
                  ]}
                  value={selections[field.field_name] || ''}
                  onChange={(val) => updateSelection(field.field_name, val)}
                />
              )}
            </div>
          ))}
        </div>

        {/* 目标产品 + 生成按钮 —— 窄栏内垂直排列 */}
        <div className="flex flex-col gap-2 pt-2 mt-2 border-t border-codex-border">
          <div className="flex-1 w-full">
            <ProductSelect
              options={template.product_options || []}
              value={targetProduct}
              onChange={setTargetProduct}
            />
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={handleGenerate}
            loading={generating}
            disabled={!targetProduct}
            className="w-full"
          >
            📝 生成提示词
          </Button>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="px-4 py-2 mt-2 bg-red-900/20 border border-codex-danger rounded-md">
            <p className="text-sm font-mono text-codex-danger">❌ {error}</p>
          </div>
        )}

        {/* 生成中动画 */}
        {generating && (
          <div className="flex items-center justify-center py-12">
            <div className="flex flex-col items-center gap-3">
              <span className="inline-block w-8 h-8 border-3 border-codex-accent border-t-transparent rounded-full animate-spin" />
              <p className="text-sm font-mono text-codex-text-secondary">
                正在根据自定义模板生成提示词...
              </p>
            </div>
          </div>
        )}
      </CollapsibleSection>

      {/* 生成结果展示 */}
      {result && (
        <PromptDisplay
          result={result}
          ruleId={ruleId}
          ruleName={ruleCard?.rule_name}
          version="C"
        />
      )}
    </div>
  );
}

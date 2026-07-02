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
import PromptDisplay, { PromptResult } from '@/components/prompts/PromptDisplay';

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
        setTemplate(tmpl);

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

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await apiPost<any>('/api/prompts/generate-c', {
        rule_id: ruleId,
        selections,
        target_product: targetProduct,
      });
      // 后端返回 {"success": true, "data": {...}}
      setResult(unwrapData(res));
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

      {/* 可变维度下拉框区域 */}
      <div className="space-y-2">
        <h3 className="text-sm font-mono font-bold text-codex-text">
          🔧 可变维度（选择变体）
        </h3>
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
      </div>

      {/* 目标产品 + 生成按钮 —— 窄栏内垂直排列 */}
      <div className="flex flex-col gap-2 pt-2 border-t border-codex-border">
        <div className="flex-1 w-full">
          <Select
            label="🎯 目标产品"
            options={[
              { label: '— 请选择目标产品 —', value: '' },
              ...(template.product_options || []),
            ]}
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
        <div className="px-4 py-2 bg-red-900/20 border border-codex-danger rounded-md">
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

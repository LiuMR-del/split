'use client';

/**
 * 版本 B：AI 推荐改款方向
 * 用户选择目标产品后，AI 自动推荐改款方向并生成提示词
 */

import { useState } from 'react';
import { apiPost, unwrapData } from '@/lib/api';
import Button from '@/components/ui/Button';
import Select from '@/components/ui/Select';
import PromptDisplay, { PromptResult } from '@/components/prompts/PromptDisplay';

interface PromptVersionBProps {
  ruleId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ruleCard: any;
}

export default function PromptVersionB({ ruleId, ruleCard }: PromptVersionBProps) {
  /* 目标产品选中值 */
  const [targetProduct, setTargetProduct] = useState('');
  /* 加载中 */
  const [loading, setLoading] = useState(false);
  /* 错误信息 */
  const [error, setError] = useState('');
  /* 生成结果 */
  const [result, setResult] = useState<PromptResult | null>(null);

  /* 从规则卡的 layer_4_product.adaptations 获取产品选项 */
  const getProductOptions = () => {
    const adaptations = ruleCard?.layer_4_product?.adaptations;
    if (!adaptations || typeof adaptations !== 'object') {
      /* 如果没有产品适配数据，给一组默认产品 */
      return [
        { label: 'Blanket 毛毯', value: 'Blanket 毛毯' },
        { label: 'T-Shirt T恤', value: 'T-Shirt T恤' },
        { label: 'Mug 马克杯', value: 'Mug 马克杯' },
        { label: 'Poster 海报', value: 'Poster 海报' },
      ];
    }
    return Object.keys(adaptations).map((key) => ({
      label: key,
      value: key,
    }));
  };

  const productOptions = getProductOptions();

  /* 调用 AI 推荐接口 */
  const handleGenerate = async () => {
    if (!targetProduct) {
      setError('请先选择目标产品');
      return;
    }

    setLoading(true);
    setError('');
    setResult(null);

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await apiPost<any>('/api/prompts/generate-b', {
        rule_id: ruleId,
        target_product: targetProduct,
      });
      // 后端返回 {"success": true, "data": {...}}
      setResult(unwrapData(res));
    } catch (err) {
      const msg = err instanceof Error ? err.message : '生成失败';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* 操作区域 —— 窄栏内垂直排列 */}
      <div className="flex flex-col gap-2">
        {/* 目标产品选择 */}
        <div className="flex-1 w-full">
          <Select
            label="🎯 目标产品"
            options={[
              { label: '— 请选择目标产品 —', value: '' },
              ...productOptions,
            ]}
            value={targetProduct}
            onChange={setTargetProduct}
          />
        </div>

        {/* 生成按钮 */}
        <Button
          variant="primary"
          size="sm"
          onClick={handleGenerate}
          loading={loading}
          disabled={!targetProduct}
          className="w-full"
        >
          🤖 AI 推荐改款方向
        </Button>
      </div>

      {/* 产品选项为空时的提示 */}
      {productOptions.length === 0 && (
        <p className="text-sm font-mono text-codex-warning">
          ⚠️ 当前规则卡没有产品适配数据（layer_4_product.adaptations），请先在编辑页面添加产品适配信息。
        </p>
      )}

      {/* 错误提示 */}
      {error && (
        <div className="px-4 py-2 bg-red-900/20 border border-codex-danger rounded-md">
          <p className="text-sm font-mono text-codex-danger">❌ {error}</p>
        </div>
      )}

      {/* 加载中动画 */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="flex flex-col items-center gap-3">
            <span className="inline-block w-8 h-8 border-3 border-codex-accent border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-mono text-codex-text-secondary">
              AI 正在分析规则并推荐改款方向...
            </p>
          </div>
        </div>
      )}

      {/* 生成结果展示 */}
      {result && <PromptDisplay result={result} ruleId={ruleId} />}
    </div>
  );
}

'use client';

/**
 * 版本 B：AI 推荐改款方向
 * 用户选择目标产品后，AI 自动推荐改款方向并生成提示词
 *
 * 三期阶段三：支持"推荐方案数"1~4。选 1 时链路与改造前 100% 一致（单 result →
 * 单 PromptDisplay）；选 >1 时后端返回 {directions:[...]}，渲染方案卡片列表 +
 * 当前方案仍用**同一个 PromptDisplay** 完整展示（决策点 3：展现形式不变，
 * 不破坏 A/B/C 三栏布局）。
 *
 * 2026-08-17 用户反馈：批量生成原本是独立一栏、与生图区各有一套尺寸控件，
 * 现已合并进 PromptDisplay 的「生成图片」区（batchMode prop → 区内两个 tab），
 * 本组件只负责把 directions + 勾选状态透传下去。
 */

import { useState } from 'react';
import { apiPost, unwrapData } from '@/lib/api';
import Button from '@/components/ui/Button';
import ProductSelect, { getProductOptionsFromRuleCard } from '@/components/prompts/ProductSelect';
import PromptDisplay, { PromptResult } from '@/components/prompts/PromptDisplay';
import CollapsibleSection from '@/components/ui/CollapsibleSection';
import { addCustomProductIfNew } from '@/lib/userPrefs';

interface PromptVersionBProps {
  ruleId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ruleCard: any;
}

/* 可选的推荐方案数。上限 4 已实测无 JSON 截断（§5.2.4，2026-08-17，N=4 耗时约 28s） */
const DIRECTION_COUNT_OPTIONS = [1, 2, 3, 4];

export default function PromptVersionB({ ruleId, ruleCard }: PromptVersionBProps) {
  /* 目标产品选中值 */
  const [targetProduct, setTargetProduct] = useState('');
  /* 三期阶段三：推荐方案数，默认 3 */
  const [numDirections, setNumDirections] = useState(3);
  /* 加载中 */
  const [loading, setLoading] = useState(false);
  /* 错误信息 */
  const [error, setError] = useState('');
  /* 生成结果——单套模式（num_directions=1，与改造前完全一致的渲染路径） */
  const [result, setResult] = useState<PromptResult | null>(null);
  /* 三期阶段三：多方案模式的结果 */
  const [directions, setDirections] = useState<PromptResult[] | null>(null);
  /* 当前查看的方案索引 */
  const [activeIdx, setActiveIdx] = useState(0);
  /* 批量生成勾选的方案索引（独立于"当前查看"） */
  const [checkedIdx, setCheckedIdx] = useState<Set<number>>(new Set());
  /* 配置区折叠状态：默认展开，生成成功后自动收起；点击标题栏可重新展开调整
   * （交互与"中文结构化提示词"一致：点标题栏切换，箭头旋转） */
  const [configExpanded, setConfigExpanded] = useState(true);

  /* 从规则卡的 layer_4_product.adaptations 获取产品选项 */
  const productOptions = getProductOptionsFromRuleCard(ruleCard);

  const hasRuleImage = Boolean(ruleCard?.source_images?.length);

  /* 调用 AI 推荐接口 */
  const handleGenerate = async () => {
    if (!targetProduct) {
      setError('请先选择目标产品');
      return;
    }

    /* 三期阶段一：手填的自定义产品名落后端持久化，下次任何规则卡都能直接选。
     * fire-and-forget，不 await——保存偏好不能拖慢生成流程，失败也只是"这次没记住"。 */
    addCustomProductIfNew(targetProduct, productOptions.map((o) => o.value));

    setLoading(true);
    setError('');
    setResult(null);
    setDirections(null);

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await apiPost<any>('/api/prompts/generate-b', {
        rule_id: ruleId,
        target_product: targetProduct,
        num_directions: numDirections,
      });
      // 后端返回 {"success": true, "data": {...}}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = unwrapData<any>(res);
      /* 三期阶段三：按响应形状分流——多方案返回 {directions:[...]}，
       * 单套（num_directions=1）仍是旧的扁平结果 dict，走与改造前一致的渲染 */
      if (Array.isArray(data?.directions)) {
        const list = data.directions as PromptResult[];
        setDirections(list);
        setActiveIdx(0);
        /* 默认全勾选（批量生成的常见意图就是"这几套都出一张看看"） */
        setCheckedIdx(new Set(list.map((_, i) => i)));
      } else {
        setResult(data);
      }
      /* 生成成功后配置区自动收起，聚焦到下方生图提示词 */
      setConfigExpanded(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '生成失败';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  /* 勾选/取消某套方案（批量生成用） */
  const toggleChecked = (idx: number) => {
    setCheckedIdx((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  return (
    <div className="space-y-3">
      {/* 配置区：目标产品下拉 + 方案数 + 生成按钮。折叠交互与"中文结构化提示词"一致
          （点标题栏展开/收起）；生成成功后自动收起，点击标题栏可重新展开调整并重新生成。 */}
      <CollapsibleSection
        title="🔧 目标产品"
        expanded={configExpanded}
        onExpandedChange={setConfigExpanded}
      >
        {/* 操作区域 —— 窄栏内垂直排列 */}
        <div className="flex flex-col gap-2">
          {/* 目标产品选择 */}
          <div className="flex-1 w-full">
            <ProductSelect
              options={productOptions}
              value={targetProduct}
              onChange={setTargetProduct}
            />
          </div>

          {/* 三期阶段三：推荐方案数按钮组（样式复用生图区的数量按钮组） */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-codex-text-secondary font-mono">
              🎲 推荐方案数
            </label>
            <div className="flex gap-2">
              {DIRECTION_COUNT_OPTIONS.map((n) => (
                <button
                  key={n}
                  onClick={() => setNumDirections(n)}
                  className={`
                    px-3 py-1.5 text-sm font-mono rounded-md
                    transition-colors duration-150 cursor-pointer
                    ${numDirections === n
                      ? 'bg-codex-accent text-white'
                      : 'bg-codex-bg text-codex-text-secondary border border-codex-border hover:border-codex-accent hover:text-codex-text'
                    }
                  `}
                >
                  {n}
                </button>
              ))}
            </div>
            <p className="text-[11px] font-mono text-codex-text-secondary">
              💡 AI 一次给出多套彼此差异化的改款方案，可逐套查看/挑选生图；方案越多 AI 耗时越长
            </p>
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
                {numDirections > 1
                  ? `AI 正在分析规则并推荐 ${numDirections} 套差异化方案...`
                  : 'AI 正在分析规则并推荐改款方向...'}
              </p>
            </div>
          </div>
        )}
      </CollapsibleSection>

      {/* ── 单套模式：与改造前完全一致的渲染 ── */}
      {result && (
        <PromptDisplay
          result={result}
          ruleId={ruleId}
          ruleName={ruleCard?.rule_name}
          version="B"
          hasRuleImage={hasRuleImage}
          ruleImageUrl={ruleCard?.thumbnail_path || ''}
        />
      )}

      {/* ── 三期阶段三：多方案模式 ── */}
      {directions && directions.length > 0 && (
        <>
          {/* 方案卡片列表（窄栏内垂直堆叠） */}
          <div className="space-y-2">
            {directions.map((d, idx) => {
              const isActive = idx === activeIdx;
              const changes = d.recommended_changes_detail || [];
              const shown = changes.slice(0, 3);
              return (
                <div
                  key={idx}
                  onClick={() => setActiveIdx(idx)}
                  className={`
                    p-3 rounded-lg border cursor-pointer
                    transition-colors duration-150
                    ${isActive
                      ? 'bg-codex-card border-codex-accent ring-1 ring-codex-accent/40'
                      : 'bg-codex-card/50 border-codex-border hover:border-codex-accent/50'
                    }
                  `}
                >
                  <div className="flex items-start gap-2">
                    {/* 批量生成勾选（独立于"当前查看"，点它不切换方案） */}
                    <input
                      type="checkbox"
                      checked={checkedIdx.has(idx)}
                      onChange={() => toggleChecked(idx)}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-0.5 cursor-pointer accent-codex-accent shrink-0"
                      title="勾选后可批量生成"
                    />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-mono font-bold ${isActive ? 'text-codex-accent' : 'text-codex-text'}`}>
                          方案 {idx + 1}
                        </span>
                        {isActive && (
                          <span className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-codex-accent/20 text-codex-accent border border-codex-accent/40">
                            正在查看
                          </span>
                        )}
                      </div>
                      {/* 推荐理由摘要 */}
                      {d.reason && (
                        <p
                          className="text-xs font-mono text-codex-text-secondary line-clamp-2"
                          title={d.reason}
                        >
                          {d.reason}
                        </p>
                      )}
                      {/* 改动概览（前 3 条） */}
                      {shown.length > 0 && (
                        <div className="space-y-0.5">
                          {shown.map((c, ci) => (
                            <p key={ci} className="text-[11px] font-mono text-codex-text truncate">
                              <span className="text-codex-text-secondary">{c.dimension}：</span>
                              {c.original && (
                                <span className="text-codex-text-secondary line-through">{c.original}</span>
                              )}
                              {c.original && <span className="text-codex-text-secondary mx-1">→</span>}
                              <span className="text-codex-success">{c.changed_to}</span>
                            </p>
                          ))}
                          {changes.length > shown.length && (
                            <p className="text-[11px] font-mono text-codex-text-secondary">
                              等 {changes.length} 处改动
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            <p className="text-[11px] font-mono text-codex-text-secondary">
              💡 点卡片切换查看，勾选框用于批量生成。切换方案会重置该方案下的手动编辑
            </p>
          </div>

          {/* 当前方案的完整展示——决策点 3 的落点：仍走同一个 PromptDisplay，
              展现形式与单套模式完全相同（中文结构化提示词/生图提示词/可定制项/生图区）。
              key={activeIdx} 强制重挂载：切换方案时 PromptDisplay 内部的 editable*、
              勾选状态、生图状态全部重置为该方案的初始值，不会串味。
              batchMode：把全部方案+勾选状态透传下去，「生成图片」区内会多一个
              「🚀 批量多方案」tab，与「单张精修」共用尺寸/附带原图设置
              （2026-08-17 用户反馈：原来批量是独立一栏，两套尺寸控件重复且割裂）。 */}
          <PromptDisplay
            key={activeIdx}
            result={directions[activeIdx]}
            ruleId={ruleId}
            ruleName={ruleCard?.rule_name}
            version="B"
            hasRuleImage={hasRuleImage}
            ruleImageUrl={ruleCard?.thumbnail_path || ''}
            batchMode={{ directions, checkedIdx }}
          />
        </>
      )}
    </div>
  );
}

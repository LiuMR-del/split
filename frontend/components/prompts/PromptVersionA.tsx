'use client';

/**
 * 版本 A：资料库关联版
 * 以核心卖点为锚点，从图库找相关参考图，用户选图后后端结构化生成提示词。
 *
 * 两种状态：
 *   状态 1 — 图库有数据 → 推荐图网格 → 勾选 → 选产品 → 生成
 *   状态 2 — 图库无数据 → 引导建库界面（不降级到版本 B）
 *
 * Codex 深色风格 · 适配窄栏宽度（三栏并排的一栏）
 */

import { useState, useEffect } from 'react';
import { apiPost, getImageUrl, unwrapData } from '@/lib/api';
import Button from '@/components/ui/Button';
import Select from '@/components/ui/Select';
import Card from '@/components/ui/Card';
import PromptDisplay, { PromptResult } from '@/components/prompts/PromptDisplay';
import Link from 'next/link';

/* ── 推荐图片条目类型 ── */
interface RecommendedImage {
  image_id: string;
  filename?: string;
  thumbnail_path?: string;
  /** 综合匹配分数 */
  score?: number;
  /** 各维度得分 */
  dimension_scores?: {
    style?: number;
    color?: number;
    composition?: number;
    theme?: number;
    mood?: number;
  };
  /** 核心卖点是否匹配 */
  core_matched?: boolean;
  /** 匹配原因（一行文字） */
  match_reason?: string;
}

/* ── 维度配置（用于渲染分数条） ── */
const DIMENSION_CONFIG = [
  { key: 'style',       label: '风格', weight: 0.35 },
  { key: 'color',       label: '色彩', weight: 0.20 },
  { key: 'composition', label: '构图', weight: 0.20 },
  { key: 'theme',       label: '主题', weight: 0.15 },
  { key: 'mood',        label: '情绪', weight: 0.10 },
] as const;

/* ── 组件 Props ── */
interface PromptVersionAProps {
  ruleId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ruleCard: any;
}

/* ── 最多选中张数 ── */
const MAX_SELECT = 5;

export default function PromptVersionA({ ruleId, ruleCard }: PromptVersionAProps) {
  /* 推荐图片列表 */
  const [images, setImages] = useState<RecommendedImage[]>([]);
  const [loadingImages, setLoadingImages] = useState(true);
  const [imageError, setImageError] = useState('');

  /* 选中的图片 ID 集合 */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  /* 展开详情的图片 ID 集合 */
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  /* 目标产品 */
  const [targetProduct, setTargetProduct] = useState('');

  /* 生成状态 */
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<PromptResult | null>(null);

  /* ── 提取核心卖点文字 ── */
  const coreSellingPoint: string =
    ruleCard?.layer_0_core?.core_selling_point ||
    ruleCard?.layer_0_core?.selling_point ||
    '';

  /* ── 页面加载时获取推荐图片 ── */
  useEffect(() => {
    async function fetchRecommendations() {
      setLoadingImages(true);
      setImageError('');
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await apiPost<any>('/api/library/recommend', {
          rule_id: ruleId,
        });
        /* 后端返回 {success, data: {recommendations: [...]}} */
        const data = unwrapData<any>(res);
        const list = Array.isArray(data)
          ? data
          : Array.isArray(data?.recommendations)
            ? data.recommendations
            : Array.isArray(data?.images)
              ? data.images
              : [];
        setImages(list);
      } catch {
        setImageError('加载推荐图片失败，请检查后端服务是否正常');
      } finally {
        setLoadingImages(false);
      }
    }
    if (ruleId) {
      fetchRecommendations();
    }
  }, [ruleId]);

  /* ── 从 ruleCard 获取产品选项（同版本 B 逻辑） ── */
  const getProductOptions = () => {
    const adaptations = ruleCard?.layer_4_product?.adaptations;
    if (!adaptations || typeof adaptations !== 'object') {
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

  /* ── 切换图片选中 ── */
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < MAX_SELECT) {
        next.add(id);
      }
      return next;
    });
  };

  /* ── 切换维度详情展开 ── */
  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  /* ── 基于参考图生成提示词 ── */
  const handleGenerate = async () => {
    if (selectedIds.size === 0) {
      setError('请至少选择一张参考图');
      return;
    }
    if (!targetProduct) {
      setError('请选择目标产品');
      return;
    }

    setLoading(true);
    setError('');
    setResult(null);

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await apiPost<any>('/api/prompts/generate-a', {
        rule_id: ruleId,
        target_product: targetProduct,
        reference_image_ids: Array.from(selectedIds),
      });
      setResult(unwrapData(res));
    } catch (err) {
      const msg = err instanceof Error ? err.message : '生成失败';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  /* ========== 状态 2：图库无数据 → 引导建库界面 ========== */
  if (!loadingImages && images.length === 0 && !imageError) {
    return (
      <Card className="border-l-4 border-l-orange-500 bg-codex-card">
        <div className="flex flex-col items-center text-center py-6 space-y-4">
          <span className="text-3xl">&#128218;</span>
          <h3 className="text-sm font-mono font-bold text-codex-text">
            资料库为空
          </h3>
          <div className="space-y-2 text-xs font-mono text-codex-text-secondary leading-relaxed max-w-[260px]">
            <p>
              版本 A 需要你的自有图库作为参考基础。
              上传产品图后，系统会基于你的图库风格推荐最匹配的参考方向。
            </p>
          </div>
          <Link href="/library">
            <Button variant="primary" size="sm">
              &#128218; 前往上传图片
            </Button>
          </Link>
          <p className="text-[11px] font-mono text-codex-text-secondary">
            &#128161; 你可以先用右侧的「AI 推荐」或「自定义模板」生成提示词。
          </p>
        </div>
      </Card>
    );
  }

  /* ========== 状态 1：图库有数据 → 正常流程 ========== */
  return (
    <div className="space-y-3">
      {/* ── 核心卖点锚点卡片 ── */}
      {coreSellingPoint && (
        <Card className="border-l-4 border-l-orange-500 bg-codex-card">
          <h4 className="text-xs font-mono font-bold text-orange-400 mb-1">
            &#128204; 核心卖点
          </h4>
          <p className="text-sm font-mono text-codex-text leading-snug break-words">
            {coreSellingPoint}
          </p>
          <p className="text-[10px] font-mono text-codex-text-secondary mt-1.5">
            以此为中心在图库中搜索相关参考图
          </p>
        </Card>
      )}

      {/* ── 加载中 ── */}
      {loadingImages && (
        <div className="flex items-center justify-center py-8">
          <div className="flex flex-col items-center gap-3">
            <span className="inline-block w-6 h-6 border-2 border-codex-accent border-t-transparent rounded-full animate-spin" />
            <p className="text-xs font-mono text-codex-text-secondary">
              正在从图库检索匹配图片...
            </p>
          </div>
        </div>
      )}

      {/* ── 加载失败 ── */}
      {imageError && (
        <div className="px-4 py-2 bg-red-900/20 border border-codex-danger rounded-md">
          <p className="text-sm font-mono text-codex-danger">&#10060; {imageError}</p>
        </div>
      )}

      {/* ── 推荐参考图网格 ── */}
      {!loadingImages && images.length > 0 && (
        <>
          <h3 className="text-sm font-mono font-bold text-codex-text">
            &#128247; 推荐参考图（基于核心卖点匹配）
            <span className="text-codex-text-secondary font-normal ml-2">
              共找到 {images.length} 张
            </span>
          </h3>

          {/* 网格 —— 窄栏两列 */}
          <div className="grid grid-cols-2 gap-3">
            {images.map((img) => {
              const thumbUrl = img.thumbnail_path
                ? getImageUrl(img.thumbnail_path)
                : null;
              const isSelected = selectedIds.has(img.image_id);
              const isDisabled = !isSelected && selectedIds.size >= MAX_SELECT;
              const isExpanded = expandedIds.has(img.image_id);
              const hasDimensions = !!img.dimension_scores;

              return (
                <div
                  key={img.image_id}
                  className={`
                    relative bg-codex-bg border rounded-md overflow-hidden
                    transition-all duration-200
                    ${isSelected
                      ? 'border-codex-accent shadow-md shadow-codex-accent/20 ring-1 ring-codex-accent/40'
                      : isDisabled
                        ? 'border-codex-border opacity-50 cursor-not-allowed'
                        : 'border-codex-border hover:border-codex-accent/50 cursor-pointer'
                    }
                  `}
                  onClick={() => {
                    if (!isDisabled) toggleSelect(img.image_id);
                  }}
                >
                  {/* 勾选框 */}
                  <div
                    className={`
                      absolute top-1.5 left-1.5 z-10
                      w-5 h-5 rounded border-2 flex items-center justify-center
                      transition-colors duration-150
                      ${isSelected
                        ? 'bg-codex-accent border-codex-accent'
                        : 'bg-codex-bg/70 border-codex-text-secondary/50'
                      }
                    `}
                  >
                    {isSelected && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>

                  {/* 缩略图 */}
                  <div className="w-full h-28 bg-codex-bg flex items-center justify-center overflow-hidden">
                    {thumbUrl ? (
                      <img
                        src={thumbUrl}
                        alt={img.filename || img.image_id}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-2xl text-codex-text-secondary">&#128247;</span>
                    )}
                  </div>

                  {/* 底部信息 */}
                  <div className="p-2 space-y-1">
                    {/* 图片 ID */}
                    <p className="text-[10px] font-mono text-codex-text-secondary truncate">
                      {img.filename || img.image_id}
                    </p>

                    {/* 综合分数 */}
                    {img.score !== undefined && (
                      <p className="text-xs font-mono font-bold text-codex-accent">
                        综合 {img.score.toFixed(2)}
                      </p>
                    )}

                    {/* 核心匹配标记 */}
                    {img.core_matched && (
                      <span className="inline-block text-[10px] font-mono text-green-400">
                        &#9989; 核心相关
                      </span>
                    )}

                    {/* 维度详情展开按钮 */}
                    {hasDimensions && (
                      <button
                        className="flex items-center gap-1 text-[10px] font-mono text-codex-text-secondary hover:text-codex-accent transition-colors cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation(); /* 不触发卡片选中 */
                          toggleExpand(img.image_id);
                        }}
                      >
                        &#128202; 详情
                        <span className={`transition-transform duration-150 ${isExpanded ? 'rotate-180' : ''}`}>
                          &#9660;
                        </span>
                      </button>
                    )}

                    {/* 维度分数条（展开后显示） */}
                    {isExpanded && img.dimension_scores && (
                      <div className="space-y-1 pt-1">
                        {DIMENSION_CONFIG.map((dim) => {
                          const val = (img.dimension_scores as Record<string, number | undefined>)[dim.key] ?? 0;
                          const pct = Math.min(Math.max(val * 100, 0), 100);
                          return (
                            <div key={dim.key} className="flex items-center gap-1.5">
                              <span className="text-[9px] font-mono text-codex-text-secondary w-6 shrink-0">
                                {dim.label}
                              </span>
                              {/* 进度条背景 */}
                              <div className="flex-1 h-1.5 bg-codex-border rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-codex-accent rounded-full transition-all duration-300"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className="text-[9px] font-mono text-codex-text-secondary w-7 text-right shrink-0">
                                {val.toFixed(2)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* 匹配原因 */}
                    {img.match_reason && (
                      <p className="text-[10px] font-mono text-codex-text-secondary leading-tight line-clamp-2">
                        {img.match_reason}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 已选提示 */}
          <p className="text-xs font-mono text-codex-text-secondary">
            已选择{' '}
            <span className="text-codex-accent font-bold">{selectedIds.size}</span>{' '}
            张参考图
            {selectedIds.size >= MAX_SELECT && (
              <span className="text-codex-warning ml-1">（已达上限 {MAX_SELECT} 张）</span>
            )}
          </p>
        </>
      )}

      {/* ── 目标产品下拉 ── */}
      <div>
        <Select
          label="&#127919; 目标产品"
          options={[
            { label: '— 请选择目标产品 —', value: '' },
            ...productOptions,
          ]}
          value={targetProduct}
          onChange={setTargetProduct}
        />
      </div>

      {/* ── 生成按钮 ── */}
      <Button
        variant="primary"
        size="sm"
        onClick={handleGenerate}
        loading={loading}
        disabled={selectedIds.size === 0 || !targetProduct}
        className="w-full"
      >
        &#127912; 基于参考图生成提示词
      </Button>

      {/* ── 错误提示 ── */}
      {error && (
        <div className="px-4 py-2 bg-red-900/20 border border-codex-danger rounded-md">
          <p className="text-sm font-mono text-codex-danger">&#10060; {error}</p>
        </div>
      )}

      {/* ── 加载动画 ── */}
      {loading && (
        <div className="flex items-center justify-center py-8">
          <div className="flex flex-col items-center gap-3">
            <span className="inline-block w-8 h-8 border-3 border-codex-accent border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-mono text-codex-text-secondary">
              正在基于参考图生成提示词...
            </p>
          </div>
        </div>
      )}

      {/* ── 生成结果 ── */}
      {result && <PromptDisplay result={result} ruleId={ruleId} />}
    </div>
  );
}

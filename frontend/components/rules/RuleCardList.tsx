'use client';

/**
 * 规则卡列表组件
 * 支持 SABC 等级筛选、搜索、排序、单张删除
 * 三期追加需求5：批量删除（选择模式 → 勾选 → 一次删除）
 * Codex 深色风格
 */

import { useState, useMemo } from 'react';
import Link from 'next/link';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Select from '@/components/ui/Select';
import Input from '@/components/ui/Input';
import Card from '@/components/ui/Card';
import { apiDelete, apiPost, unwrapData } from '@/lib/api';

/* 规则摘要类型 */
interface RuleSummary {
  rule_id: string;
  rule_name: string;
  reuse_level: string;
  created_date: string;
  core_selling_point: string;
  thumbnail_path: string;
}

interface RuleCardListProps {
  rules: RuleSummary[];
  loading?: boolean;
  /** 删除成功后通知父组件从数据源移除，不用重新拉整个列表 */
  onDeleted?: (ruleId: string) => void;
}

/* 三期追加需求5：单次批量删除上限，与后端 BATCH_DELETE_MAX 保持一致 */
const BATCH_DELETE_MAX = 100;

/* 筛选选项 */
const filterOptions = [
  { label: '全部', value: '' },
  { label: 'S 级', value: 'S' },
  { label: 'A 级', value: 'A' },
  { label: 'B 级', value: 'B' },
  { label: 'C 级', value: 'C' },
];

/* 二期批次一·需求3：排序选项 */
type SortOption = 'date_desc' | 'date_asc' | 'name_asc';
const sortOptions: Array<{ label: string; value: SortOption }> = [
  { label: '创建时间 新→旧', value: 'date_desc' },
  { label: '创建时间 旧→新', value: 'date_asc' },
  { label: '名称 A→Z', value: 'name_asc' },
];

export default function RuleCardList({ rules, loading = false, onDeleted }: RuleCardListProps) {
  const [filter, setFilter] = useState('');
  /* 二期批次一·需求3：搜索关键词（匹配规则名 + 核心卖点） */
  const [searchQuery, setSearchQuery] = useState('');
  /* 二期批次一·需求3：排序方式，默认与现状一致（创建时间新→旧） */
  const [sortBy, setSortBy] = useState<SortOption>('date_desc');
  /* 正在删除中的规则 ID，用于禁用按钮防止重复点击 */
  const [deletingId, setDeletingId] = useState<string | null>(null);
  /* ── 三期追加需求5：批量删除 ── */
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);
  /* 批量删除结果提示（成功/部分失败），点 × 关闭 */
  const [batchResult, setBatchResult] = useState<{ text: string; isError: boolean } | null>(null);

  /* 根据筛选条件过滤 + 搜索 + 排序 */
  const filteredRules = useMemo(() => {
    let result = filter ? rules.filter((r) => r.reuse_level === filter) : rules;

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter((r) =>
        (r.rule_name + ' ' + (r.core_selling_point || '')).toLowerCase().includes(q)
      );
    }

    /* 创建时间新→旧是后端返回的原始顺序，不需要额外排序；其余两种显式排序 */
    if (sortBy === 'date_asc') {
      result = [...result].reverse();
    } else if (sortBy === 'name_asc') {
      result = [...result].sort((a, b) => a.rule_name.localeCompare(b.rule_name, 'zh-CN'));
    }

    return result;
  }, [rules, filter, searchQuery, sortBy]);

  /* 是否有筛选/搜索条件生效（用于顶部显示"匹配 X 条」Badge） */
  const hasActiveQuery = Boolean(filter || searchQuery.trim());

  /* 删除规则卡 */
  const handleDelete = async (e: React.MouseEvent, ruleId: string, ruleName: string) => {
    e.preventDefault(); /* 阻止触发外层 Link 跳转 */
    e.stopPropagation();
    if (!confirm(`确定删除规则卡「${ruleName}」？此操作不可恢复。`)) return;

    setDeletingId(ruleId);
    try {
      await apiDelete(`/api/rules/${ruleId}`);
      onDeleted?.(ruleId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '删除失败';
      alert('删除失败: ' + msg);
    } finally {
      setDeletingId(null);
    }
  };

  /* ── 三期追加需求5：批量删除相关操作 ── */

  /* 进入/退出选择模式（退出时清空勾选） */
  const toggleSelectMode = () => {
    setSelectMode((prev) => !prev);
    setSelectedIds(new Set());
    setBatchResult(null);
  };

  /* 勾选/取消某张 */
  const toggleSelect = (ruleId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(ruleId)) next.delete(ruleId);
      else next.add(ruleId);
      return next;
    });
  };

  /* 全选/取消全选。范围只是 filteredRules（当前筛选+搜索结果）——
   * 用户按 C 级筛选后点全选，预期是"选中这些 C 级卡"，不是全库 */
  const allFilteredSelected =
    filteredRules.length > 0 && filteredRules.every((r) => selectedIds.has(r.rule_id));
  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        filteredRules.forEach((r) => next.delete(r.rule_id));
      } else {
        filteredRules.forEach((r) => next.add(r.rule_id));
      }
      return next;
    });
  };

  /* 反选（同样只作用于当前筛选结果） */
  const invertSelection = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      filteredRules.forEach((r) => {
        if (next.has(r.rule_id)) next.delete(r.rule_id);
        else next.add(r.rule_id);
      });
      return next;
    });
  };

  /* 执行批量删除 */
  const handleBatchDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (ids.length > BATCH_DELETE_MAX) {
      setBatchResult({
        text: `单次最多删除 ${BATCH_DELETE_MAX} 条（当前选中 ${ids.length} 条），请分批操作`,
        isError: true,
      });
      return;
    }
    if (
      !confirm(
        `确定删除选中的 ${ids.length} 条规则卡？\n\n此操作不可恢复，同时会删除关联的竞品原图。`
      )
    ) {
      return;
    }

    setBatchDeleting(true);
    setBatchResult(null);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await apiPost<any>('/api/rules/batch-delete', { rule_ids: ids });
      const data = unwrapData<{
        deleted: string[];
        not_found: string[];
        failed: Array<{ rule_id: string; error: string }>;
      }>(res);
      const deleted = data?.deleted || [];
      const notFound = data?.not_found || [];
      const failed = data?.failed || [];

      /* 从列表移除"已删除"和"已不存在"两类——
       * deleted：本次真的删掉了；
       * not_found：后端已经没有这条了（可能别处已删），留在界面上是个幽灵卡片，
       *   点进去只会 404，所以也要移除。
       * 只有 failed（真失败、卡还在）才保留在列表里，用户能看到哪些没删掉、可重试。 */
      [...deleted, ...notFound].forEach((id) => onDeleted?.(id));

      const parts = [`✅ 已删除 ${deleted.length} 条`];
      if (failed.length) parts.push(`❌ 失败 ${failed.length} 条`);
      if (notFound.length) parts.push(`⚠️ ${notFound.length} 条已不存在（可能已被删除）`);
      setBatchResult({
        text: parts.join('，'),
        isError: failed.length > 0,
      });
      setSelectMode(false);
      setSelectedIds(new Set());
    } catch (err) {
      const msg = err instanceof Error ? err.message : '批量删除失败';
      /* 不做乐观更新：请求失败时列表保持不动，避免"界面删了实际没删" */
      setBatchResult({ text: `批量删除失败：${msg}`, isError: true });
    } finally {
      setBatchDeleting(false);
    }
  };

  /* 加载态骨架 */
  if (loading) {
    return (
      <div>
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-mono font-bold text-codex-text">
            📋 规则库
          </h1>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-codex-card border border-codex-border rounded-lg p-4 animate-pulse">
              <div className="flex justify-between mb-3">
                <div className="h-4 bg-codex-border/50 rounded w-2/3" />
                <div className="h-4 bg-codex-border/50 rounded w-8" />
              </div>
              <div className="h-3 bg-codex-border/50 rounded w-full mb-2" />
              <div className="h-3 bg-codex-border/50 rounded w-4/5 mb-4" />
              <div className="h-3 bg-codex-border/50 rounded w-1/3" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-mono font-bold text-codex-text">
            📋 规则库
          </h1>
          <Badge>
            {rules.length} 条
          </Badge>
          {/* 二期批次一·需求3：有筛选/搜索条件时显示匹配计数 */}
          {hasActiveQuery && (
            <Badge variant="default">
              匹配 {filteredRules.length} 条
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="w-52">
            <Input
              placeholder="搜索规则名/核心卖点..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="w-40">
            <Select
              options={sortOptions}
              value={sortBy}
              onChange={(v) => setSortBy(v as SortOption)}
            />
          </div>
          <div className="w-36">
            <Select
              options={filterOptions}
              value={filter}
              onChange={setFilter}
            />
          </div>
          {/* 三期追加需求5：进入批量删除选择模式（列表为空时不显示） */}
          {!selectMode && rules.length > 0 && (
            <Button variant="secondary" size="sm" onClick={toggleSelectMode}>
              ☑️ 批量删除
            </Button>
          )}
        </div>
      </div>

      {/* 三期追加需求5：选择模式操作条 */}
      {selectMode && (
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4 px-4 py-3 bg-codex-card border border-codex-accent/50 rounded-lg">
          <span className="text-sm font-mono text-codex-text">
            已选 <span className="text-codex-accent font-bold">{selectedIds.size}</span> 条
            {hasActiveQuery && (
              <span className="text-codex-text-secondary ml-2">
                （当前筛选出 {filteredRules.length} 条）
              </span>
            )}
          </span>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="ghost" size="sm" onClick={toggleSelectAll} disabled={batchDeleting}>
              {allFilteredSelected ? '取消全选' : `全选当前 ${filteredRules.length} 条`}
            </Button>
            <Button variant="ghost" size="sm" onClick={invertSelection} disabled={batchDeleting}>
              反选
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleBatchDelete}
              loading={batchDeleting}
              disabled={selectedIds.size === 0}
            >
              🗑 删除所选 ({selectedIds.size})
            </Button>
            <Button variant="secondary" size="sm" onClick={toggleSelectMode} disabled={batchDeleting}>
              取消
            </Button>
          </div>
        </div>
      )}

      {/* 三期追加需求5：批量删除结果提示 */}
      {batchResult && (
        <div
          className={`flex items-center justify-between gap-3 mb-4 px-4 py-2 rounded-md border ${
            batchResult.isError
              ? 'bg-red-900/20 border-codex-danger'
              : 'bg-green-900/20 border-codex-success'
          }`}
        >
          <p
            className={`text-sm font-mono ${
              batchResult.isError ? 'text-codex-danger' : 'text-codex-success'
            }`}
          >
            {batchResult.text}
          </p>
          <button
            onClick={() => setBatchResult(null)}
            className="text-codex-text-secondary hover:text-codex-text transition-colors cursor-pointer shrink-0"
            aria-label="关闭提示"
          >
            ✕
          </button>
        </div>
      )}

      {/* 空状态 */}
      {rules.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <span className="text-5xl mb-4">📭</span>
          <p className="text-codex-text-secondary font-mono text-center mb-4">
            暂无规则卡。前往「分析竞品图」页面添加第一条规则。
          </p>
          <Link
            href="/analyze"
            className="text-codex-accent hover:underline font-mono text-sm"
          >
            → 前往分析竞品图
          </Link>
        </div>
      ) : filteredRules.length === 0 && searchQuery.trim() ? (
        /* 二期批次一·需求3：搜索无结果的专属空态文案 */
        <div className="flex flex-col items-center justify-center py-20">
          <span className="text-5xl mb-4">🔍</span>
          <p className="text-codex-text-secondary font-mono text-center">
            没有找到与「{searchQuery.trim()}」匹配的规则卡
          </p>
        </div>
      ) : filteredRules.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <span className="text-5xl mb-4">🔍</span>
          <p className="text-codex-text-secondary font-mono text-center">
            没有找到 {filter} 级的规则卡
          </p>
        </div>
      ) : (
        /* 卡片网格 */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredRules.map((rule) => {
            const isSelected = selectedIds.has(rule.rule_id);

            /* 卡片内容（选择模式与普通模式共用，只是外层容器不同） */
            const cardBody = (
              <Card
                hoverable={!selectMode}
                className={`h-full relative group ${
                  selectMode
                    ? isSelected
                      ? 'border-codex-accent ring-1 ring-codex-accent/40 cursor-pointer'
                      : 'cursor-pointer hover:border-codex-accent/50'
                    : ''
                }`}
              >
                {/* 三期追加需求5：选择模式下的勾选框（样式与版本A 推荐图网格一致） */}
                {selectMode && (
                  <div
                    className={`
                      absolute top-2 left-2 z-10
                      w-5 h-5 rounded border-2 flex items-center justify-center
                      transition-colors duration-150
                      ${isSelected
                        ? 'bg-codex-accent border-codex-accent'
                        : 'bg-codex-bg/80 border-codex-text-secondary/50'
                      }
                    `}
                  >
                    {isSelected && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                )}
                {/* #12：缩略图（有则显示，旧规则卡无 thumbnail_path 则文字卡片兜底）*/}
                {rule.thumbnail_path && (
                  <div className="mb-2 rounded-md overflow-hidden border border-codex-border aspect-video bg-codex-bg">
                    <img src={rule.thumbnail_path} alt={rule.rule_name} className="w-full h-full object-cover" />
                  </div>
                )}
                {/* 顶部：名称 + Badge + 删除按钮 */}
                <div className="flex items-start justify-between mb-2 gap-2">
                  <h3 className="text-sm font-mono font-bold text-codex-text leading-tight flex-1 min-w-0">
                    {rule.rule_name}
                  </h3>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant={(rule.reuse_level as 'S' | 'A' | 'B' | 'C') || 'default'}>
                      {rule.reuse_level}
                    </Badge>
                    {/* 删除按钮：默认淡出，hover 卡片时显现，避免列表视觉噪音。
                        三期追加需求5：选择模式下隐藏，避免两套删除入口并存造成误触 */}
                    {!selectMode && (
                      <button
                        onClick={(e) => handleDelete(e, rule.rule_id, rule.rule_name)}
                        disabled={deletingId === rule.rule_id}
                        className="
                          text-xs font-mono rounded px-1.5 py-0.5
                          text-codex-text-secondary
                          opacity-0 group-hover:opacity-100
                          hover:bg-red-900/30 hover:text-codex-danger
                          transition-all duration-150
                          cursor-pointer disabled:cursor-wait disabled:opacity-50
                        "
                        title="删除此规则卡"
                      >
                        {deletingId === rule.rule_id ? '⏳' : '🗑'}
                      </button>
                    )}
                  </div>
                </div>
                {/* 中间：核心卖点摘要 */}
                <p className="text-xs text-codex-text-secondary font-mono line-clamp-2 mb-3">
                  {rule.core_selling_point || '暂无摘要'}
                </p>
                {/* 底部：创建日期 */}
                <p className="text-xs text-codex-text-secondary/60 font-mono">
                  {rule.created_date}
                </p>
              </Card>
            );

            /* 三期追加需求5：选择模式下不渲染 Link（点卡片=勾选）。
               直接不渲染而不是靠 preventDefault 拦截——避免"看起来是链接但点了不跳"的
               可访问性问题（键盘/读屏用户会被误导），语义更干净。 */
            return selectMode ? (
              <div
                key={rule.rule_id}
                onClick={() => toggleSelect(rule.rule_id)}
                role="checkbox"
                aria-checked={isSelected}
                aria-label={`选择规则卡 ${rule.rule_name}`}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    toggleSelect(rule.rule_id);
                  }
                }}
              >
                {cardBody}
              </div>
            ) : (
              <Link key={rule.rule_id} href={`/rules/${rule.rule_id}`}>
                {cardBody}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

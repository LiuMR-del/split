'use client';

/**
 * 规则卡列表组件
 * 支持 SABC 等级筛选、网格布局、删除
 * Codex 深色风格
 */

import { useState, useMemo } from 'react';
import Link from 'next/link';
import Badge from '@/components/ui/Badge';
import Select from '@/components/ui/Select';
import Card from '@/components/ui/Card';
import { apiDelete } from '@/lib/api';

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

/* 筛选选项 */
const filterOptions = [
  { label: '全部', value: '' },
  { label: 'S 级', value: 'S' },
  { label: 'A 级', value: 'A' },
  { label: 'B 级', value: 'B' },
  { label: 'C 级', value: 'C' },
];

export default function RuleCardList({ rules, loading = false, onDeleted }: RuleCardListProps) {
  const [filter, setFilter] = useState('');
  /* 正在删除中的规则 ID，用于禁用按钮防止重复点击 */
  const [deletingId, setDeletingId] = useState<string | null>(null);

  /* 根据筛选条件过滤 */
  const filteredRules = useMemo(() => {
    if (!filter) return rules;
    return rules.filter((r) => r.reuse_level === filter);
  }, [rules, filter]);

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
        </div>
        <div className="w-36">
          <Select
            options={filterOptions}
            value={filter}
            onChange={setFilter}
          />
        </div>
      </div>

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
          {filteredRules.map((rule) => (
            <Link key={rule.rule_id} href={`/rules/${rule.rule_id}`}>
              <Card hoverable className="h-full relative group">
                {/* 顶部：名称 + Badge + 删除按钮 */}
                <div className="flex items-start justify-between mb-2 gap-2">
                  <h3 className="text-sm font-mono font-bold text-codex-text leading-tight flex-1 min-w-0">
                    {rule.rule_name}
                  </h3>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant={(rule.reuse_level as 'S' | 'A' | 'B' | 'C') || 'default'}>
                      {rule.reuse_level}
                    </Badge>
                    {/* 删除按钮：默认淡出，hover 卡片时显现，避免列表视觉噪音 */}
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
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

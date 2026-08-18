'use client';

/**
 * 生图任务管理页面
 * 按关联规则分组展示（可收起），组内按提示词版本（A/B/C/未标记）切 Tab，
 * 只显示该规则下实际生成过的版本，点击切换查看对应版本的所有生成记录。
 * Codex 深色风格
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Link from 'next/link';
import { apiGet, apiPost, apiDelete, unwrapData } from '@/lib/api';

/* 生图任务数据结构 */
interface GenTask {
  task_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  rule_id?: string;
  rule_name?: string;
  /** 提示词来自哪个版本：A/B/C，旧数据/未传时为空字符串 */
  version?: string;
  prompt_positive?: string;
  prompt_negative?: string;
  width?: number;
  height?: number;
  count?: number;
  created_at?: string;
  images?: Array<{ url: string; filename?: string }>;
  image_urls?: string[];
  error?: string;
}

/* 状态筛选选项 */
const STATUS_FILTERS = [
  { label: '全部', value: 'all' },
  { label: '处理中', value: 'processing' },
  { label: '已完成', value: 'completed' },
  { label: '失败', value: 'failed' },
] as const;

/* 状态对应的样式（pending 与 processing 统一显示为"处理中"） */
const statusStyles: Record<string, { bg: string; text: string; label: string }> = {
  pending: { bg: 'bg-yellow-900/30 border-codex-warning', text: 'text-codex-warning', label: '处理中' },
  processing: { bg: 'bg-yellow-900/30 border-codex-warning', text: 'text-codex-warning', label: '处理中' },
  completed: { bg: 'bg-green-900/30 border-codex-success', text: 'text-codex-success', label: '已完成' },
  failed: { bg: 'bg-red-900/30 border-codex-danger', text: 'text-codex-danger', label: '失败' },
};

/* 版本 Tab 配置：key 对应 task.version 的值，UNVERSIONED 是没有 version 字段的旧数据 */
const UNVERSIONED = '__unversioned__';
const VERSION_TABS: Record<string, { label: string; short: string }> = {
  A: { label: '📚 资料库关联', short: 'A' },
  B: { label: '🤖 AI 推荐', short: 'B' },
  C: { label: '🔧 自定义模板', short: 'C' },
  /* 三期阶段四：元素拆分图的任务（ElementExtractSection 提交时写 version='E'） */
  E: { label: '🧩 元素拆分', short: 'E' },
  [UNVERSIONED]: { label: '📁 未标记版本', short: '?' },
};
/* Tab 显示顺序 */
const VERSION_ORDER = ['A', 'B', 'C', 'E', UNVERSIONED];

/* 每页加载多少个**规则组**（不是任务数）。组内任务全量返回，所以一次能完整展开。
 * 10 组通常覆盖近期全部工作量；再往前的历史点"加载更多规则"。 */
const GROUPS_PER_PAGE = 10;

/* 按规则分组后的结构 */
interface RuleGroup {
  ruleId: string;
  ruleName: string;
  /** 按版本分桶的任务，key 是 VERSION_TABS 的 key */
  byVersion: Record<string, GenTask[]>;
  /** 该规则下任务总数（用于分组标题展示） */
  total: number;
  /** 最近一次创建时间，用于分组排序 */
  latestCreatedAt: string;
}

export default function GenPage() {
  /* 任务列表（未分组的原始扁平数据） */
  const [tasks, setTasks] = useState<GenTask[]>([]);
  /* 后端规则组总数。⚠️ 分页单位是**规则组**不是任务——按任务分页时一次元素变体
   * 生成（20+ 条）就吃满一页，点"加载更多"只多冒出一个组，很难用
   * （2026-08-18 用户反馈）。记录本身从不自动清理，废弃数据用"清理"按钮显式删 */
  const [totalGroups, setTotalGroups] = useState(0);
  /* 孤儿任务数（所属规则卡已删），>0 时显示清理入口 */
  const [orphanCount, setOrphanCount] = useState(0);
  const [cleaning, setCleaning] = useState(false);
  /* 正在按组删除的 ruleId（按钮态，防重复点击） */
  const [deletingGroupId, setDeletingGroupId] = useState<string | null>(null);
  /* 已加载到第几页 */
  const [page, setPage] = useState(1);
  /* 每个规则分组的**真实**任务总数（后端 SQLite 聚合，与分页无关）。
   * 分组徽标"N 条"必须用它——按已加载任务计数会在"加载更多"之前少算
   * （2026-08-18 用户反馈：垒球组实际 24 条只显示 20） */
  const [groupCounts, setGroupCounts] = useState<Record<string, number>>({});
  /* "加载更多"进行中（与首屏 loading 分开，避免整页骨架闪烁） */
  const [loadingMore, setLoadingMore] = useState(false);
  /* 加载状态 */
  const [loading, setLoading] = useState(true);
  /* 加载错误 */
  const [loadError, setLoadError] = useState('');
  /* 状态筛选 */
  const [filter, setFilter] = useState('all');
  /* 展开的规则分组 ID 集合（默认全部收起） */
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  /* 每个分组当前选中的版本 Tab（key: ruleId, value: 版本 key） */
  const [activeVersionByGroup, setActiveVersionByGroup] = useState<Record<string, string>>({});
  /* 展开详情的任务 ID 集合 */
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(new Set());
  /* 大图预览 URL */
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  /* 加载任务列表。pageArg>1 时为"加载更多"（追加），否则重载第一页（刷新/首屏） */
  const loadTasks = useCallback(async (pageArg: number = 1) => {
    const append = pageArg > 1;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setLoadError('');
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await apiGet<any>(
        `/api/gen/tasks?group_by_rule=true&page=${pageArg}&page_size=${GROUPS_PER_PAGE}`
      );
      const data = unwrapData<any>(res);
      // 后端返回 {items: [...]} 或 {tasks: [...]} 或直接数组（裸数据，unwrapData 原样透传）
      const list = data.items || data.tasks || (Array.isArray(data) ? data : []);
      // 统一把 image_urls 字符串数组转成 images 对象数组
      const normalized = list.map((t: GenTask) => ({
        ...t,
        images: t.images || (t.image_urls || []).map((u: string) => ({ url: u })),
      }));
      setTasks((prev) => (append ? [...prev, ...normalized] : normalized));
      setPage(pageArg);
      setTotalGroups(typeof data.total_groups === 'number' ? data.total_groups : 0);
      /* 首页/刷新时同步拉分组真实计数（加载更多不用重拉，计数与分页无关）。
       * 失败静默——徽标回落到"已加载条数"，不阻断列表 */
      if (!append) {
        try {
          const cres = await apiGet<{ counts?: Record<string, number> }>(
            '/api/gen/tasks/group-counts'
          );
          const counts = unwrapData<{ counts?: Record<string, number> }>(cres)?.counts;
          if (counts && typeof counts === 'object') setGroupCounts(counts);
        } catch {
          /* 静默 */
        }
        try {
          const ores = await apiGet<{ count?: number }>('/api/gen/tasks/orphans');
          setOrphanCount(unwrapData<{ count?: number }>(ores)?.count || 0);
        } catch {
          /* 静默 */
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '加载任务列表失败';
      setLoadError(msg);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  /* 切换规则分组展开/折叠 */
  const toggleGroup = (ruleId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(ruleId)) {
        next.delete(ruleId);
      } else {
        next.add(ruleId);
      }
      return next;
    });
  };

  /* 切换任务详情展开/折叠 */
  const toggleTaskExpand = (taskId: string) => {
    setExpandedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  /* 删除任务 */
  const handleDelete = async (taskId: string) => {
    if (!confirm('确定删除此任务？')) return;
    try {
      await apiDelete(`/api/gen/task/${taskId}`);
      /* 从列表中移除，不刷新整个页面 */
      setTasks((prev) => prev.filter((t) => t.task_id !== taskId));
      /* 分组真实计数同步减一（找到该任务所属规则） */
      const deleted = tasks.find((t) => t.task_id === taskId);
      const rid = deleted?.rule_id || '';
      if (rid) {
        setGroupCounts((prev) =>
          prev[rid] ? { ...prev, [rid]: Math.max(0, prev[rid] - 1) } : prev
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '删除失败';
      alert('删除失败: ' + msg);
    }
  };

  /* 按组删除：一次删掉该规则下的全部生图记录（2026-08-18 用户反馈）。
   * 元素变体一组常有 20+ 条，逐条删要点几十次确认。 */
  const handleDeleteGroup = async (group: RuleGroup) => {
    const count = groupCounts[group.ruleId] ?? group.total;
    if (
      !confirm(
        `确定删除「${group.ruleName}」下的全部 ${count} 条生图记录？` +
          `连同已下载到本地的图片一并删除，此操作不可撤销。`
      )
    )
      return;
    setDeletingGroupId(group.ruleId);
    try {
      const res = await apiPost<{ deleted_count?: number; failed?: unknown[] }>(
        '/api/gen/tasks/delete-by-rule',
        { rule_id: group.ruleId === '__no_rule__' ? '' : group.ruleId }
      );
      const data = unwrapData<{ deleted_count?: number; failed?: unknown[] }>(res);
      const failedCount = (data?.failed || []).length;
      if (failedCount) {
        alert(`已删除 ${data?.deleted_count ?? 0} 条，${failedCount} 条失败`);
      }
      /* 重载第一页（组数变了，分页边界也变，不做乐观更新以免与后端不一致） */
      await loadTasks(1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '删除失败';
      alert('删除失败: ' + msg);
    } finally {
      setDeletingGroupId(null);
    }
  };

  /* 清理废弃数据：删除"所属规则卡已被删除"的孤儿任务（2026-08-18 用户反馈）。
   * 数据删除必须显式确认，绝不自动清理——用户可能还想留着看图。 */
  const handleCleanupOrphans = async () => {
    if (
      !confirm(
        `将删除 ${orphanCount} 条废弃记录（它们所属的规则卡已被删除，点进去也打不开），` +
          `连同已下载到本地的图片一并清理。此操作不可撤销，确定继续？`
      )
    )
      return;
    setCleaning(true);
    try {
      const res = await apiPost<{ deleted_count?: number; failed?: unknown[] }>(
        '/api/gen/tasks/cleanup-orphans',
        {}
      );
      const data = unwrapData<{ deleted_count?: number; failed?: unknown[] }>(res);
      const failedCount = (data?.failed || []).length;
      alert(
        `已清理 ${data?.deleted_count ?? 0} 条` + (failedCount ? `，${failedCount} 条失败` : '')
      );
      await loadTasks(1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '清理失败';
      alert('清理失败: ' + msg);
    } finally {
      setCleaning(false);
    }
  };

  /* 按状态筛选（"处理中"同时匹配 pending 和 processing） */
  const filteredTasks = useMemo(() => {
    return filter === 'all'
      ? tasks
      : filter === 'processing'
        ? tasks.filter((t) => t.status === 'pending' || t.status === 'processing')
        : tasks.filter((t) => t.status === filter);
  }, [tasks, filter]);

  /* 按规则分组，组内再按版本分桶 */
  const ruleGroups = useMemo<RuleGroup[]>(() => {
    const groupMap = new Map<string, RuleGroup>();

    for (const task of filteredTasks) {
      const ruleId = task.rule_id || '__no_rule__';
      const ruleName = task.rule_name || (ruleId === '__no_rule__' ? '（未关联规则）' : ruleId);
      const versionKey = task.version && VERSION_TABS[task.version] ? task.version : UNVERSIONED;

      let group = groupMap.get(ruleId);
      if (!group) {
        group = { ruleId, ruleName, byVersion: {}, total: 0, latestCreatedAt: '' };
        groupMap.set(ruleId, group);
      }
      if (!group.byVersion[versionKey]) {
        group.byVersion[versionKey] = [];
      }
      group.byVersion[versionKey].push(task);
      group.total += 1;
      if (!group.latestCreatedAt || (task.created_at || '') > group.latestCreatedAt) {
        group.latestCreatedAt = task.created_at || '';
      }
    }

    /* 组内每个版本桶按创建时间倒序 */
    const groups = Array.from(groupMap.values());
    for (const g of groups) {
      for (const key of Object.keys(g.byVersion)) {
        g.byVersion[key].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
      }
    }

    /* 分组按最近创建时间倒序 */
    groups.sort((a, b) => b.latestCreatedAt.localeCompare(a.latestCreatedAt));
    return groups;
  }, [filteredTasks]);

  /* 获取某个分组当前应该选中的版本 Tab（未显式选择时默认第一个有数据的） */
  const getActiveVersion = (group: RuleGroup): string => {
    const chosen = activeVersionByGroup[group.ruleId];
    const availableVersions = VERSION_ORDER.filter((v) => (group.byVersion[v]?.length || 0) > 0);
    if (chosen && availableVersions.includes(chosen)) return chosen;
    return availableVersions[0] || '';
  };

  /* 格式化时间 */
  const formatTime = (dateStr?: string) => {
    if (!dateStr) return '未知时间';
    try {
      return new Date(dateStr).toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  /* 截断提示词文本 */
  const truncateText = (text?: string, maxLen = 100) => {
    if (!text) return '无提示词';
    return text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
  };

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-4xl mx-auto">
        {/* 页面标题 */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-codex-text-secondary hover:text-codex-text font-mono text-sm transition-colors"
            >
              ← 返回
            </Link>
            <h1 className="text-2xl font-bold font-mono text-codex-text">
              🎨 生图任务
            </h1>
          </div>
          {orphanCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCleanupOrphans}
              loading={cleaning}
              title="删除所属规则卡已被删除的废弃记录，释放磁盘空间"
            >
              🧹 清理废弃（{orphanCount}）
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => loadTasks(1)}
            loading={loading}
          >
            🔄 刷新
          </Button>
        </div>

        {/* 状态筛选栏 */}
        <div className="flex gap-2 mb-6">
          {STATUS_FILTERS.map((item) => (
            <button
              key={item.value}
              onClick={() => setFilter(item.value)}
              className={`
                px-3 py-1.5 text-sm font-mono rounded-md
                transition-colors duration-150 cursor-pointer
                ${filter === item.value
                  ? 'bg-codex-accent text-white'
                  : 'bg-codex-card text-codex-text-secondary border border-codex-border hover:border-codex-accent hover:text-codex-text'
                }
              `}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* 加载错误 */}
        {loadError && (
          <div className="px-4 py-3 bg-red-900/20 border border-codex-danger rounded-md mb-6">
            <p className="text-sm font-mono text-codex-danger">❌ {loadError}</p>
          </div>
        )}

        {/* 加载中骨架 */}
        {loading && (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse bg-codex-card border border-codex-border rounded-lg p-4">
                <div className="h-4 bg-codex-border/30 rounded w-1/3 mb-3" />
                <div className="h-3 bg-codex-border/30 rounded w-2/3 mb-2" />
                <div className="h-3 bg-codex-border/30 rounded w-1/2" />
              </div>
            ))}
          </div>
        )}

        {/* 空状态 */}
        {!loading && ruleGroups.length === 0 && (
          <div className="text-center py-16">
            <span className="text-5xl mb-4 block">🎨</span>
            <p className="text-codex-text-secondary font-mono text-sm">
              {filter !== 'all'
                ? `暂无「${STATUS_FILTERS.find(s => s.value === filter)?.label}」状态的任务`
                : '暂无生图任务。在规则详情页生成提示词后点击「生成图片」'}
            </p>
          </div>
        )}

        {/* 规则分组列表 */}
        {!loading && ruleGroups.length > 0 && (
          <div className="space-y-4">
            {ruleGroups.map((group) => {
              const isGroupExpanded = expandedGroups.has(group.ruleId);
              const activeVersion = getActiveVersion(group);
              const availableVersions = VERSION_ORDER.filter(
                (v) => (group.byVersion[v]?.length || 0) > 0
              );
              const activeTasks = group.byVersion[activeVersion] || [];

              return (
                <Card key={group.ruleId} className="bg-codex-card">
                  {/* 分组标题栏（点击展开/折叠） */}
                  <div
                    className="flex items-center justify-between cursor-pointer"
                    onClick={() => toggleGroup(group.ruleId)}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className={`text-codex-text-secondary transition-transform duration-200 shrink-0 ${isGroupExpanded ? 'rotate-90' : ''}`}
                      >
                        ▶
                      </span>
                      <h2 className="text-sm font-mono font-bold text-codex-text truncate">
                        📋 {group.ruleName}
                      </h2>
                      {/* "全部"筛选下显示该组的真实总条数（后端聚合，与分页无关）；
                          状态筛选下真实的分状态计数未知，回落为已加载的过滤条数 */}
                      <Badge>
                        {filter === 'all'
                          ? (groupCounts[group.ruleId] ?? group.total)
                          : group.total}{' '}
                        条
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <span className="text-xs font-mono text-codex-text-secondary">
                        {formatTime(group.latestCreatedAt)}
                      </span>
                      {/* 按组删除：整组一次删完（元素变体一组 20+ 条，逐条删要点几十次）。
                          stopPropagation 防止连带触发标题栏的展开/折叠 */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteGroup(group);
                        }}
                        disabled={deletingGroupId === group.ruleId}
                        title="删除该规则下的全部生图记录"
                        className="text-xs font-mono text-codex-text-secondary hover:text-codex-danger transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed px-1"
                      >
                        {deletingGroupId === group.ruleId ? '删除中…' : '🗑 删除整组'}
                      </button>
                    </div>
                  </div>

                  {/* 展开后：版本 Tab + 该版本下的任务列表 */}
                  {isGroupExpanded && (
                    <div className="mt-4 pt-4 border-t border-codex-border">
                      {/* 版本 Tab 栏（只显示实际有任务的版本） */}
                      <div className="flex gap-2 mb-4 flex-wrap">
                        {availableVersions.map((v) => (
                          <button
                            key={v}
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveVersionByGroup((prev) => ({ ...prev, [group.ruleId]: v }));
                            }}
                            className={`
                              px-3 py-1.5 text-xs font-mono rounded-md
                              transition-colors duration-150 cursor-pointer
                              ${activeVersion === v
                                ? 'bg-codex-accent text-white'
                                : 'bg-codex-bg text-codex-text-secondary border border-codex-border hover:border-codex-accent hover:text-codex-text'
                              }
                            `}
                          >
                            {VERSION_TABS[v].label}
                            <span className="ml-1.5 opacity-70">
                              ({group.byVersion[v]?.length || 0})
                            </span>
                          </button>
                        ))}
                      </div>

                      {/* 当前版本下的任务列表 */}
                      <div className="space-y-3">
                        {activeTasks.map((task) => {
                          const style = statusStyles[task.status] || statusStyles.processing;
                          const isTaskExpanded = expandedTaskIds.has(task.task_id);

                          return (
                            <div
                              key={task.task_id}
                              className="bg-codex-bg border border-codex-border rounded-lg p-3"
                            >
                              {/* 任务头部（可点击展开） */}
                              <div
                                className="cursor-pointer"
                                onClick={() => toggleTaskExpand(task.task_id)}
                              >
                                {/* 第一行：任务 ID + 状态 Badge */}
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-3">
                                    <span className="text-sm font-mono text-codex-text-secondary">
                                      #{task.task_id}
                                    </span>
                                    <span
                                      className={`
                                        inline-flex items-center rounded-full px-2 py-0.5
                                        text-xs font-mono border
                                        ${style.bg} ${style.text}
                                      `}
                                    >
                                      {(task.status === 'pending' || task.status === 'processing') && (
                                        <span className="inline-block w-3 h-3 border-[1.5px] border-current border-t-transparent rounded-full animate-spin mr-1" />
                                      )}
                                      {style.label}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {/* 删除按钮 */}
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDelete(task.task_id);
                                      }}
                                      className="
                                        px-2 py-0.5 text-xs font-mono rounded
                                        text-codex-danger bg-transparent
                                        hover:bg-red-900/30 hover:text-red-300
                                        transition-colors duration-150
                                        cursor-pointer
                                      "
                                      title="删除任务"
                                    >
                                      🗑 删除
                                    </button>
                                    <span className="text-xs font-mono text-codex-text-secondary">
                                      {isTaskExpanded ? '▲ 收起' : '▼ 展开'}
                                    </span>
                                  </div>
                                </div>

                                {/* 第二行：提示词摘要 */}
                                <p className="text-xs font-mono text-codex-text-secondary mb-2 leading-relaxed">
                                  {truncateText(task.prompt_positive)}
                                </p>

                                {/* 第三行：创建时间 + 尺寸信息 */}
                                <div className="flex items-center gap-4 text-xs font-mono text-codex-text-secondary">
                                  <span>🕐 {formatTime(task.created_at)}</span>
                                  {task.width && task.height && (
                                    <span>📐 {task.width}×{task.height}</span>
                                  )}
                                  {task.count && (
                                    <span>🔢 ×{task.count}</span>
                                  )}
                                </div>

                                {/* 已完成时显示缩略图预览 */}
                                {task.status === 'completed' && task.images && task.images.length > 0 && !isTaskExpanded && (
                                  <div className="flex gap-2 mt-3">
                                    {task.images.slice(0, 4).map((img, idx) => (
                                      <div
                                        key={idx}
                                        className="w-16 h-16 bg-codex-card border border-codex-border rounded overflow-hidden"
                                      >
                                        <img
                                          src={img.url}
                                          alt={img.filename || `图片 ${idx + 1}`}
                                          className="w-full h-full object-cover"
                                        />
                                      </div>
                                    ))}
                                    {task.images.length > 4 && (
                                      <div className="w-16 h-16 bg-codex-card border border-codex-border rounded flex items-center justify-center">
                                        <span className="text-xs font-mono text-codex-text-secondary">
                                          +{task.images.length - 4}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                )}

                                {/* 失败时显示错误 */}
                                {task.status === 'failed' && task.error && (
                                  <p className="text-xs font-mono text-codex-danger mt-2">
                                    ❌ {task.error}
                                  </p>
                                )}
                              </div>

                              {/* 展开详情 */}
                              {isTaskExpanded && (
                                <div className="mt-4 pt-4 border-t border-codex-border space-y-4">
                                  {/* 完整提示词 */}
                                  {task.prompt_positive && (
                                    <div className="space-y-1">
                                      <h4 className="text-xs font-mono font-bold text-codex-text">
                                        🖼️ 正向提示词
                                      </h4>
                                      <pre className="bg-codex-bg border border-codex-border rounded-lg p-3 text-xs font-mono text-codex-text whitespace-pre-wrap break-words">
                                        {task.prompt_positive}
                                      </pre>
                                    </div>
                                  )}
                                  {task.prompt_negative && (
                                    <div className="space-y-1">
                                      <h4 className="text-xs font-mono font-bold text-codex-text">
                                        🚫 负向提示词
                                      </h4>
                                      <pre className="bg-codex-bg border border-codex-border rounded-lg p-3 text-xs font-mono text-codex-text whitespace-pre-wrap break-words">
                                        {task.prompt_negative}
                                      </pre>
                                    </div>
                                  )}

                                  {/* 大图展示（已完成） */}
                                  {task.status === 'completed' && task.images && task.images.length > 0 && (
                                    <div className="space-y-2">
                                      <h4 className="text-xs font-mono font-bold text-codex-success">
                                        📸 生成结果
                                      </h4>
                                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                                        {task.images.map((img, idx) => (
                                          <div
                                            key={idx}
                                            className="bg-codex-card border border-codex-border rounded-md overflow-hidden cursor-pointer hover:border-codex-accent transition-colors"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setPreviewUrl(img.url);
                                            }}
                                          >
                                            <img
                                              src={img.url}
                                              alt={img.filename || `图片 ${idx + 1}`}
                                              className="w-full h-40 object-cover"
                                            />
                                            <p className="text-[10px] font-mono text-codex-text-secondary p-1 text-center truncate">
                                              {img.filename || `图 ${idx + 1}`}
                                            </p>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}

        {/* 加载更多：后端一页 20 条，历史记录全量保留在磁盘，按页取。
            注意状态筛选是前端过滤"已加载的任务"，未加载页里的任务要先加载更多才会出现 */}
        {!loading && !loadError && page < Math.ceil(totalGroups / GROUPS_PER_PAGE) && (
          <div className="flex justify-center pt-2">
            <button
              onClick={() => loadTasks(page + 1)}
              disabled={loadingMore}
              className="px-4 py-2 text-sm font-mono rounded-md border border-codex-border text-codex-text hover:border-codex-accent hover:text-codex-accent transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loadingMore
                ? '加载中…'
                : `⬇ 加载更多规则（已显示 ${Math.min(page * GROUPS_PER_PAGE, totalGroups)} / 共 ${totalGroups} 个规则）`}
            </button>
          </div>
        )}

        {/* 大图预览遮罩 */}
        {previewUrl && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 cursor-pointer"
            onClick={() => setPreviewUrl(null)}
          >
            <div className="relative max-w-[90vw] max-h-[90vh]">
              <img
                src={previewUrl}
                alt="大图预览"
                className="max-w-full max-h-[85vh] object-contain rounded-lg"
              />
              <button
                onClick={() => setPreviewUrl(null)}
                className="absolute top-2 right-2 text-white text-xl bg-black/50 rounded-full w-8 h-8 flex items-center justify-center hover:bg-black/80 transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

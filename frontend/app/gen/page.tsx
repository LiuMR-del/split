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
import { apiGet, apiDelete, unwrapData } from '@/lib/api';

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
  [UNVERSIONED]: { label: '📁 未标记版本', short: '?' },
};
/* Tab 显示顺序 */
const VERSION_ORDER = ['A', 'B', 'C', UNVERSIONED];

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

  /* 加载任务列表 */
  const loadTasks = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await apiGet<any>('/api/gen/tasks');
      const data = unwrapData<any>(res);
      // 后端返回 {items: [...]} 或 {tasks: [...]} 或直接数组（裸数据，unwrapData 原样透传）
      const list = data.items || data.tasks || (Array.isArray(data) ? data : []);
      // 统一把 image_urls 字符串数组转成 images 对象数组
      const normalized = list.map((t: GenTask) => ({
        ...t,
        images: t.images || (t.image_urls || []).map((u: string) => ({ url: u })),
      }));
      setTasks(normalized);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '加载任务列表失败';
      setLoadError(msg);
    } finally {
      setLoading(false);
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : '删除失败';
      alert('删除失败: ' + msg);
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
          <Button
            variant="ghost"
            size="sm"
            onClick={loadTasks}
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
                      <Badge>{group.total} 条</Badge>
                    </div>
                    <span className="text-xs font-mono text-codex-text-secondary shrink-0 ml-2">
                      {formatTime(group.latestCreatedAt)}
                    </span>
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
                                      <pre className="bg-[#0d1117] border border-codex-border rounded-lg p-3 text-xs font-mono text-codex-text whitespace-pre-wrap break-words">
                                        {task.prompt_positive}
                                      </pre>
                                    </div>
                                  )}
                                  {task.prompt_negative && (
                                    <div className="space-y-1">
                                      <h4 className="text-xs font-mono font-bold text-codex-text">
                                        🚫 负向提示词
                                      </h4>
                                      <pre className="bg-[#0d1117] border border-codex-border rounded-lg p-3 text-xs font-mono text-codex-text whitespace-pre-wrap break-words">
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

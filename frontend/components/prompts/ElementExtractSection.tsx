'use client';

/**
 * 元素变体素材（三期阶段四 · 需求1）
 *
 * 把规则卡里每个可变维度的**每个候选变体**，各抠成一张"保持原位、透明底"的素材图：
 * 维度清单（宠物类型/花卉装饰/爪印符号…）→ 展开看候选变体（金毛犬/拉布拉多/猫咪…）
 * → 勾选要生成的变体 → 串行逐个生成 → 单张/打包下载。
 * 拿到一组同位置、同姿态、同风格的素材后，叠换即得 N 个变体设计。
 *
 * 【入口是按钮触发，不是默认渲染的面板】（§6.4.1 变更块）
 * 这是低频功能，默认只渲染一行入口按钮，**未点击前零请求、不渲染面板**；
 * 点击后才加载清单。入口按钮只负责"激活+加载"，**绝不自动开始生成**——
 * 生成必须"勾选变体 → 再点生成"二次确认（每个变体一次付费调用）。
 *
 * 【关键实测结论】（详见方案文档 §6.7 / §6.9 / §6.10）
 * 1. **位置对位**靠"原位擦除/原位替换"指令 + 按竞品原图比例请求画布
 *    （第一版写 `Place it alone, centered` 主动要求了居中，位置全错）。
 * 2. **透明底靠后端转换**，不靠生图 API 的 background 参数——透明底与"保持原位置"
 *    在 API 侧不可兼得，所以出白底再由 `white_to_transparent()` 转（白边残留 0%）。
 * 3. 输出比例不完全可控，结果网格用 `object-contain` + **棋盘格底衬**
 *    （透明图放在白/深色卡片上都看不出哪里透明）。
 * 4. 耗时约 40 秒/张（Spike 实测 31~48 秒），警示条按"约 1 分钟/张"提示。
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import CollapsibleSection from '@/components/ui/CollapsibleSection';
import { apiGet, apiPost, unwrapData, getImageUrl, BASE_URL } from '@/lib/api';
import { getSupportsReference } from '@/lib/genConfig';

/* 后端返回的单个候选变体 */
interface VariantFromApi {
  variant_key: string;
  label_cn: string;
  /* 候选名无中文时后端批量翻译的中文附注（2026-08-18，语言漂移卡兜底），可能缺失 */
  label_translated?: string;
  label_for_prompt: string;
  is_original: boolean;
  prompt: string;
}

/* 后端 GET /api/prompts/elements/{rule_id} 返回的单个维度 */
interface ElementFromApi {
  element_key: string;
  name_cn: string;
  value_cn: string;
  value_for_prompt: string;
  position: string;
  is_text_slot: boolean;
  extraction_prompt: string;
  variants: VariantFromApi[];
}

/* 组件内部维护的"一个待生成任务" = 某维度下的某个变体 */
interface JobItem {
  /** 唯一键 = variant_key */
  key: string;
  /** 所属维度（分组展示用） */
  elementKey: string;
  elementName: string;
  /** 变体信息 */
  labelCn: string;
  /** 英文候选名的中文附注（无则不显示） */
  labelTranslated?: string;
  isOriginal: boolean;
  prompt: string;
  /* 本地状态 */
  checked: boolean;
  status: 'idle' | 'queued' | 'generating' | 'done' | 'failed';
  taskId?: string;
  imageUrl?: string;
  error?: string;
  downloadChecked: boolean;
  downloading?: boolean;
}

interface ElementExtractSectionProps {
  ruleId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ruleCard: any;
}

/* 竞品原图尺寸读不到时的回落画布（正方形）。正常情况下用原图宽高，见 sourceSize */
const EXTRACT_SIZE = 1024;

/* 透明图的棋盘格底衬——透明 PNG 放在白/深色卡片上都看不出"哪里是透明的"，
 * 用 CSS 渐变画一个 16px 棋盘格（不引入图片资源），和设计软件的习惯一致。 */
const CHECKER_STYLE: React.CSSProperties = {
  backgroundImage:
    'linear-gradient(45deg, #cbd5e1 25%, transparent 25%, transparent 75%, #cbd5e1 75%),' +
    'linear-gradient(45deg, #cbd5e1 25%, transparent 25%, transparent 75%, #cbd5e1 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0, 8px 8px',
  backgroundColor: '#f8fafc',
};

export default function ElementExtractSection({ ruleId, ruleCard }: ElementExtractSectionProps) {
  /* 是否已激活（点过入口按钮）。未激活时零请求、不渲染面板 */
  const [activated, setActivated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  /* 维度清单（用于分组渲染与"全选该维度"） */
  const [elements, setElements] = useState<ElementFromApi[]>([]);
  /* 展开了哪些维度的变体清单 */
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  /* 待生成任务（每个变体一个），权威副本在 jobsRef */
  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [supportsReference, setSupportsReference] = useState<boolean | null>(null);
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [zipping, setZipping] = useState(false);
  const [zipError, setZipError] = useState('');
  /* 竞品原图宽高（后端随清单返回），按它请求画布保证比例。
   * 注意：后端已按 VLM 判断的"印刷图案朝向"校正过——竞品图常是实物摆拍
   * （方形照片里拍竖条形灯笼面板），文件比例 ≠ 图案比例，见后端
   * routers/prompts.py 的 _apply_orientation */
  const [sourceSize, setSourceSize] = useState<{ w: number; h: number } | null>(null);
  /* 图案朝向（portrait/landscape/square），仅用于界面提示画布依据；空=旧规则卡未判断 */
  const [artworkOrientation, setArtworkOrientation] = useState('');

  /* 权威队列在 ref 里——生成循环是跑几分钟的 async 函数，闭包读 state 是旧值
   * （同阶段二批量分析队列的做法，见 CLAUDE.md） */
  const jobsRef = useRef<JobItem[]>([]);
  const stopFlagRef = useRef(false);
  const runningRef = useRef(false);

  /* 纯 props 判断，零请求：没有竞品原图就没法抠（必须把原图作参考图发过去） */
  const hasRuleImage = Boolean(ruleCard?.source_images?.length);

  const writeJobs = useCallback((next: JobItem[]) => {
    jobsRef.current = next;
    setJobs(next);
  }, []);

  const patchJob = useCallback((key: string, patch: Partial<JobItem>) => {
    writeJobs(jobsRef.current.map((j) => (j.key === key ? { ...j, ...patch } : j)));
  }, [writeJobs]);

  /* 点入口按钮：激活 + 首次加载清单与接口能力（只在这里发请求） */
  const handleActivate = async () => {
    setActivated(true);
    if (jobsRef.current.length > 0 || loading) return; // 已加载过，收起再展开不重复请求
    setLoading(true);
    setLoadError('');
    try {
      const [res, supports] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        apiGet<any>(`/api/prompts/elements/${ruleId}`),
        getSupportsReference(),
      ]);
      setSupportsReference(supports);
      const data = unwrapData<{
        elements: ElementFromApi[];
        source_width?: number;
        source_height?: number;
        artwork_orientation?: string;
      }>(res);
      if (data?.source_width && data?.source_height) {
        setSourceSize({ w: data.source_width, h: data.source_height });
      }
      setArtworkOrientation(data?.artwork_orientation || '');
      const els = data?.elements || [];
      setElements(els);
      /* 默认展开"有多个候选"的维度——那才是本功能的主场景；只有 1 个候选的收起 */
      setExpandedKeys(new Set(els.filter((e) => (e.variants || []).length > 1).map((e) => e.element_key)));
      /* 摊平成"每个变体一个任务"。默认全不勾——每个变体一次付费调用 */
      const flat: JobItem[] = [];
      for (const el of els) {
        for (const v of el.variants || []) {
          flat.push({
            key: v.variant_key,
            elementKey: el.element_key,
            elementName: el.name_cn,
            labelCn: v.label_cn,
            labelTranslated: v.label_translated,
            isOriginal: v.is_original,
            prompt: v.prompt,
            checked: false,
            status: 'idle',
            downloadChecked: true,
          });
        }
      }
      writeJobs(flat);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '加载元素清单失败';
      setLoadError(msg);
    } finally {
      setLoading(false);
    }
  };

  /* 生成期间挂 beforeunload 守卫（同阶段二） */
  useEffect(() => {
    if (!running) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      return '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [running]);

  const toggleExpanded = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleChecked = (key: string) => {
    const cur = jobsRef.current.find((j) => j.key === key);
    patchJob(key, { checked: !cur?.checked });
  };

  /* 全选/取消该维度下所有还没生成的变体——本功能最常用的操作
   * （"这个维度的 6 种都出一张"），逐个点太累 */
  const toggleElementAll = (elementKey: string) => {
    const group = jobsRef.current.filter((j) => j.elementKey === elementKey && j.status !== 'done');
    const allChecked = group.length > 0 && group.every((j) => j.checked);
    writeJobs(jobsRef.current.map((j) =>
      j.elementKey === elementKey && j.status !== 'done' ? { ...j, checked: !allChecked } : j
    ));
  };

  const toggleDownloadChecked = (key: string) => {
    const cur = jobsRef.current.find((j) => j.key === key);
    patchJob(key, { downloadChecked: !cur?.downloadChecked });
  };

  const checkedCount = jobs.filter((j) => j.checked && j.status !== 'done').length;
  const doneJobs = jobs.filter((j) => j.status === 'done' && j.imageUrl);
  const zipCount = doneJobs.filter((j) => j.downloadChecked && j.taskId).length;

  /* 串行生成：每个变体一次 submit（同步模式下返回即带图，不用轮询）。
   * 串行而非并发：OpenAI 图片 API 限流严，并发会集体 429（同后端 #8）。 */
  const runQueue = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    stopFlagRef.current = false;
    setStopping(false);
    setRunning(true);
    try {
      for (;;) {
        if (stopFlagRef.current) break;
        const next = jobsRef.current.find((j) => j.status === 'queued');
        if (!next) break;
        patchJob(next.key, { status: 'generating', error: undefined });
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const res = await apiPost<any>('/api/gen/submit', {
            rule_id: ruleId,
            rule_name: ruleCard?.rule_name || '',
            version: 'E',                       // 元素拆分专用标记，生图任务页可按此筛选
            prompt_positive: next.prompt,
            prompt_negative: '',                // 抠取/替换指令自含"擦掉其余"，不需要负向
            /* 按竞品原图比例请求画布（后端 _get_openai_size 映射到 API 支持的档位）。
             * 固定方图会把竖版竞品图挤扁、位置必然错。 */
            width: sourceSize?.w || EXTRACT_SIZE,
            height: sourceSize?.h || EXTRACT_SIZE,
            count: 1,
            attach_rule_image: true,            // 关键：把竞品原图作参考图发过去
            reference_image_paths: [],
          });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const data = unwrapData<any>(res);
          const task = data?.tasks?.[0] || data;
          const tid = task?.task_id || '';
          if (!tid) throw new Error(data?.message || data?.errors || '未返回任务 ID');
          if (task?.status === 'failed') throw new Error(task?.error || '生图失败');
          const url = Array.isArray(task?.image_urls) ? task.image_urls[0] : '';
          patchJob(next.key, {
            status: 'done', taskId: tid, imageUrl: url || undefined, error: undefined,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : '生成失败';
          patchJob(next.key, { status: 'failed', error: msg });
        }
      }
    } finally {
      runningRef.current = false;
      setStopping(false);
      setRunning(false);
    }
  }, [ruleId, ruleCard, patchJob, sourceSize]);

  /* 生成选中变体：勾选项置 queued 后启动队列 */
  const handleGenerate = () => {
    const targets = jobsRef.current.filter((j) => j.checked && j.status !== 'done');
    if (targets.length === 0) return;
    writeJobs(jobsRef.current.map((j) =>
      j.checked && j.status !== 'done' ? { ...j, status: 'queued' as const, error: undefined } : j
    ));
    void runQueue();
  };

  /* 重试单个失败项（队列空闲时可点）——置回 queued 复用同一循环 */
  const handleRetry = (key: string) => {
    if (runningRef.current) return;
    patchJob(key, { status: 'queued', error: undefined });
    void runQueue();
  };

  /* 单张下载：调现有 POST /api/gen/download/{task_id} 取本地可访问路径 */
  const handleDownloadOne = async (job: JobItem) => {
    if (!job.taskId) return;
    patchJob(job.key, { downloading: true });
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await apiPost<any>(`/api/gen/download/${job.taskId}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = unwrapData<any>(res);
      const path = data?.accessible_paths?.[0];
      if (!path) throw new Error('未返回可下载路径');
      const a = document.createElement('a');
      a.href = getImageUrl(path);
      a.download = `${job.elementName}_${job.labelCn}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      patchJob(job.key, { downloading: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '下载失败';
      patchJob(job.key, { downloading: false, error: msg });
    }
  };

  /* 打包下载：POST /api/gen/download-zip 返回**裸 zip 二进制**，
   * 不能用 apiPost（它会 response.json() 直接崩），必须原生 fetch 取 blob */
  const handleDownloadZip = async () => {
    const taskIds = doneJobs.filter((j) => j.downloadChecked && j.taskId).map((j) => j.taskId!);
    if (taskIds.length === 0) return;
    setZipping(true);
    setZipError('');
    let objectUrl = '';
    try {
      const res = await fetch(`${BASE_URL}/api/gen/download-zip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_ids: taskIds }),
      });
      if (!res.ok) {
        throw new Error((await res.text().catch(() => '')) || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `元素变体素材_${ruleId}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '打包下载失败';
      setZipError(msg);
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setZipping(false);
    }
  };

  /* ── 未激活：只渲染入口按钮（零请求、不渲染面板）── */
  if (!activated) {
    return (
      <div className="space-y-1 pt-2 border-t border-codex-border">
        <Button
          variant="secondary"
          size="sm"
          onClick={handleActivate}
          disabled={!hasRuleImage}
          className="w-full"
        >
          🧩 拆分元素变体素材（按需）
        </Button>
        <p className="text-[11px] font-mono text-codex-text-secondary">
          {hasRuleImage
            ? '低频功能：把每个维度的候选变体各抠成一张透明底素材，点击后加载清单'
            : '该规则卡没有竞品原图，无法拆分'}
        </p>
      </div>
    );
  }

  /* ── 已激活：完整面板 ── */
  return (
    <CollapsibleSection
      title="🧩 元素变体素材（衍生）"
      defaultExpanded={true}
      titleColorClass="text-emerald-400"
    >
      <div className="space-y-3">
        {loading && (
          <div className="flex items-center gap-2 py-3">
            <span className="inline-block w-4 h-4 border-2 border-codex-accent border-t-transparent rounded-full animate-spin" />
            <span className="text-sm font-mono text-codex-text-secondary">正在加载元素清单…</span>
          </div>
        )}

        {loadError && (
          <div className="px-3 py-2 bg-red-900/20 border border-codex-danger rounded-md">
            <p className="text-sm font-mono text-codex-danger">❌ {loadError}</p>
          </div>
        )}

        {/* 门控：接口不支持带图 / 清单为空 */}
        {!loading && !loadError && supportsReference === false && (
          <div className="px-3 py-2 bg-yellow-900/20 border border-codex-warning rounded-md">
            <p className="text-sm font-mono text-codex-warning">
              ⚠️ 当前生图接口不支持带参考图（AIReiter 模式），无法拆分元素。
              请到「设置」把生图 API 类型切为 openai 模式后重试。
            </p>
          </div>
        )}
        {!loading && !loadError && supportsReference !== false && elements.length === 0 && (
          <p className="text-sm font-mono text-codex-text-secondary">
            未能从规则卡提取到可拆分元素（第 2/3 层没有可抠取的具体物件）。
          </p>
        )}

        {!loading && !loadError && supportsReference !== false && elements.length > 0 && (
          <>
            {/* 常驻警示条：成本与耗时（Spike 实测 31~48 秒/张） */}
            <div className="px-3 py-2 bg-yellow-900/20 border border-codex-warning/60 rounded-md">
              <p className="text-xs font-mono text-codex-warning leading-relaxed">
                ⚠️ <span className="font-bold">每个勾选的变体各生成一张图</span>（约 1 分钟/张、按张计费），请按需勾选。
                生成期间请勿关闭页面。
                <br />
                输出为<span className="font-bold">透明底 PNG</span>，同一维度下各变体的位置与姿态保持一致，可直接叠换。
                {sourceSize && (
                  <>
                    <br />
                    画布 {sourceSize.w}×{sourceSize.h}
                    {artworkOrientation
                      ? `（按 AI 判断的图案朝向：${
                          artworkOrientation === 'portrait'
                            ? '竖版'
                            : artworkOrientation === 'landscape'
                              ? '横版'
                              : '方形'
                        }）`
                      : '（按竞品原图文件比例；此规则卡分析时未判断图案朝向，重新分析可校正实物摆拍图的比例）'}
                  </>
                )}
              </p>
            </div>

            {/* 维度清单（可展开看候选变体） */}
            <div className="space-y-2">
              {elements.map((el) => {
                const group = jobs.filter((j) => j.elementKey === el.element_key);
                const groupChecked = group.filter((j) => j.checked && j.status !== 'done').length;
                const groupDone = group.filter((j) => j.status === 'done').length;
                const isExpanded = expandedKeys.has(el.element_key);
                const pending = group.filter((j) => j.status !== 'done');
                const allChecked = pending.length > 0 && pending.every((j) => j.checked);
                return (
                  <div key={el.element_key} className="bg-codex-bg border border-codex-border rounded-md overflow-hidden">
                    {/* 维度标题行 */}
                    <div className="flex items-center gap-2 px-2 py-1.5 bg-codex-card/50">
                      <button
                        onClick={() => toggleExpanded(el.element_key)}
                        className="flex items-center gap-1.5 min-w-0 flex-1 cursor-pointer text-left"
                      >
                        <span className={`text-[10px] text-codex-text-secondary transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                          ▼
                        </span>
                        <span className="text-sm font-mono text-codex-text font-medium truncate">
                          {el.name_cn}
                        </span>
                        <span className="text-[11px] font-mono text-codex-text-secondary shrink-0">
                          {(el.variants || []).length} 个候选
                        </span>
                        {el.position && (
                          <span className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-codex-bg text-codex-text-secondary border border-codex-border shrink-0">
                            {el.position}
                          </span>
                        )}
                        {groupDone > 0 && (
                          <span className="text-[10px] font-mono text-codex-success shrink-0">
                            ✅ {groupDone}
                          </span>
                        )}
                      </button>
                      {pending.length > 0 && (
                        <button
                          onClick={() => toggleElementAll(el.element_key)}
                          disabled={running}
                          className="text-[11px] font-mono text-codex-accent hover:underline disabled:opacity-40 cursor-pointer shrink-0"
                        >
                          {allChecked ? '取消全选' : `全选 ${pending.length}`}
                        </button>
                      )}
                      {groupChecked > 0 && (
                        <span className="text-[11px] font-mono text-codex-accent shrink-0">
                          已选 {groupChecked}
                        </span>
                      )}
                    </div>

                    {/* 候选变体清单 */}
                    {isExpanded && (
                      <div className="p-1.5 space-y-1">
                        {group.map((job) => (
                          <label
                            key={job.key}
                            className="flex items-start gap-2 px-1.5 py-1 rounded hover:bg-codex-card/50 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={job.checked}
                              disabled={running || job.status === 'done'}
                              onChange={() => toggleChecked(job.key)}
                              className="mt-0.5 cursor-pointer accent-codex-accent disabled:cursor-not-allowed"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-xs font-mono text-codex-text truncate">
                                  {job.labelCn}
                                  {job.labelTranslated && (
                                    <span className="text-codex-text-secondary">
                                      {`（${job.labelTranslated}）`}
                                    </span>
                                  )}
                                </span>
                                {job.isOriginal && (
                                  <span className="px-1 py-0.5 text-[10px] font-mono rounded bg-codex-border/50 text-codex-text-secondary">
                                    原始
                                  </span>
                                )}
                                {job.status === 'generating' && (
                                  <span className="text-[10px] font-mono text-codex-warning">生成中…</span>
                                )}
                                {job.status === 'queued' && (
                                  <span className="text-[10px] font-mono text-codex-text-secondary">排队中</span>
                                )}
                                {job.status === 'done' && (
                                  <span className="text-[10px] font-mono text-codex-success">✅</span>
                                )}
                              </div>
                              {job.status === 'failed' && (
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] font-mono text-codex-danger truncate" title={job.error}>
                                    ❌ {job.error}
                                  </span>
                                  <button
                                    onClick={(e) => { e.preventDefault(); handleRetry(job.key); }}
                                    disabled={running}
                                    className="text-[10px] font-mono text-codex-accent hover:underline disabled:opacity-40 cursor-pointer shrink-0"
                                  >
                                    🔄 重试
                                  </button>
                                </div>
                              )}
                            </div>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* 生成 / 停止 */}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={handleGenerate}
                loading={running}
                disabled={checkedCount === 0}
              >
                🧩 生成选中变体 ({checkedCount})
              </Button>
              {running && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => { stopFlagRef.current = true; setStopping(true); }}
                  disabled={stopping}
                >
                  {stopping ? '⏹ 停止中（当前张跑完）' : '⏹ 停止'}
                </Button>
              )}
            </div>

            {/* 结果区：按维度分组，object-contain + 棋盘格底衬 */}
            {doneJobs.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-codex-border">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-mono font-bold text-codex-success">
                    📸 已生成 {doneJobs.length} 张
                  </h4>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleDownloadZip}
                    loading={zipping}
                    disabled={zipCount === 0}
                  >
                    📦 打包下载选中 ({zipCount})
                  </Button>
                </div>
                {zipError && <p className="text-xs font-mono text-codex-danger">❌ {zipError}</p>}

                {elements.map((el) => {
                  const groupDone = doneJobs.filter((j) => j.elementKey === el.element_key);
                  if (groupDone.length === 0) return null;
                  return (
                    <div key={el.element_key} className="space-y-1">
                      <p className="text-[11px] font-mono text-codex-text-secondary">
                        {el.name_cn}（{groupDone.length} 张）
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        {groupDone.map((job) => (
                          <div key={job.key} className="bg-codex-bg border border-codex-border rounded-md overflow-hidden">
                            <div
                              className="h-32 flex items-center justify-center cursor-pointer hover:opacity-90 transition-opacity"
                              style={CHECKER_STYLE}
                              onClick={() => setPreviewUrl(job.imageUrl!)}
                              title="点击查看大图（棋盘格处为透明区域）"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={job.imageUrl}
                                alt={`${el.name_cn} ${job.labelCn} 变体素材`}
                                className="max-w-full max-h-32 object-contain"
                              />
                            </div>
                            <div className="p-1.5 space-y-1">
                              <label className="flex items-center gap-1.5 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={job.downloadChecked}
                                  onChange={() => toggleDownloadChecked(job.key)}
                                  className="cursor-pointer accent-codex-accent"
                                />
                                <span
                                  className="text-[11px] font-mono text-codex-text truncate"
                                  title={job.labelTranslated ? `${job.labelCn}（${job.labelTranslated}）` : job.labelCn}
                                >
                                  {job.labelCn}
                                  {job.labelTranslated ? `（${job.labelTranslated}）` : ''}
                                </span>
                              </label>
                              <button
                                onClick={() => handleDownloadOne(job)}
                                disabled={job.downloading}
                                className="w-full px-1 py-0.5 text-[10px] font-mono rounded bg-codex-card text-codex-text-secondary border border-codex-border hover:text-codex-text hover:border-codex-accent transition-colors cursor-pointer disabled:cursor-wait"
                              >
                                {job.downloading ? '⏳ 下载中…' : '⬇ 下载'}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}

                <Link href="/gen" className="text-xs font-mono text-codex-accent hover:underline">
                  → 生图任务页可按「🧩 元素拆分」筛选查看历史
                </Link>
              </div>
            )}
          </>
        )}
      </div>

      {/* 大图预览遮罩 */}
      {previewUrl && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 cursor-pointer"
          onClick={() => setPreviewUrl(null)}
        >
          <div className="relative max-w-[90vw] max-h-[90vh]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt="大图预览"
              className="max-w-full max-h-[85vh] object-contain rounded-lg"
              style={CHECKER_STYLE}
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
    </CollapsibleSection>
  );
}

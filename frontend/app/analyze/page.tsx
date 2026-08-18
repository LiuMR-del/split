'use client';

/**
 * 竞品图分析页面
 * 6 种状态：待上传 → ready（确认图片+填写分析方向） → 分析中 → 分析完成 → 已保存（展开提示词生成） → 错误
 * 保存后不跳转，原地展开提示词生成区域，实现完整流程：
 * 上传 → 分析 → 保存 → 选产品 → 生成提示词 → 生成图片
 *
 * 三期阶段二：新增 batch 态——一次选 2 张以上图片时走批量串行队列
 * （填一次全局 hint → 逐张分析 → 成功自动保存进规则库 → 完成条目收起为紧凑行）。
 * 只选 1 张时仍走上面的单图全流程，一行不改。
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import FileUpload from '@/components/ui/FileUpload';
import Button from '@/components/ui/Button';
import AnalysisProgress from '@/components/analyze/AnalysisProgress';
import RuleCardPreview from '@/components/analyze/RuleCardPreview';
import PromptTabs from '@/components/prompts/PromptTabs';
import { apiUpload, apiPost, getImageUrl, unwrapData } from '@/lib/api';
import Link from 'next/link';

/* 页面状态类型 —— R2 新增 'ready' 中间态：选完文件后先确认图片、填写分析方向再开始分析
 * 三期阶段二新增 'batch'：多图批量队列态 */
type PageState = 'idle' | 'ready' | 'analyzing' | 'done' | 'saved' | 'error' | 'batch';

/* 分析阶段类型 */
type AnalysisStage = 'uploading' | 'grading' | 'extracting' | 'done' | 'error';

/* 三期阶段二：批量队列的单个条目 */
interface BatchItem {
  id: number;                 // 递增序号，React key
  file: File;
  preview: string;            // Object URL（重置时 revoke，沿用单图流程的防泄漏模式）
  status: 'queued' | 'analyzing' | 'saved' | 'failed';
  ruleId?: string;            // 自动保存成功后的规则卡 ID
  ruleName?: string;
  reuseLevel?: string;        // SABC 分级
  error?: string;
}

/* 三期阶段二：单批上限。每张约 1 分钟，10 张已是 10 分钟量级
 * （2026-08-17 用户反馈从 20 调整为 10） */
const BATCH_MAX = 10;

export default function AnalyzePage() {
  const [pageState, setPageState] = useState<PageState>('idle');
  const [stage, setStage] = useState<AnalysisStage>('uploading');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [ruleCard, setRuleCard] = useState<any>(null);
  const [error, setError] = useState<string>('');
  const [saving, setSaving] = useState(false);
  /* 保存后记录 rule_id */
  const [savedRuleId, setSavedRuleId] = useState<string>('');
  /* R2：用户填写的"分析方向/补充说明"，用于人为干预 AI 分析方向（如指定场景/风格） */
  const [analysisHint, setAnalysisHint] = useState<string>('');
  /* R2：暂存用户选择的文件，进入 ready 态后由用户点"开始分析"再上传 */
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  /* #10：分析耗时计时器（pageState='analyzing' 期间每秒更新，显示已等待时长，替代假阶段）*/
  const [elapsed, setElapsed] = useState(0);

  /* ── 三期阶段二：批量队列状态 ── */
  /* batchItems 是渲染用的镜像；**权威队列在 batchItemsRef 里**。
   * 原因：执行循环是一个跑几十分钟的 async 函数，闭包里读 state 永远是启动那一刻的旧值；
   * 而"在 setState 更新函数里 resolve 一个 promise 来取当前值"在 React StrictMode 下
   * （Next.js dev 默认开）会被双调用，属于不纯的更新函数，会取到错乱的值。
   * 所以统一走 ref 读写 + setBatchItems 同步镜像给 UI。 */
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const batchItemsRef = useRef<BatchItem[]>([]);
  const [batchPhase, setBatchPhase] = useState<'ready' | 'running' | 'done'>('ready');
  /* 超选提示（选了超过 BATCH_MAX 张时告知已截断） */
  const [batchNotice, setBatchNotice] = useState('');
  /* 停止队列标记：用 ref 而非 state——同上，长跑循环只有 ref 能读到最新值 */
  const stopFlagRef = useRef(false);
  /* 当前分析中那张的计时（per-item 起算）。startAt 在执行循环里（事件上下文）设置，
   * effect 只负责起 interval——不在 effect 体里同步 setState，避免级联渲染 */
  const [itemElapsed, setItemElapsed] = useState(0);
  const [itemStartAt, setItemStartAt] = useState<number | null>(null);
  /* 防止重复启动执行循环（用户连点"开始"） */
  const runningRef = useRef(false);
  /* 已点过"停止队列"（ref 不能在渲染期读，按钮禁用态要用 state） */
  const [stopping, setStopping] = useState(false);

  /* 唯一的队列写入口：改 ref（权威）+ 同步一份新数组给 state（触发渲染） */
  const writeBatchItems = useCallback((next: BatchItem[]) => {
    batchItemsRef.current = next;
    setBatchItems(next);
  }, []);

  /* 改某一项的字段（合并式） */
  const patchBatchItem = useCallback((id: number, patch: Partial<BatchItem>) => {
    writeBatchItems(
      batchItemsRef.current.map((i) => (i.id === id ? { ...i, ...patch } : i))
    );
  }, [writeBatchItems]);

  useEffect(() => {
    if (pageState !== 'analyzing') return;
    const startT = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startT) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [pageState]);

  /* 三期阶段二：批量运行期间挂 beforeunload 守卫——队列在浏览器侧，
   * 关掉标签页队列就没了（已保存的不受影响），离开前给用户一次确认机会 */
  useEffect(() => {
    if (batchPhase !== 'running') return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      return '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [batchPhase]);

  /* 三期阶段二：当前分析中条目的计时器。itemStartAt 由执行循环在开始一张时设置，
   * 这里只起 interval 更新显示（effect 体内不同步 setState） */
  useEffect(() => {
    if (itemStartAt === null) return;
    const timer = setInterval(
      () => setItemElapsed(Math.floor((Date.now() - itemStartAt) / 1000)),
      1000
    );
    return () => clearInterval(timer);
  }, [itemStartAt]);

  /* 三期阶段二：批量进度计数（渲染用） */
  const savedCount = batchItems.filter((i) => i.status === 'saved').length;
  const failedCount = batchItems.filter((i) => i.status === 'failed').length;
  const queuedCount = batchItems.filter((i) => i.status === 'queued').length;

  /*
   * 处理文件选择：R2 需求——选完文件不再立即分析，而是暂存文件 + 生成预览 + 进入 ready 态，
   * 让用户先填写"分析方向/补充说明"来人为干预 AI 分析方向。
   * 原 FormData 构建与 apiUpload 调用逻辑搬到下方 handleStartAnalysis。
   */
  const handleFileSelect = useCallback((file: File) => {
    /* R2：替换预览前先释放旧的 Object URL，避免反复选图导致内存泄漏 */
    setImagePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    setSelectedFile(file);
    setPageState('ready');
    setError('');
  }, []);

  /*
   * 三期阶段二：用一组文件构建批量队列（≥2 张时的公共入口，
   * 供"一次选多张"和"单图 ready 态追加后转批量"共用）。
   */
  const buildBatch = useCallback((files: File[]) => {
    const kept = files.slice(0, BATCH_MAX);
    setBatchNotice(
      files.length > BATCH_MAX
        ? `单批最多 ${BATCH_MAX} 张，已保留前 ${BATCH_MAX} 张（其余 ${files.length - BATCH_MAX} 张请下一批再传）`
        : ''
    );
    writeBatchItems(
      kept.map((file, idx) => ({
        id: idx,
        file,
        preview: URL.createObjectURL(file),
        status: 'queued' as const,
      }))
    );
    stopFlagRef.current = false;
    setStopping(false);
    setBatchPhase('ready');
    setPageState('batch');
    setError('');
  }, [writeBatchItems]);

  /*
   * 三期阶段二：入口分流。FileUpload 多选模式一次回调本次选择的全部图片。
   * 只选 1 张 → 走上面的单图全流程（预览确认 → 分析 → 人工预览 → 手动保存 → 原地生成提示词），
   * 一行不改；选 2 张以上 → 进批量队列态。
   */
  const handleFilesSelect = useCallback((files: File[]) => {
    if (files.length === 0) return;
    if (files.length === 1) {
      handleFileSelect(files[0]);
      return;
    }
    buildBatch(files);
  }, [handleFileSelect, buildBatch]);

  /*
   * 三期阶段二（2026-08-17 用户反馈补充）：批量态下继续追加图片。
   * 追加进现有队列（不清空已有条目），status='queued'。
   * 队列执行循环每轮都重新从 batchItemsRef 里找 queued 项，所以运行期间追加也会被自动接上跑。
   * ID 用"现有最大值 +1"生成，不能用数组长度——删掉中间某项后长度会与已存在的 id 撞车。
   */
  const handleAppendFiles = useCallback((files: File[]) => {
    if (files.length === 0) return;
    const current = batchItemsRef.current;
    const room = BATCH_MAX - current.length;
    if (room <= 0) {
      setBatchNotice(`已达单批上限 ${BATCH_MAX} 张，请先处理完这一批（或点"再来一批"重新开始）`);
      return;
    }
    const kept = files.slice(0, room);
    setBatchNotice(
      files.length > room
        ? `单批最多 ${BATCH_MAX} 张，本次只添加了 ${kept.length} 张（其余 ${files.length - kept.length} 张请下一批再传）`
        : ''
    );
    const nextId = current.reduce((max, i) => Math.max(max, i.id), -1) + 1;
    writeBatchItems([
      ...current,
      ...kept.map((file, k) => ({
        id: nextId + k,
        file,
        preview: URL.createObjectURL(file),
        status: 'queued' as const,
      })),
    ]);
  }, [writeBatchItems]);

  /* 三期阶段二（2026-08-17 补充）：移除批量队列里某一项（只允许移除还没跑的 queued 项）。
   * 有了"继续添加"就必须能删——否则误加一张图只能整批重来。 */
  const handleRemoveItem = useCallback((id: number) => {
    const target = batchItemsRef.current.find((i) => i.id === id);
    if (!target || target.status !== 'queued') return;
    URL.revokeObjectURL(target.preview);
    writeBatchItems(batchItemsRef.current.filter((i) => i.id !== id));
  }, [writeBatchItems]);

  /*
   * 三期阶段二（2026-08-17 补充）：单图 ready 态下继续添加图片 → 转为批量模式。
   * 原来选完 1 张就只能"开始分析"或"重新选择"，想再加图必须重选全部，这里补上入口。
   */
  const handleAddFromReady = useCallback((files: File[]) => {
    if (!selectedFile || files.length === 0) return;
    /* 释放单图态的预览 URL（批量态会为每个文件重新创建），避免泄漏 */
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImagePreview(null);
    setSelectedFile(null);
    buildBatch([selectedFile, ...files]);
  }, [selectedFile, imagePreview, buildBatch]);
  /*
   * 开始分析：R2 需求——带上用户填写的 hint 调用分析接口，
   * 让用户能人为干预 AI 的分析方向（如重点关注某场景/风格）。
   * 不填 hint 时 FormData 不含 hint 字段，后端默认空串，行为与改造前一致。
   */
  const handleStartAnalysis = useCallback(async () => {
    if (!selectedFile) return;
    setPageState('analyzing');
    setStage('uploading');
    setError('');

    try {
      /* 构建 FormData：file 必带，hint 选填（空串不 append，行为同原逻辑） */
      const formData = new FormData();
      formData.append('file', selectedFile);
      if (analysisHint.trim()) {
        formData.append('hint', analysisHint.trim());
      }

      /* 模拟阶段进度 - 上传中 */
      setStage('uploading');

      /* 调用分析 API */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await apiUpload<any>('/api/analyze', formData);

      /* #10：删返回后假阶段（grading/extracting + 500ms setTimeout）--真实分析在 apiUpload
       * 阻塞期间（stage='uploading'，约 30-60s），返回后直接 done，不再放假跳跃。
       * 计时器在 useEffect 里按 pageState='analyzing' 启动，显示已等待时长。 */

      /* 兼容两种后端返回格式：
       * 1. { success: true, data: { rule_card: {...}, ... } }
       * 2. 直接返回 { rule_card: {...}, ... } */
      const data = unwrapData<any>(response);
      const card = data?.rule_card || data;

      if (card && typeof card === 'object' && !card.parse_error) {
        setRuleCard(card);
        /* 构建服务器端图片 URL */
        if (data?.uploaded_image) {
          setUploadedImageUrl(getImageUrl(data.uploaded_image));
        }
        setStage('done');
        setPageState('done');
      } else {
        throw new Error(response?.message || card?.parse_error || '分析失败');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '分析失败，请重试';
      setError(msg);
      setStage('error');
      setPageState('error');
    }
  }, [selectedFile, analysisHint]);

  /*
   * 三期阶段二：批量串行执行循环。
   *
   * 必须串行（并发=1）：后端 ImageAnalyzer.analyze 内部已是 2 路 VLM 并行
   * （SABC 分级 + 6 层拆解 asyncio.gather），前端再并发会叠成 4~6 路，
   * 容易撞上游限流。这是本阶段的固定决策，不做并发开关。
   *
   * 循环语义是"处理所有 queued 项"，所以重试只需把某项置回 queued 再启动本函数，
   * 不用另写一套重试逻辑。
   */
  const runBatchQueue = useCallback(async () => {
    if (runningRef.current) return; // 防连点重复启动
    runningRef.current = true;
    stopFlagRef.current = false;
    setStopping(false);
    setBatchPhase('running');
    const hint = analysisHint.trim();

    try {
      /* 每轮重新从 ref 里捞下一个 queued 项——不能一次性快照列表，
       * 因为重试会在循环外把某项置回 queued */
      for (;;) {
        if (stopFlagRef.current) break;
        const next = batchItemsRef.current.find((i) => i.status === 'queued');
        if (!next) break;
        patchBatchItem(next.id, { status: 'analyzing', error: undefined });
        /* 本张的计时起点（在事件上下文里设，effect 只负责起 interval） */
        setItemElapsed(0);
        setItemStartAt(Date.now());

        try {
          const formData = new FormData();
          formData.append('file', next.file);
          if (hint) formData.append('hint', hint);

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const res = await apiUpload<any>('/api/analyze', formData);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const data = unwrapData<any>(res);
          const card = data?.rule_card || data;
          if (!card || typeof card !== 'object' || card.parse_error) {
            throw new Error(card?.parse_error || res?.message || '分析失败');
          }

          /* 决策点 4：分析成功自动保存进规则库（字段拼装与单图 handleSave 完全同款）。
           * 后端 create_rule 有 #25 的 ID 撞车重分配保护，串行保存无并发风险，
           * 但要用返回的 rule_id（可能被重分配过）而不是 card 里的预生成值。 */
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const saveRes = await apiPost<any>('/api/rules', {
            ...card,
            thumbnail_path: getImageUrl(data?.uploaded_image) || '',
          });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const saved = unwrapData<any>(saveRes);

          patchBatchItem(next.id, {
            status: 'saved',
            ruleId: saved?.rule_id || card.rule_id || '',
            ruleName: card.rule_name || '',
            reuseLevel: card.reuse_level || card.layer_5_validation?.reuse_level || '',
            error: undefined,
          });
        } catch (err) {
          /* 单张失败不阻塞队列，标记后继续下一张 */
          const msg = err instanceof Error ? err.message : '分析失败';
          patchBatchItem(next.id, { status: 'failed', error: msg });
        }
      }
    } finally {
      runningRef.current = false;
      setItemStartAt(null); // 停掉计时器
      setStopping(false);
      setBatchPhase('done');
    }
  }, [analysisHint, patchBatchItem]);

  /* 三期阶段二：重试单张失败项——置回 queued 后复用同一个执行循环
   * （循环语义就是"处理所有 queued 项"，天然支持重试，不用另写一套） */
  const handleRetryItem = useCallback((id: number) => {
    if (runningRef.current) return;
    patchBatchItem(id, { status: 'queued', error: undefined });
    void runBatchQueue();
  }, [patchBatchItem, runBatchQueue]);

  /* 三期阶段二：停止队列——当前这张跑完后停，剩余保持 queued 可继续 */
  const handleStopBatch = () => {
    stopFlagRef.current = true;
    setStopping(true);
  };

  /* 三期阶段二：清空批量、回到待上传态（释放全部 Object URL 防泄漏） */
  const handleResetBatch = () => {
    batchItemsRef.current.forEach((i) => URL.revokeObjectURL(i.preview));
    writeBatchItems([]);
    setBatchPhase('ready');
    setBatchNotice('');
    setAnalysisHint('');
    stopFlagRef.current = false;
    setStopping(false);
    setItemStartAt(null);
    setPageState('idle');
  };

  /* 保存到规则库（不跳转，原地进入 saved 状态） */
  const handleSave = async () => {
    if (!ruleCard) return;
    setSaving(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      /* #12：把竞品图 URL 作为 thumbnail_path 随 RuleCard 传后端，规则库列表显示缩略图 */
      const res = await apiPost<any>('/api/rules', { ...ruleCard, thumbnail_path: uploadedImageUrl || '' });
      /* 从后端返回中获取 rule_id */
      const savedData = unwrapData<any>(res);
      const ruleId = savedData?.rule_id || ruleCard?.rule_id || '';
      setSavedRuleId(ruleId);
      setPageState('saved');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '保存失败';
      setError(msg);
      alert('保存失败: ' + msg);
    } finally {
      setSaving(false);
    }
  };

  /* 放弃并重置：R2 新增清空 hint 与暂存文件，回到 idle 态 */
  const handleDiscard = () => {
    /* R2：释放预览的 Object URL，避免内存泄漏 */
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setPageState('idle');
    setStage('uploading');
    setImagePreview(null);
    setUploadedImageUrl(null);
    setRuleCard(null);
    setError('');
    setSavedRuleId('');
    setAnalysisHint('');
    setSelectedFile(null);
  };

  /* 重试 */
  const handleRetry = () => {
    handleDiscard();
  };

  return (
    <div className="p-6 md:p-8 max-w-screen-2xl mx-auto">
      {/* 页面标题 */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/"
          className="text-codex-text-secondary hover:text-codex-text font-mono text-sm transition-colors"
        >
          ← 返回
        </Link>
        <h1 className="text-2xl font-mono font-bold text-codex-text">
          📸 分析竞品图
        </h1>
      </div>

      {/* 状态 1：待上传。三期阶段二：开启多选，一次选 1 张走单图流程、≥2 张进批量队列 */}
      {pageState === 'idle' && (
        <div className="max-w-xl mx-auto">
          <FileUpload multiple onFilesSelect={handleFilesSelect} />
          <p className="text-sm text-codex-text-secondary font-mono text-center mt-4">
            上传竞品产品图，AI 将自动分析并生成 6 层规则卡
          </p>
          <p className="text-xs text-codex-text-secondary font-mono text-center mt-1">
            一次选多张（最多 {BATCH_MAX} 张）将进入批量模式：填一次分析方向，逐张分析并自动存入规则库
          </p>
        </div>
      )}

      {/* 状态 7（三期阶段二）：批量队列 */}
      {pageState === 'batch' && (
        <div className="max-w-3xl mx-auto space-y-4">
          {/* 超选截断提示 */}
          {batchNotice && (
            <div className="px-4 py-2 bg-yellow-900/20 border border-codex-warning rounded-md">
              <p className="text-sm font-mono text-codex-warning">⚠️ {batchNotice}</p>
            </div>
          )}

          {/* 顶部进度统计 + 操作 */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-codex-card border border-codex-border rounded-lg">
            <div className="text-sm font-mono text-codex-text">
              📦 批量分析
              <span className="text-codex-text-secondary ml-2">
                共 {batchItems.length} 张 · ✅ 已完成 {savedCount} · ❌ 失败 {failedCount}
                {queuedCount > 0 && ` · ⏳ 排队 ${queuedCount}`}
              </span>
            </div>
            <div className="flex gap-2">
              {batchPhase === 'running' ? (
                <Button variant="secondary" size="sm" onClick={handleStopBatch} disabled={stopping}>
                  {stopping ? '⏹ 停止中（当前这张跑完）' : '⏹ 停止队列'}
                </Button>
              ) : (
                <>
                  {queuedCount > 0 && (
                    <Button variant="primary" size="sm" onClick={() => void runBatchQueue()}>
                      {batchPhase === 'ready' ? `▶ 开始批量分析 (${queuedCount} 张)` : `▶ 继续 (${queuedCount} 张)`}
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={handleResetBatch}>
                    {batchPhase === 'ready' ? '重新选择' : '🔄 再来一批'}
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* 运行中警示：队列在浏览器侧，关页面就没了 */}
          {batchPhase === 'running' && (
            <p className="text-xs font-mono text-codex-danger">
              ⚠️ 批量分析进行中，请勿关闭本页（每张约 1 分钟，串行执行）
            </p>
          )}

          {/* ready 态：缩略图网格 + 继续添加 + 一次性填写全局 hint */}
          {batchPhase === 'ready' && (
            <>
              <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
                {batchItems.map((item) => (
                  <div key={item.id} className="space-y-1">
                    <div className="relative border border-codex-border rounded-md overflow-hidden bg-codex-card group">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={item.preview} alt={item.file.name} className="w-full h-20 object-cover" />
                      {/* 移除按钮（误加时不用整批重来） */}
                      <button
                        onClick={() => handleRemoveItem(item.id)}
                        className="absolute top-0.5 right-0.5 w-5 h-5 flex items-center justify-center rounded-full bg-black/60 text-white text-xs hover:bg-codex-danger transition-colors cursor-pointer"
                        title="移除这张"
                      >
                        ✕
                      </button>
                    </div>
                    <p className="text-[10px] font-mono text-codex-text-secondary truncate" title={item.file.name}>
                      {item.file.name}
                    </p>
                  </div>
                ))}
              </div>

              {/* 继续添加图片（还没到上限时显示） */}
              {batchItems.length < BATCH_MAX ? (
                <div className="space-y-1">
                  <p className="text-xs font-mono text-codex-text-secondary">
                    ➕ 继续添加图片（还可添加 {BATCH_MAX - batchItems.length} 张）
                  </p>
                  <FileUpload multiple onFilesSelect={handleAppendFiles} />
                </div>
              ) : (
                <p className="text-xs font-mono text-codex-warning">
                  ⚠️ 已达单批上限 {BATCH_MAX} 张
                </p>
              )}

              <div>
                <label className="block text-sm font-mono text-codex-text mb-2">
                  分析方向/补充说明（选填，将应用到本批所有图片）
                </label>
                <textarea
                  rows={3}
                  maxLength={1000}
                  value={analysisHint}
                  onChange={(e) => setAnalysisHint(e.target.value)}
                  placeholder="例如：重点关注母亲节送礼场景 / 儿童房装饰风格"
                  className="w-full px-3 py-2 bg-codex-bg border border-codex-border rounded-md text-codex-text font-mono text-sm placeholder:text-codex-text-secondary focus:outline-none focus:border-codex-accent resize-y"
                />
                <p className="text-xs text-codex-text-secondary font-mono mt-1">
                  不填则 AI 自主判断分析方向 · {analysisHint.length}/1000
                </p>
              </div>
            </>
          )}

          {/* running / done 态：逐张状态列表（完成即收起为紧凑行） */}
          {batchPhase !== 'ready' && (
            <div className="space-y-2">
              {batchItems.map((item) => {
                /* 分析中：展开卡（大缩略图 + spinner + 计时） */
                if (item.status === 'analyzing') {
                  return (
                    <div
                      key={item.id}
                      className="flex items-center gap-4 p-3 bg-codex-card border border-codex-accent rounded-lg"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.preview}
                        alt={item.file.name}
                        className="w-20 h-20 rounded object-cover border border-codex-border shrink-0"
                      />
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="text-sm font-mono text-codex-text truncate" title={item.file.name}>
                          {item.file.name}
                        </p>
                        <div className="flex items-center gap-2 text-sm font-mono text-codex-warning">
                          <span className="inline-block w-4 h-4 border-2 border-codex-warning border-t-transparent rounded-full animate-spin" />
                          <span>分析中… 已等待 {itemElapsed}s（约 1 分钟）</span>
                        </div>
                      </div>
                    </div>
                  );
                }

                /* 排队中：置灰单行 */
                if (item.status === 'queued') {
                  return (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 px-3 py-2 bg-codex-card/50 border border-codex-border rounded-md opacity-60"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={item.preview} alt="" className="w-6 h-6 rounded object-cover shrink-0" />
                      <span className="text-xs font-mono text-codex-text-secondary truncate flex-1" title={item.file.name}>
                        {item.file.name}
                      </span>
                      <span className="text-xs font-mono text-codex-text-secondary shrink-0">排队中</span>
                    </div>
                  );
                }

                /* 失败：单行 + 原因 + 重试 */
                if (item.status === 'failed') {
                  return (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 px-3 py-2 bg-red-900/10 border border-codex-danger/50 rounded-md"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={item.preview} alt="" className="w-6 h-6 rounded object-cover shrink-0" />
                      <span className="text-xs font-mono text-codex-text truncate max-w-[10rem]" title={item.file.name}>
                        {item.file.name}
                      </span>
                      <span
                        className="text-xs font-mono text-codex-danger truncate flex-1 min-w-0"
                        title={item.error}
                      >
                        ❌ {item.error}
                      </span>
                      <button
                        onClick={() => handleRetryItem(item.id)}
                        disabled={batchPhase === 'running'}
                        className="text-xs font-mono text-codex-accent hover:underline disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shrink-0"
                      >
                        🔄 重试
                      </button>
                    </div>
                  );
                }

                /* 已保存：紧凑行（决策点 4：完成即收起） */
                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 px-3 py-2 bg-green-900/10 border border-codex-success/40 rounded-md"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.preview} alt="" className="w-6 h-6 rounded object-cover shrink-0" />
                    <span className="text-xs font-mono text-codex-text-secondary truncate max-w-[9rem]" title={item.file.name}>
                      {item.file.name}
                    </span>
                    <span className="text-xs font-mono text-codex-text-secondary shrink-0">→</span>
                    <span className="text-xs font-mono text-codex-success truncate flex-1 min-w-0" title={item.ruleName}>
                      {item.ruleName || item.ruleId}
                    </span>
                    {item.reuseLevel && (
                      <span className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-codex-accent/20 text-codex-accent border border-codex-accent/40 shrink-0">
                        {item.reuseLevel} 级
                      </span>
                    )}
                    {item.ruleId && (
                      <Link
                        href={`/rules/${item.ruleId}`}
                        target="_blank"
                        className="text-xs font-mono text-codex-accent hover:underline shrink-0"
                      >
                        📝 去编辑
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* done 态汇总条 */}
          {batchPhase === 'done' && queuedCount === 0 && (
            <div className="px-4 py-3 bg-codex-card border border-codex-border rounded-lg space-y-2">
              <p className="text-sm font-mono text-codex-text">
                ✅ 成功 {savedCount} 张已存入规则库
                {failedCount > 0 && <span className="text-codex-danger">，❌ 失败 {failedCount} 张（可单独重试）</span>}
              </p>
              <Link href="/rules" className="text-sm font-mono text-codex-accent hover:underline">
                📋 查看规则库
              </Link>
            </div>
          )}

          {/* running / done 态也能继续添加：队列执行循环每轮重新找 queued 项，
              所以运行中追加的图会被自动接上跑；已停止/已完成时追加后点"继续"即可 */}
          {batchPhase !== 'ready' && batchItems.length < BATCH_MAX && (
            <div className="space-y-1 pt-2 border-t border-codex-border">
              <p className="text-xs font-mono text-codex-text-secondary">
                ➕ 继续添加图片（还可添加 {BATCH_MAX - batchItems.length} 张）
                {batchPhase === 'running' && ' · 运行中添加会自动排到队尾'}
              </p>
              <FileUpload multiple onFilesSelect={handleAppendFiles} />
            </div>
          )}
        </div>
      )}

      {/* 状态 2：ready —— R2 新增：确认图片 + 填写分析方向后再开始分析 */}
      {pageState === 'ready' && (
        <div className="flex flex-col md:flex-row gap-8 items-start">
          {/* 左侧：图片预览 */}
          <div className="w-full md:w-64 flex-shrink-0">
            <div className="border border-codex-border rounded-lg overflow-hidden bg-codex-card">
              {imagePreview && (
                <img
                  src={imagePreview}
                  alt="上传图片"
                  className="w-full h-auto object-contain"
                />
              )}
            </div>
          </div>
          {/* 右侧：分析方向输入 + 操作按钮 */}
          <div className="flex-1 min-w-0 space-y-4">
            <div>
              <label className="block text-sm font-mono text-codex-text mb-2">
                分析方向/补充说明（选填）
              </label>
              <textarea
                rows={4}
                maxLength={1000}
                value={analysisHint}
                onChange={(e) => setAnalysisHint(e.target.value)}
                placeholder="例如：重点关注母亲节送礼场景 / 儿童房装饰风格"
                className="w-full px-3 py-2 bg-codex-bg border border-codex-border rounded-md text-codex-text font-mono text-sm placeholder:text-codex-text-secondary focus:outline-none focus:border-codex-accent resize-y"
              />
              <p className="text-xs text-codex-text-secondary font-mono mt-1">
                不填则 AI 自主判断分析方向 · {analysisHint.length}/1000
              </p>
            </div>
            <div className="flex gap-3">
              <Button variant="primary" onClick={handleStartAnalysis} disabled={!selectedFile}>
                开始分析
              </Button>
              <Button variant="ghost" onClick={handleDiscard}>
                重新选择
              </Button>
            </div>

            {/* 三期阶段二（2026-08-17 补充）：这里也能继续加图 → 自动转批量模式，
                不用为了多传一张而整个重选 */}
            <div className="space-y-1 pt-3 border-t border-codex-border">
              <p className="text-xs font-mono text-codex-text-secondary">
                ➕ 还要分析更多图？在这里继续添加，将自动转为批量模式（最多 {BATCH_MAX} 张）
              </p>
              <FileUpload multiple onFilesSelect={handleAddFromReady} />
            </div>
          </div>
        </div>
      )}

      {/* 状态 3：分析中 */}
      {pageState === 'analyzing' && (
        <div className="flex flex-col md:flex-row gap-8 items-start">
          {/* 左侧：图片缩略图 */}
          {imagePreview && (
            <div className="w-full md:w-48 flex-shrink-0">
              <div className="border border-codex-border rounded-lg overflow-hidden bg-codex-card">
                <img
                  src={imagePreview}
                  alt="上传图片"
                  className="w-full h-auto object-contain"
                />
              </div>
            </div>
          )}
          {/* 右侧：进度指示 */}
          <div className="flex-1 flex flex-col items-center justify-center py-12 gap-3">
            <AnalysisProgress stage={stage} error={error} />
            {/* #10：真实计时器，替代返回后的假阶段 */}
            {stage === 'uploading' && (
              <p className="text-xs font-mono text-codex-text-secondary">
                已等待 {elapsed}s（分级 + 6 层拆解，约 1 分钟）
              </p>
            )}
          </div>
        </div>
      )}

      {/* 状态 4：分析完成 */}
      {pageState === 'done' && ruleCard && (
        <div className="flex flex-col lg:flex-row gap-8 items-start">
          {/* 左侧：图片 */}
          <div className="w-full lg:w-64 flex-shrink-0">
            <div className="border border-codex-border rounded-lg overflow-hidden bg-codex-card sticky top-8">
              <img
                src={uploadedImageUrl || imagePreview || ''}
                alt="分析图片"
                className="w-full h-auto object-contain"
              />
            </div>
          </div>
          {/* 右侧：规则卡预览 */}
          <div className="flex-1 min-w-0">
            <RuleCardPreview
              ruleCard={ruleCard}
              onSave={handleSave}
              onDiscard={handleDiscard}
            />
            {saving && (
              <p className="text-sm text-codex-accent font-mono mt-2">保存中...</p>
            )}
          </div>
        </div>
      )}

      {/* 状态 5：已保存 —— 原地展开提示词生成区域 */}
      {pageState === 'saved' && ruleCard && (
        <div className="space-y-6">
          {/* 成功消息 + 导航链接 */}
          <div className="bg-green-900/20 border border-codex-success rounded-lg p-4">
            <p className="text-sm font-mono text-codex-success mb-3">
              ✅ 规则卡已保存（{savedRuleId}）
            </p>
            <div className="flex gap-4">
              <Link
                href="/rules"
                className="text-sm font-mono text-codex-accent hover:text-codex-accent/80 transition-colors underline"
              >
                📋 查看规则库
              </Link>
              {savedRuleId && (
                <Link
                  href={`/rules/${savedRuleId}`}
                  className="text-sm font-mono text-codex-accent hover:text-codex-accent/80 transition-colors underline"
                >
                  📝 编辑规则卡
                </Link>
              )}
            </div>
          </div>

          {/* 提示词生成区域 — Tab 切换 */}
          <div>
            <h2 className="text-lg font-mono font-bold text-codex-text mb-4">
              🎨 生成提示词
            </h2>
            <PromptTabs ruleId={savedRuleId} ruleCard={ruleCard} />
          </div>

          {/* 底部：重新分析按钮 */}
          <div className="pt-4 border-t border-codex-border">
            <Button variant="ghost" onClick={handleDiscard}>
              🔄 重新分析另一张图
            </Button>
          </div>
        </div>
      )}

      {/* 状态 6：错误 */}
      {pageState === 'error' && (
        <div className="max-w-md mx-auto text-center py-12">
          <div className="bg-red-900/20 border border-codex-danger rounded-lg p-6 mb-4">
            <span className="text-3xl block mb-3">❌</span>
            <p className="text-sm text-codex-danger font-mono">{error}</p>
          </div>
          <Button onClick={handleRetry} variant="secondary">
            🔄 重试
          </Button>
        </div>
      )}
    </div>
  );
}

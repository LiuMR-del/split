'use client';

/**
 * 竞品图分析页面
 * 6 种状态：待上传 → ready（确认图片+填写分析方向） → 分析中 → 分析完成 → 已保存（展开提示词生成） → 错误
 * 保存后不跳转，原地展开提示词生成区域，实现完整流程：
 * 上传 → 分析 → 保存 → 选产品 → 生成提示词 → 生成图片
 */

import { useState, useCallback, useEffect } from 'react';
import FileUpload from '@/components/ui/FileUpload';
import Button from '@/components/ui/Button';
import AnalysisProgress from '@/components/analyze/AnalysisProgress';
import RuleCardPreview from '@/components/analyze/RuleCardPreview';
import PromptTabs from '@/components/prompts/PromptTabs';
import { apiUpload, apiPost, getImageUrl, unwrapData } from '@/lib/api';
import Link from 'next/link';

/* 页面状态类型 —— R2 新增 'ready' 中间态：选完文件后先确认图片、填写分析方向再开始分析 */
type PageState = 'idle' | 'ready' | 'analyzing' | 'done' | 'saved' | 'error';

/* 分析阶段类型 */
type AnalysisStage = 'uploading' | 'grading' | 'extracting' | 'done' | 'error';

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

  useEffect(() => {
    if (pageState !== 'analyzing') return;
    const startT = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startT) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [pageState]);

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

      {/* 状态 1：待上传 */}
      {pageState === 'idle' && (
        <div className="max-w-xl mx-auto">
          <FileUpload onFileSelect={handleFileSelect} />
          <p className="text-sm text-codex-text-secondary font-mono text-center mt-4">
            上传竞品产品图，AI 将自动分析并生成 6 层规则卡
          </p>
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

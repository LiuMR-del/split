'use client';

/**
 * 竞品图分析页面
 * 5 种状态：待上传 → 分析中 → 分析完成 → 已保存（展开提示词生成） → 错误
 * 保存后不跳转，原地展开提示词生成区域，实现完整流程：
 * 上传 → 分析 → 保存 → 选产品 → 生成提示词 → 生成图片
 */

import { useState, useCallback } from 'react';
import FileUpload from '@/components/ui/FileUpload';
import Button from '@/components/ui/Button';
import AnalysisProgress from '@/components/analyze/AnalysisProgress';
import RuleCardPreview from '@/components/analyze/RuleCardPreview';
import PromptTabs from '@/components/prompts/PromptTabs';
import { apiUpload, apiPost, getImageUrl, unwrapData } from '@/lib/api';
import Link from 'next/link';

/* 页面状态类型 */
type PageState = 'idle' | 'analyzing' | 'done' | 'saved' | 'error';

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

  /* 处理文件选择并开始分析 */
  const handleFileSelect = useCallback(async (file: File) => {
    /* 生成本地预览 */
    const preview = URL.createObjectURL(file);
    setImagePreview(preview);
    setPageState('analyzing');
    setStage('uploading');
    setError('');

    try {
      /* 构建 FormData */
      const formData = new FormData();
      formData.append('file', file);

      /* 模拟阶段进度 - 上传中 */
      setStage('uploading');

      /* 调用分析 API */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await apiUpload<any>('/api/analyze', formData);

      /* 分析中 - 分级 */
      setStage('grading');
      /* 短暂延迟让用户看到分级状态 */
      await new Promise(r => setTimeout(r, 500));

      /* 分析中 - 拆解 */
      setStage('extracting');
      await new Promise(r => setTimeout(r, 500));

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
  }, []);

  /* 保存到规则库（不跳转，原地进入 saved 状态） */
  const handleSave = async () => {
    if (!ruleCard) return;
    setSaving(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await apiPost<any>('/api/rules', ruleCard);
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

  /* 放弃并重置 */
  const handleDiscard = () => {
    setPageState('idle');
    setStage('uploading');
    setImagePreview(null);
    setUploadedImageUrl(null);
    setRuleCard(null);
    setError('');
    setSavedRuleId('');
  };

  /* 重试 */
  const handleRetry = () => {
    handleDiscard();
  };

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto">
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

      {/* 状态 2：分析中 */}
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
          <div className="flex-1 flex items-center justify-center py-12">
            <AnalysisProgress stage={stage} error={error} />
          </div>
        </div>
      )}

      {/* 状态 3：分析完成 */}
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

      {/* 状态 4：已保存 —— 原地展开提示词生成区域 */}
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

      {/* 状态 5：错误 */}
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

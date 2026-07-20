'use client';

/**
 * 规则卡详情页
 * 动态路由 /rules/[id]
 * Tab 切换：编辑规则卡 / 生成提示词
 */

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiGet, apiPut, unwrapData } from '@/lib/api';
import Button from '@/components/ui/Button';
import RuleCardEditor from '@/components/rules/RuleCardEditor';
import PromptTabs from '@/components/prompts/PromptTabs';
import Link from 'next/link';

/* Tab 类型 */
type TabType = 'edit' | 'prompt';

export default function RuleDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  // 保留 router 以便后续使用
  void router;
  const ruleId = params.id;

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const [ruleCard, setRuleCard] = useState<any>(null);
  const [vocabularies, setVocabularies] = useState<any>(null);
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ success: boolean; message: string } | null>(null);

  /* 当前 Tab */
  const [activeTab, setActiveTab] = useState<TabType>('edit');

  /* 加载数据 */
  useEffect(() => {
    async function loadData() {
      try {
        /* 并行获取规则卡和词表 */
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [ruleRes, vocabRes] = await Promise.all([
          apiGet<any>(`/api/rules/${ruleId}`),
          apiGet('/api/vocabularies'),
        ]);
        // GET /api/rules/{id} 返回 {"success": true, "data": {...}}，提取实际数据
        setRuleCard(unwrapData(ruleRes));
        // GET /api/vocabularies 直接返回 {target_audience: [...], ...}（无 {success, data} 包装）
        setVocabularies(vocabRes);
      } catch (err) {
        const msg = err instanceof Error ? err.message : '加载失败';
        setError(msg);
      } finally {
        setLoading(false);
      }
    }
    if (ruleId) {
      loadData();
    }
  }, [ruleId]);

  /* 保存修改 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleSave = async (data: any) => {
    setSaving(true);
    setSaveResult(null);
    try {
      await apiPut(`/api/rules/${ruleId}`, data);
      setRuleCard(data);
      setSaveResult({ success: true, message: '保存成功！' });
      /* 3 秒后清除提示 */
      setTimeout(() => setSaveResult(null), 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '保存失败';
      setSaveResult({ success: false, message: msg });
    } finally {
      setSaving(false);
    }
  };

  /* 加载中 */
  if (loading) {
    return (
      <div className="p-6 md:p-8 max-w-screen-2xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-codex-border/50 rounded w-1/3" />
          <div className="h-4 bg-codex-border/50 rounded w-2/3" />
          <div className="h-64 bg-codex-border/50 rounded" />
        </div>
      </div>
    );
  }

  /* 规则不存在 */
  if (error || !ruleCard) {
    return (
      <div className="p-6 md:p-8 max-w-screen-2xl mx-auto">
        <div className="flex flex-col items-center justify-center py-20">
          <span className="text-5xl mb-4">❌</span>
          <h2 className="text-xl font-mono font-bold text-codex-text mb-2">
            规则不存在
          </h2>
          <p className="text-codex-text-secondary font-mono mb-6">
            {error || `未找到 ID 为 ${ruleId} 的规则卡`}
          </p>
          <Link href="/rules">
            <Button variant="secondary">
              ← 返回规则库
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  /* Tab 配置 */
  const tabs: { key: TabType; label: string }[] = [
    { key: 'edit', label: '📝 编辑规则卡' },
    { key: 'prompt', label: '🎨 生成提示词' },
  ];

  return (
    <div className="p-6 md:p-8 max-w-screen-2xl mx-auto">
      {/* 页面标题 */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link
            href="/rules"
            className="text-codex-text-secondary hover:text-codex-text font-mono text-sm transition-colors"
          >
            ← 返回
          </Link>
          <h1 className="text-xl font-mono font-bold text-codex-text">
            {ruleCard.rule_name || '规则卡详情'}
          </h1>
        </div>
      </div>

      {/* Tab 切换栏 */}
      <div className="flex border-b border-codex-border mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`
              px-4 py-2.5 text-sm font-mono font-medium
              transition-colors duration-150
              border-b-2 -mb-px
              cursor-pointer
              ${activeTab === tab.key
                ? 'text-codex-accent border-codex-accent'
                : 'text-codex-text-secondary border-transparent hover:text-codex-text hover:border-codex-border'
              }
            `}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 保存结果提示（仅编辑 Tab） */}
      {activeTab === 'edit' && saveResult && (
        <div
          className={`mb-4 px-4 py-2 rounded-md border font-mono text-sm ${
            saveResult.success
              ? 'bg-green-900/20 border-codex-success text-codex-success'
              : 'bg-red-900/20 border-codex-danger text-codex-danger'
          }`}
        >
          {saveResult.success ? '✅' : '❌'} {saveResult.message}
        </div>
      )}

      {/* 保存中遮罩提示（仅编辑 Tab） */}
      {activeTab === 'edit' && saving && (
        <div className="mb-4 px-4 py-2 bg-blue-900/20 border border-codex-accent rounded-md">
          <p className="text-sm text-codex-accent font-mono">⏳ 保存中...</p>
        </div>
      )}

      {/* Tab 内容区域 */}
      {activeTab === 'edit' && (
        /* 编辑器 */
        vocabularies && (
          <RuleCardEditor
            ruleCard={ruleCard}
            onSave={handleSave}
            vocabularies={vocabularies}
          />
        )
      )}

      {activeTab === 'prompt' && (
        /* 提示词生成区域 — Tab 切换 */
        <PromptTabs ruleId={ruleId} ruleCard={ruleCard} />
      )}
    </div>
  );
}

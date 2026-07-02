'use client';

/**
 * 规则库列表页面
 * 加载规则列表并展示
 */

import { useState, useEffect } from 'react';
import { apiGet, unwrapData } from '@/lib/api';
import RuleCardList from '@/components/rules/RuleCardList';

export default function RulesPage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [rules, setRules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadRules() {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await apiGet<any>('/api/rules');
        // 后端返回 {"success": true, "data": [...], "total": N}
        setRules(unwrapData<any[]>(res) || []);
      } catch (err) {
        const msg = err instanceof Error ? err.message : '加载失败';
        setError(msg);
      } finally {
        setLoading(false);
      }
    }
    loadRules();
  }, []);

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto">
      {error && (
        <div className="mb-4 px-4 py-2 bg-red-900/20 border border-codex-danger rounded-md">
          <p className="text-sm text-codex-danger font-mono">❌ {error}</p>
        </div>
      )}
      <RuleCardList rules={rules} loading={loading} />
    </div>
  );
}

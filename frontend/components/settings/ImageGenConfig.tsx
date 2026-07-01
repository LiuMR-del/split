'use client';

/**
 * 生图模型配置表单组件
 * 包含：API 类型选择、API URL、API Key、Model 名称、测试连接、保存配置
 * 支持 OpenAI（同步）和 AIReiter（异步）两种模式
 * Codex 深色风格，与 ModelConfig 一致
 */

import { useState, useEffect, useCallback } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { apiGet, apiPost } from '@/lib/api';

/* 后端返回的生图配置数据结构 */
interface GenConfigData {
  api_url: string;
  api_key_masked: string;
  model: string;
  api_type: string;
  is_configured: boolean;
}

/* 测试连接的响应结构 */
interface TestResponse {
  success: boolean;
  message?: string;
}

/* API 类型选项 */
const API_TYPE_OPTIONS = [
  { label: 'OpenAI（同步生图）', value: 'openai' },
  { label: 'AIReiter（异步生图）', value: 'aireiter' },
];

/* 各模式默认值 */
const DEFAULTS: Record<string, { url: string; model: string }> = {
  openai: { url: '', model: 'gpt-image-2' },
  aireiter: { url: 'https://aireiter.com', model: 'nano_banana_pro_advanced' },
};

export default function ImageGenConfig() {
  /* ====== 表单状态 ====== */
  const [apiType, setApiType] = useState('openai');
  const [apiUrl, setApiUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('gpt-image-2');

  /* ====== UI 状态 ====== */
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saveResult, setSaveResult] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  /* ====== 加载已有配置 ====== */
  const loadConfig = useCallback(async () => {
    try {
      const data = await apiGet<GenConfigData>('/api/gen/config');
      if (data) {
        const loadedType = data.api_type || 'openai';
        setApiType(loadedType);
        setApiUrl(data.api_url || DEFAULTS[loadedType]?.url || '');
        /* api_key 不预填（后端只返回脱敏的 api_key_masked） */
        setApiKey('');
        setModel(data.model || DEFAULTS[loadedType]?.model || 'gpt-image-2');
      }
    } catch (err) {
      /* 首次使用可能无配置，不阻断页面 */
      const msg = err instanceof Error ? err.message : '加载配置失败';
      setLoadError(msg);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  /* ====== 切换 API 类型时联动默认值 ====== */
  const handleApiTypeChange = (value: string) => {
    setApiType(value);
    const defaults = DEFAULTS[value];
    if (defaults) {
      setApiUrl(defaults.url);
      setModel(defaults.model);
    }
    /* 清除之前的状态提示 */
    setTestResult(null);
    setSaveResult(null);
  };

  /* ====== 测试连接 ====== */
  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setSaveResult(null);

    try {
      const res = await apiPost<TestResponse>('/api/gen/test', {
        api_url: apiUrl,
        api_key: apiKey,
        model,
        api_type: apiType,
      });
      setTestResult({
        ok: res.success,
        msg: res.success ? '连接成功' : (res.message || '连接失败'),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '未知错误';
      setTestResult({ ok: false, msg: `连接失败: ${msg}` });
    } finally {
      setTesting(false);
    }
  };

  /* ====== 保存配置 ====== */
  const handleSave = async () => {
    setSaving(true);
    setSaveResult(null);
    setTestResult(null);

    try {
      await apiPost('/api/gen/config', {
        api_url: apiUrl,
        api_key: apiKey,
        model,
        api_type: apiType,
      });
      setSaveResult('配置已保存');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '未知错误';
      setSaveResult(`保存失败: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 加载错误提示（非阻断） */}
      {loadError && (
        <p className="text-xs text-codex-warning font-mono">
          ⚠️ {loadError}
        </p>
      )}

      {/* API 类型选择 */}
      <Select
        label="API 类型"
        options={API_TYPE_OPTIONS}
        value={apiType}
        onChange={handleApiTypeChange}
      />

      {/* API URL */}
      <Input
        label="API URL"
        type="text"
        value={apiUrl}
        onChange={(e) => setApiUrl(e.currentTarget.value)}
        placeholder={apiType === 'openai' ? '输入 OpenAI 兼容 API 地址' : '输入 AIReiter API 地址'}
      />

      {/* API Key */}
      <Input
        label="API Key"
        type="password"
        value={apiKey}
        onChange={(e) => setApiKey(e.currentTarget.value)}
        placeholder="输入生图 API Key"
      />

      {/* Model 名称 */}
      <Input
        label="Model"
        type="text"
        value={model}
        onChange={(e) => setModel(e.currentTarget.value)}
        placeholder={apiType === 'openai' ? '如 gpt-image-2' : '如 nano_banana_pro_advanced'}
      />

      {/* 操作按钮 */}
      <div className="flex items-center gap-3 pt-2">
        <Button
          variant="secondary"
          onClick={handleTest}
          loading={testing}
          disabled={!apiUrl || !apiKey}
        >
          测试连接
        </Button>
        <Button
          variant="primary"
          onClick={handleSave}
          loading={saving}
        >
          保存配置
        </Button>
      </div>

      {/* 状态反馈区域 */}
      {testResult && (
        <p
          className={`text-sm font-mono ${
            testResult.ok ? 'text-codex-success' : 'text-codex-danger'
          }`}
        >
          {testResult.ok ? '✅' : '❌'} {testResult.msg}
        </p>
      )}
      {saveResult && (
        <p
          className={`text-sm font-mono ${
            saveResult.startsWith('保存失败')
              ? 'text-codex-danger'
              : 'text-codex-success'
          }`}
        >
          {saveResult.startsWith('保存失败') ? '❌' : '✅'} {saveResult}
        </p>
      )}
    </div>
  );
}

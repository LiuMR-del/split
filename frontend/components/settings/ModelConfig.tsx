'use client';

/**
 * AI 模型配置表单组件
 * 包含：Provider 选择、API URL、API Key、Model 名称、测试连接、保存配置
 * 页面加载时从后端获取已有配置，支持测试连接和保存
 */

import { useState, useEffect, useCallback } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { apiGet, apiPost } from '@/lib/api';

/* Provider 类型 */
type Provider = 'openai' | 'anthropic' | 'custom';

/* 各 Provider 的默认 API URL */
const DEFAULT_URLS: Record<Provider, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  custom: '',
};

/* 各 Provider 的 Model 输入框 placeholder */
const MODEL_PLACEHOLDERS: Record<Provider, string> = {
  openai: '如 gpt-4o',
  anthropic: '如 claude-sonnet-4-20250514',
  custom: '填写模型名称',
};

/* Provider 下拉选项 */
const PROVIDER_OPTIONS = [
  { label: 'OpenAI', value: 'openai' },
  { label: 'Anthropic', value: 'anthropic' },
  { label: 'Custom（自定义）', value: 'custom' },
];

/* 后端返回的配置数据结构（GET /api/settings 直接返回，无 {success, data} 包装） */
interface SettingsData {
  provider: Provider;
  api_url: string;
  api_key_masked: string;  // 后端脱敏显示，如 "sk-...xxxx"
  model: string;
  is_configured: boolean;
}

/* 测试连接的响应结构 */
interface TestResponse {
  success: boolean;
  message?: string;
}

/* 模型列表项 */
interface ModelItem {
  id: string;
  name: string;
}

export default function ModelConfig() {
  /* ====== 表单状态 ====== */
  const [provider, setProvider] = useState<Provider>('openai');
  const [apiUrl, setApiUrl] = useState(DEFAULT_URLS.openai);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');

  /* ====== 模型列表 ====== */
  const [modelList, setModelList] = useState<ModelItem[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);

  /* ====== UI 状态 ====== */
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saveResult, setSaveResult] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  /* ====== 加载已有配置 ====== */
  const loadSettings = useCallback(async () => {
    try {
      // GET /api/settings 直接返回 SettingsResponse（无 {success, data} 包装）
      const data = await apiGet<SettingsData>('/api/settings');
      if (data) {
        setProvider(data.provider || 'openai');
        setApiUrl(data.api_url || DEFAULT_URLS[data.provider || 'openai']);
        // api_key 不预填（后端只返回脱敏的 api_key_masked）
        setApiKey('');
        setModel(data.model || '');
      }
    } catch (err) {
      /* 首次使用可能无配置，不阻断页面 */
      const msg = err instanceof Error ? err.message : '加载配置失败';
      setLoadError(msg);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  /* ====== Provider 切换处理 ====== */
  const handleProviderChange = (val: string) => {
    const newProvider = val as Provider;
    setProvider(newProvider);
    setApiUrl(DEFAULT_URLS[newProvider]);
    setTestResult(null);
    setSaveResult(null);
    setModelList([]);
  };

  /* ====== 拉取远端模型列表 ====== */
  const handleFetchModels = async () => {
    if (!apiUrl || !apiKey) return;
    setFetchingModels(true);
    try {
      const res = await apiPost<{ models: ModelItem[]; error?: string }>('/api/settings/models', {
        provider,
        api_url: apiUrl,
        api_key: apiKey,
        model: model || 'temp',
      });
      if (res.models && res.models.length > 0) {
        setModelList(res.models);
      } else {
        setModelList([]);
      }
    } catch {
      setModelList([]);
    } finally {
      setFetchingModels(false);
    }
  };

  /* ====== 测试连接 ====== */
  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setSaveResult(null);

    try {
      const res = await apiPost<TestResponse>('/api/settings/test', {
        provider,
        api_url: apiUrl,
        api_key: apiKey,
        model,
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
      await apiPost('/api/settings', {
        provider,
        api_url: apiUrl,
        api_key: apiKey,
        model,
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

      {/* Provider 选择 */}
      <Select
        label="Provider"
        options={PROVIDER_OPTIONS}
        value={provider}
        onChange={handleProviderChange}
      />

      {/* API URL */}
      <Input
        label="API URL"
        type="text"
        value={apiUrl}
        onChange={(e) => setApiUrl(e.currentTarget.value)}
        placeholder="输入 API 地址"
      />

      {/* API Key */}
      <Input
        label="API Key"
        type="password"
        value={apiKey}
        onChange={(e) => setApiKey(e.currentTarget.value)}
        placeholder="输入你的 API Key"
      />

      {/* Model 名称 —— 支持拉取远端模型列表 */}
      <div className="space-y-2">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            {modelList.length > 0 ? (
              <Select
                label="Model"
                options={[
                  { label: '— 请选择模型 —', value: '' },
                  ...modelList.map(m => ({ label: `${m.name} (${m.id})`, value: m.id })),
                ]}
                value={model}
                onChange={setModel}
              />
            ) : (
              <Input
                label="Model"
                type="text"
                value={model}
                onChange={(e) => setModel(e.currentTarget.value)}
                placeholder={MODEL_PLACEHOLDERS[provider]}
              />
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleFetchModels}
            loading={fetchingModels}
            disabled={!apiUrl || !apiKey}
          >
            🔄 拉取模型列表
          </Button>
        </div>
        {modelList.length > 0 && (
          <p className="text-xs text-codex-text-secondary font-mono">
            ✅ 已加载 {modelList.length} 个可用模型
          </p>
        )}
      </div>

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

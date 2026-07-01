/**
 * 模型配置页面
 * 包含 AI 分析模型配置 和 生图模型配置 两个 section
 * Codex 深色风格卡片布局
 */

import ModelConfig from '@/components/settings/ModelConfig';
import ImageGenConfig from '@/components/settings/ImageGenConfig';

export default function SettingsPage() {
  return (
    <div className="min-h-screen p-8">
      <div className="max-w-2xl mx-auto">
        {/* 页面标题 */}
        <h1 className="text-2xl font-bold font-mono text-codex-text mb-8">
          ⚙️ 模型配置
        </h1>

        {/* AI 分析模型配置 */}
        <section>
          <h2 className="text-lg font-bold font-mono text-codex-text mb-4">
            🧠 AI 分析模型配置
          </h2>
          <div className="bg-codex-card border border-codex-border rounded-lg p-6">
            <ModelConfig />
          </div>
        </section>

        {/* 分隔线 */}
        <div className="border-t border-codex-border my-8" />

        {/* 生图模型配置 */}
        <section>
          <h2 className="text-lg font-bold font-mono text-codex-text mb-4">
            🎨 生图模型配置
          </h2>
          <div className="bg-codex-card border border-codex-border rounded-lg p-6">
            <ImageGenConfig />
          </div>
        </section>
      </div>
    </div>
  );
}

'use client';

/**
 * 提示词三栏并排面板
 * 三个版本（资料库关联 / AI 推荐 / 自定义模板）同时渲染，各自独立操作、独立生成
 * 替代原来的 Tab 切换布局，改为响应式三栏并排
 */

import PromptVersionA from '@/components/prompts/PromptVersionA';
import PromptVersionB from '@/components/prompts/PromptVersionB';
import PromptVersionC from '@/components/prompts/PromptVersionC';

interface PromptTabsProps {
  ruleId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ruleCard: any;
}

export default function PromptTabs({ ruleId, ruleCard }: PromptTabsProps) {
  return (
    /* 响应式网格：小屏 1 栏，中屏 2 栏，大屏 3 栏 */
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      {/* 版本 A：资料库关联 */}
      <div className="border border-codex-border rounded-lg overflow-hidden">
        <div className="px-3 py-2.5 bg-codex-card border-b border-codex-border">
          <h3 className="text-sm font-mono font-bold text-codex-text">
            📚 资料库关联
          </h3>
          <p className="text-xs text-codex-text-secondary mt-0.5">
            基于你的图库参考
          </p>
        </div>
        <div className="p-3 max-h-[80vh] overflow-y-auto">
          <PromptVersionA ruleId={ruleId} ruleCard={ruleCard} />
        </div>
      </div>

      {/* 版本 B：AI 推荐（标题高亮标记为推荐） */}
      <div className="border border-codex-border rounded-lg overflow-hidden">
        <div className="px-3 py-2.5 bg-codex-card border-b border-codex-border">
          <h3 className="text-sm font-mono font-bold text-codex-accent">
            🤖 AI 推荐
          </h3>
          <p className="text-xs text-codex-text-secondary mt-0.5">
            AI 自动推荐改款方向
          </p>
        </div>
        <div className="p-3 max-h-[80vh] overflow-y-auto">
          <PromptVersionB ruleId={ruleId} ruleCard={ruleCard} />
        </div>
      </div>

      {/* 版本 C：自定义模板 */}
      <div className="border border-codex-border rounded-lg overflow-hidden">
        <div className="px-3 py-2.5 bg-codex-card border-b border-codex-border">
          <h3 className="text-sm font-mono font-bold text-codex-text">
            🔧 自定义模板
          </h3>
          <p className="text-xs text-codex-text-secondary mt-0.5">
            手动选择每个维度
          </p>
        </div>
        <div className="p-3 max-h-[80vh] overflow-y-auto">
          <PromptVersionC ruleId={ruleId} ruleCard={ruleCard} />
        </div>
      </div>
    </div>
  );
}

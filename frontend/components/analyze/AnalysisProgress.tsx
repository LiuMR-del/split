'use client';

/**
 * 分析进度展示组件
 * 显示上传→分级→拆解三步骤的状态
 * Codex 深色风格
 */

type AnalysisStage = 'uploading' | 'grading' | 'extracting' | 'done' | 'error';

interface AnalysisProgressProps {
  stage: AnalysisStage;
  error?: string;
}

/* 步骤定义 */
const steps = [
  { key: 'uploading', icon: '📤', label: 'AI 分析中' },  /* #10：分析期间 stage='uploading'（apiUpload 阻塞 30-60s），label 诚实化 */
  { key: 'grading', icon: '📊', label: 'SABC 分级' },
  { key: 'extracting', icon: '🔍', label: '规则拆解' },
] as const;

/* 根据当前 stage 判断步骤状态 */
const stageOrder: Record<string, number> = {
  uploading: 0,
  grading: 1,
  extracting: 2,
  done: 3,
  error: -1,
};

export default function AnalysisProgress({ stage, error }: AnalysisProgressProps) {
  const currentIndex = stageOrder[stage] ?? -1;

  return (
    <div className="flex flex-col items-center gap-4">
      {/* 步骤指示器 */}
      <div className="flex items-center gap-0 w-full max-w-md">
        {steps.map((step, index) => {
          const isCompleted = currentIndex > index || stage === 'done';
          const isCurrent = currentIndex === index && stage !== 'done' && stage !== 'error';
          const isPending = !isCompleted && !isCurrent;

          return (
            <div key={step.key} className="flex items-center flex-1 last:flex-none">
              {/* 步骤圆圈 + 标签 */}
              <div className="flex flex-col items-center gap-2 min-w-[80px]">
                <div
                  className={`
                    relative w-10 h-10 rounded-full flex items-center justify-center
                    border-2 transition-colors duration-300
                    ${isCompleted
                      ? 'border-codex-success bg-codex-success/10'
                      : isCurrent
                        ? 'border-codex-accent bg-codex-accent/10'
                        : 'border-codex-border bg-codex-card'
                    }
                  `}
                >
                  {isCompleted ? (
                    <span className="text-codex-success text-sm">✅</span>
                  ) : isCurrent ? (
                    <>
                      <span className="text-sm">{step.icon}</span>
                      {/* 旋转动画圈 */}
                      <span className="absolute inset-0 rounded-full border-2 border-codex-accent border-t-transparent animate-spin" />
                    </>
                  ) : (
                    <span className="text-sm opacity-40">{step.icon}</span>
                  )}
                </div>
                <span
                  className={`
                    text-xs font-mono whitespace-nowrap
                    ${isCompleted
                      ? 'text-codex-success'
                      : isCurrent
                        ? 'text-codex-accent'
                        : 'text-codex-text-secondary/50'
                    }
                  `}
                >
                  {step.label}
                </span>
              </div>

              {/* 连接线（最后一个步骤不需要） */}
              {index < steps.length - 1 && (
                <div
                  className={`
                    flex-1 h-[2px] mx-2 mt-[-24px] transition-colors duration-300
                    ${currentIndex > index
                      ? 'bg-codex-success'
                      : currentIndex === index
                        ? 'bg-codex-accent/50'
                        : 'bg-codex-border'
                    }
                  `}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* 错误信息 */}
      {stage === 'error' && error && (
        <div className="mt-2 px-4 py-2 bg-red-900/20 border border-codex-danger rounded-md w-full max-w-md">
          <p className="text-sm text-codex-danger font-mono">❌ {error}</p>
        </div>
      )}

      {/* 完成提示 */}
      {stage === 'done' && (
        <p className="text-sm text-codex-success font-mono mt-2">
          ✅ 分析完成！请查看下方规则卡预览。
        </p>
      )}
    </div>
  );
}

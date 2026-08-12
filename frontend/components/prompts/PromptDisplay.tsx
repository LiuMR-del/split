'use client';

/**
 * 提示词展示通用组件
 * 版本 B 和版本 C 共用
 * 展示生成的结构化提示词、英文生图提示词、改款说明等
 * 新增"一键生图"功能区
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Select from '@/components/ui/Select';
import CollapsibleSection from '@/components/ui/CollapsibleSection';
import FileUpload from '@/components/ui/FileUpload';
import { apiPost, apiGet, apiUpload, unwrapData } from '@/lib/api';

/* 提示词生成结果类型 */
export interface PromptResult {
  /* 锁定的核心卖点 */
  locked_core: {
    core_selling_point: string;
    selling_point_type: string;
    why_it_sells: string;
    lock_rule: string;
  };
  /* AI 推荐理由（仅版本 B） */
  reason?: string;
  /* AI 推荐的改动项（仅版本 B）—— 旧字段，保留兼容 */
  recommended_changes?: Array<{
    dimension: string;
    original: string;
    changed_to: string;
  }>;
  /* AI 推荐的改动项（仅版本 B）—— 新字段，后端返回三元组数组 */
  recommended_changes_detail?: Array<{
    dimension: string;
    original: string;
    changed_to: string;
  }>;
  /* 中文结构化提示词 */
  structured_prompt_cn: string;
  /* 英文生图提示词 - 正向 */
  image_prompt_positive: string;
  /* 英文生图提示词 - 负向 */
  image_prompt_negative: string;
  /* #7：编辑指令式提示词——配合竞品原图一起发给生图 API 时用（只说"改哪里"，
   * 不重新描述整个设计），与 image_prompt_positive（完整描述式）并存 */
  image_prompt_edit?: string;
  /* 改款说明 */
  change_summary: {
    kept: string[];
    changed: string[];
    based_on_rule: string;
  };
  /* R4：AI 判断的"可定制项"清单（仅版本 B 后端返回）。
   * 用户可勾选其中任意项，勾选后该项英文片段 prompt_fragment 会在生图时拼入正向提示词；
   * 未勾选则不改（可选可不选），未选时 effectivePositive === editablePositive，生图行为同 R3。 */
  customization_slots?: Array<{
    slot_name: string;
    position: string;
    description: string;
    is_text_slot: boolean;
    prompt_fragment: string;
  }>;
}

interface PromptDisplayProps {
  result: PromptResult;
  ruleId?: string;
  /** 规则名称，随生图请求一起提交，方便生图任务页按规则分组展示时不用反查 */
  ruleName?: string;
  /** 提示词来自哪个版本：A(资料库关联)/B(AI推荐)/C(自定义模板)，用于生图任务页分组 */
  version?: 'A' | 'B' | 'C';
  /** #7：规则卡是否有竞品原图（source_images 非空），决定"附带竞品原图"开关是否可用 */
  hasRuleImage?: boolean;
  /** #7：竞品原图的完整可访问 URL（取 ruleCard.thumbnail_path），用于开关旁的小缩略图预览 */
  ruleImageUrl?: string;
}

/* 生图提交响应 */
interface GenSubmitResponse {
  success: boolean;
  task_id: string;
  message?: string;
}

/* 二期批次一：界面精简开关。只包裹 JSX 渲染，state/逻辑不动，改 true 即可恢复显示 */
const SHOW_INFO_CARDS = false;
const SHOW_FINAL_PREVIEW_BOX = false;

/* 生图任务状态响应 */
interface GenTaskResponse {
  task_id: string;
  status: 'pending' | 'processing' | 'completed' | 'succeeded' | 'failed';
  image_urls?: string[];
  images?: Array<{ url: string; filename?: string }>;
  error?: string;
}

/**
 * 复制按钮组件
 * 点击后复制文本到剪贴板，显示"已复制"反馈
 */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1000);
    } catch {
      /* 降级方案：使用旧版 API */
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 1000);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className={`
        absolute top-2 right-2
        px-2 py-1 text-xs font-mono rounded
        transition-all duration-150
        ${copied
          ? 'bg-codex-success/20 text-codex-success border border-codex-success/50'
          : 'bg-codex-card/80 text-codex-text-secondary border border-codex-border hover:text-codex-text hover:border-codex-accent'
        }
      `}
    >
      {copied ? '✅ 已复制' : '📋 复制'}
    </button>
  );
}

/**
 * 代码块组件
 * 深色背景 + 等宽字体 + 可选复制按钮
 */
function CodeBlock({
  title,
  content,
  showCopy = false,
}: {
  title: string;
  content: string;
  showCopy?: boolean;
}) {
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-mono font-bold text-codex-text">
        {title}
      </h4>
      <div className="relative">
        <pre
          className="
            bg-codex-bg border border-codex-border rounded-lg p-3
            overflow-x-auto
            text-sm font-mono text-codex-text
            whitespace-pre-wrap break-words
          "
        >
          {content}
        </pre>
        {showCopy && <CopyButton text={content} />}
      </div>
    </div>
  );
}

/**
 * 合并英文提示词区域组件
 * 将正向和负向提示词合并为一个代码块，右上角统一复制按钮
 * 支持编辑模式：用户可修改提示词，复制修改后的内容
 */
/* R3：把合并提示词文本拆回 positive/negative 两段。
 * 格式：[正向提示词]\n{positive}\n\n---\n\n[负向提示词]\n{negative}
 * 格式不符（用户改坏标记）时 fallback：整段当 positive，负向留空。 */
function parseMergedPrompt(merged: string): { positive: string; negative: string } {
  const negMarker = '[负向提示词]';
  const negIdx = merged.indexOf(negMarker);
  if (negIdx === -1) {
    return { positive: merged, negative: '' };
  }
  const posMarker = '[正向提示词]';
  const posIdx = merged.indexOf(posMarker);
  const positive = merged
    .substring(posIdx >= 0 ? posIdx + posMarker.length : 0, negIdx)
    .replace(/^\n+/, '')
    .replace(/\n*---\n*$/, '')
    .trim();
  const negative = merged.substring(negIdx + negMarker.length).replace(/^\n+/, '').trim();
  return { positive, negative };
}

/* R5：textarea 自动撑高 hook，对齐只读 pre 的高度（内容相同->高度一致） */
function useAutoResizeTextarea(deps: unknown[]) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const ta = ref.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = `${ta.scrollHeight}px`;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

function MergedPromptBlock({
  positive,
  negative,
  onPromptChange,
}: {
  positive: string;
  negative: string;
  /* R3：编辑完成时把拆回的 positive/negative 回传父组件，让生图用编辑后的提示词 */
  onPromptChange?: (positive: string, negative: string) => void;
}) {
  /* 是否处于编辑模式 */
  const [isEditing, setIsEditing] = useState(false);
  /* 编辑中的内容 */
  const [editedPrompt, setEditedPrompt] = useState('');
  /* textarea 自动撑高，对齐只读 pre 的高度（内容相同→高度一致），避免编辑框比展示框小 */
  const textareaRef = useAutoResizeTextarea([editedPrompt, isEditing]);

  /* 合并后的当前文本（基于 props，即父组件维护的编辑后版本） */
  const originalMerged = `[正向提示词]\n${positive}\n\n---\n\n[负向提示词]\n${negative}`;

  /* 进入编辑模式 */
  const handleStartEdit = () => {
    setEditedPrompt(originalMerged);
    setIsEditing(true);
  };

  /* 恢复到当前 props 值（取消本次编辑） */
  const handleRestore = () => {
    setEditedPrompt(originalMerged);
  };

  /* 完成编辑：解析编辑后的文本拆回 positive/negative，回传父组件更新 */
  const handleFinishEdit = () => {
    const parsed = parseMergedPrompt(editedPrompt);
    onPromptChange?.(parsed.positive, parsed.negative);
    setIsEditing(false);
  };

  /* 复制时：编辑模式下用编辑后的内容，否则用原始内容 */
  const copyContent = isEditing ? editedPrompt : originalMerged;

  return (
    <div className="space-y-2">
      <div className="relative">
        {isEditing ? (
          /* 编辑模式：textarea 可编辑 */
          <textarea
            ref={textareaRef}
            value={editedPrompt}
            onChange={(e) => setEditedPrompt(e.target.value)}
            className="
              bg-codex-bg border border-codex-border rounded-lg p-3
              text-sm font-mono text-codex-text
              w-full overflow-hidden
              focus:outline-none focus:border-codex-accent
            "
          />
        ) : (
          /* 只读模式：pre 代码块 */
          <pre
            className="
              bg-codex-bg border border-codex-border rounded-lg p-3
              overflow-x-auto
              text-sm font-mono text-codex-text
              whitespace-pre-wrap break-words
            "
          >
            <span className="text-codex-accent font-medium">[正向提示词]</span>
            {'\n'}
            {positive}
            {'\n\n'}
            <span className="text-codex-text-secondary">---</span>
            {'\n\n'}
            <span className="text-codex-accent font-medium">[负向提示词]</span>
            {'\n'}
            {negative}
          </pre>
        )}
        <CopyButton text={copyContent} />
      </div>

      {/* 底部操作按钮 */}
      <div className="flex items-center gap-2">
        {isEditing ? (
          <>
            {/* 恢复原始 */}
            <button
              onClick={handleRestore}
              className="
                px-2 py-1 text-xs font-mono rounded
                bg-codex-card/80 text-codex-text-secondary
                border border-codex-border
                hover:text-codex-text hover:border-codex-accent
                transition-all duration-150 cursor-pointer
              "
            >
              ↩ 恢复原始
            </button>
            {/* 完成编辑 */}
            <button
              onClick={handleFinishEdit}
              className="
                px-2 py-1 text-xs font-mono rounded
                bg-codex-success/20 text-codex-success
                border border-codex-success/50
                hover:bg-codex-success/30
                transition-all duration-150 cursor-pointer
              "
            >
              ✅ 完成编辑
            </button>
          </>
        ) : (
          /* 编辑按钮 */
          <button
            onClick={handleStartEdit}
            className="
              px-2 py-1 text-xs font-mono rounded
              bg-codex-card/80 text-codex-text-secondary
              border border-codex-border
              hover:text-codex-text hover:border-codex-accent
              transition-all duration-150 cursor-pointer
            "
          >
            ✏️ 编辑提示词
          </button>
        )}
      </div>

      <p className="text-xs font-mono text-codex-text-secondary">
        {isEditing
          ? '编辑模式：修改后点击"复制"可复制修改后的内容'
          : '正向和负向提示词已合并，复制后可直接使用'}
      </p>
    </div>
  );
}

/**
 * 可收起的中文提示词区域组件
 * 默认收起，展开后显示代码块 + 复制按钮
 */
function CollapsiblePromptBlock({
  title,
  content,
}: {
  title: string;
  content: string;
}) {
  return (
    <CollapsibleSection title={title} defaultExpanded={false}>
      <div className="relative">
        <pre
          className="
            bg-codex-bg border border-codex-border rounded-lg p-3
            overflow-x-auto
            text-sm font-mono text-codex-text
            whitespace-pre-wrap break-words
          "
        >
          {content}
        </pre>
        <CopyButton text={content} />
      </div>
    </CollapsibleSection>
  );
}

/**
 * 产品尺寸预设数据（基于实际印刷尺寸）
 * 选择后自动填充宽高，提交时等比缩放到 API 限制范围内
 */
const PRODUCT_SIZE_PRESETS = [
  // 毛毯
  { label: '[毛毯] 30×40 (3066×4000)', value: 'blanket_30x40', width: 3066, height: 4000, category: '毛毯 Blanket' },
  { label: '[毛毯] 40×50 (3000×3868)', value: 'blanket_40x50', width: 3000, height: 3868, category: '毛毯 Blanket' },
  { label: '[毛毯] 50×60 (3480×4000)', value: 'blanket_50x60', width: 3480, height: 4000, category: '毛毯 Blanket' },
  { label: '[毛毯] 60×80 (4000×5297)', value: 'blanket_60x80', width: 4000, height: 5297, category: '毛毯 Blanket' },
  // 沙滩巾
  { label: '[沙滩巾] 80×160 (2060×4000)', value: 'beach_80x160', width: 2060, height: 4000, category: '沙滩巾 Beach Towel' },
  { label: '[沙滩巾] 70×140 (2028×4000)', value: 'beach_70x140', width: 2028, height: 4000, category: '沙滩巾 Beach Towel' },
  // 衣服
  { label: '[衣服] 短袖 (850×1049)', value: 'tshirt', width: 850, height: 1049, category: '衣服 Apparel' },
  { label: '[衣服] 长袖 (1121×1200)', value: 'longsleeve', width: 1121, height: 1200, category: '衣服 Apparel' },
  { label: '[衣服] 袖子 (1200×899)', value: 'sleeve', width: 1200, height: 899, category: '衣服 Apparel' },
  // 横幅
  { label: '[横幅] 6000×2614', value: 'banner', width: 6000, height: 2614, category: '横幅 Banner' },
  // 相框
  { label: '[相框] 横板 (6000×4000)', value: 'frame_landscape', width: 6000, height: 4000, category: '相框 Frame' },
  { label: '[相框] 竖版 (4000×6000)', value: 'frame_portrait', width: 4000, height: 6000, category: '相框 Frame' },
  // 花园旗
  { label: '[花园旗] 3:4 (3000×4000)', value: 'garden_flag', width: 3000, height: 4000, category: '花园旗 Garden Flag' },
  // 通用
  { label: '[通用] 正方形 1:1 (1024×1024)', value: 'square', width: 1024, height: 1024, category: '通用' },
  { label: '[通用] 竖版 3:4 (1024×1365)', value: 'portrait_3_4', width: 1024, height: 1365, category: '通用' },
  { label: '[通用] 竖版 9:16 (1024×1820)', value: 'portrait_9_16', width: 1024, height: 1820, category: '通用' },
  { label: '[通用] 横版 16:9 (1820×1024)', value: 'landscape_16_9', width: 1820, height: 1024, category: '通用' },
] as const;

/** 生图 API 最大尺寸限制（AIReiter） */
const API_MAX_SIZE = 1600;

/** GCD 算法 —— 用于计算宽高的近似比例 */
function gcd(a: number, b: number): number {
  a = Math.abs(Math.round(a));
  b = Math.abs(Math.round(b));
  while (b) {
    [a, b] = [b, a % b];
  }
  return a;
}

/** 根据宽高计算近似比例文本，如 "约 3:4" */
function calcRatioText(w: number, h: number): string {
  if (w <= 0 || h <= 0) return '';
  const d = gcd(w, h);
  const rw = w / d;
  const rh = h / d;
  /* 如果简化后数字太大，近似到常见比例 */
  if (rw > 50 || rh > 50) {
    const ratio = w / h;
    const commonRatios = [
      { r: 1, text: '1:1' },
      { r: 3 / 4, text: '3:4' },
      { r: 4 / 3, text: '4:3' },
      { r: 9 / 16, text: '9:16' },
      { r: 16 / 9, text: '16:9' },
      { r: 2 / 3, text: '2:3' },
      { r: 3 / 2, text: '3:2' },
    ];
    let closest = commonRatios[0];
    let minDiff = Math.abs(ratio - closest.r);
    for (const c of commonRatios) {
      const diff = Math.abs(ratio - c.r);
      if (diff < minDiff) {
        minDiff = diff;
        closest = c;
      }
    }
    return `约 ${closest.text}`;
  }
  return `${rw}:${rh}`;
}

/* R4 可定制项勾选清单的单项类型 */
interface CustomizationSlot {
  slot_name: string;
  position: string;
  description: string;
  is_text_slot: boolean;
  prompt_fragment: string;
}

/**
 * R4 可定制项勾选清单组件（仅版本 B）
 * 展示 AI 判断的可定制项，用户可勾选任意项；
 * 勾选后该项 prompt_fragment 会在生图时拼入正向提示词，未勾选则不改（可选可不选）。
 * 默认全不选，未选时生图行为同 R3。
 */
function CustomizationSlotsSection({
  slots,
  selectedIndices,
  onChange,
}: {
  slots: CustomizationSlot[];
  selectedIndices: number[];
  onChange: (indices: number[]) => void;
}) {
  /* 勾选/取消某项：把 idx 加入或移出 selectedIndices */
  const toggle = (idx: number) => {
    if (selectedIndices.includes(idx)) {
      onChange(selectedIndices.filter((i) => i !== idx));
    } else {
      onChange([...selectedIndices, idx]);
    }
  };

  return (
    <>
      <p className="text-xs font-mono text-codex-text-secondary mb-3">
        默认不勾选，生图行为与之前一致；勾选的项目会在生图时追加到正向提示词末尾。
        <br />
        勾选项已实时拼入上方提示词；编辑提示词后勾选状态会重置，已拼入内容保留在文本中。
      </p>
      <div className="space-y-2">
        {slots.map((slot, idx) => (
          <label
            key={idx}
            className="flex items-start gap-2 p-2 bg-codex-bg rounded border border-codex-border hover:border-codex-accent transition-colors cursor-pointer"
          >
            <input
              type="checkbox"
              checked={selectedIndices.includes(idx)}
              onChange={() => toggle(idx)}
              className="mt-0.5 cursor-pointer accent-codex-accent"
            />
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-mono text-codex-text font-medium">
                  {slot.slot_name}
                </span>
                {slot.position && (
                  <span className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-codex-card text-codex-text-secondary border border-codex-border">
                    {slot.position}
                  </span>
                )}
                {slot.is_text_slot && (
                  <span className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-codex-accent/20 text-codex-accent border border-codex-accent/40">
                    文字定制位
                  </span>
                )}
              </div>
              {slot.description && (
                <p className="text-xs font-mono text-codex-text-secondary break-words">
                  {slot.description}
                </p>
              )}
            </div>
          </label>
        ))}
      </div>
    </>
  );
}

/**
 * 一键生图操作区组件
 * 提交生图任务、轮询状态、展示结果
 */
function ImageGenSection({
  ruleId,
  ruleName,
  version,
  promptPositive,
  promptNegative,
  attachRuleImage,
  referencePaths,
  onReferencePathsChange,
  onAppendFragment,
}: {
  ruleId: string;
  ruleName?: string;
  version?: 'A' | 'B' | 'C';
  promptPositive: string;
  promptNegative: string;
  /** #7：是否附带规则卡竞品原图生图（即上方"附带竞品原图"开关的当前状态） */
  attachRuleImage: boolean;
  /** #8：额外参考图路径列表（生图流程参考图上传，与规则卡竞品原图一起作为图片输入附带） */
  referencePaths: string[];
  /** #8：新增/删除参考图时回调给父组件（PromptDisplay 维护实际 state） */
  onReferencePathsChange: (paths: string[]) => void;
  /** #8：点"拼入提示词"时把分析出的英文片段追加到父组件当前激活模式的提示词 */
  onAppendFragment: (fragment: string) => void;
}) {
  /* 产品尺寸预设选中值 */
  const [sizePreset, setSizePreset] = useState('square');
  /* 尺寸 */
  const [width, setWidth] = useState(1024);
  const [height, setHeight] = useState(1024);
  /* 生成数量 */
  const [count, setCount] = useState(1);
  /* 提交状态 */
  const [submitting, setSubmitting] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  /* 轮询状态 */
  const [taskStatus, setTaskStatus] = useState<'idle' | 'processing' | 'completed' | 'failed'>('idle');
  /* 结果图片 */
  const [images, setImages] = useState<Array<{ url: string; filename?: string }>>([]);
  /* 错误信息 */
  const [error, setError] = useState('');
  /* #8：多任务提示（count>1 时，taskId 单值只跟踪第一个，提示其余去生图任务页）*/
  const [multiTaskHint, setMultiTaskHint] = useState('');
  /* 轮询引用，用于 cleanup */
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /* 选中预览的大图 */
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  /* 构建 Select 下拉选项（按 category 分组，label 带前缀） */
  const presetOptions = useMemo(() => {
    const opts: Array<{ label: string; value: string }> = [
      { label: '请选择产品尺寸', value: '' },
    ];
    for (const p of PRODUCT_SIZE_PRESETS) {
      opts.push({ label: p.label, value: p.value });
    }
    return opts;
  }, []);

  /* 计算当前宽高的近似比例文本 */
  const ratioText = useMemo(() => calcRatioText(width, height), [width, height]);

  /* 选择预设时自动填充宽高 */
  const handlePresetChange = (val: string) => {
    setSizePreset(val);
    if (!val) return; /* "请选择" 空值 */
    const preset = PRODUCT_SIZE_PRESETS.find((p) => p.value === val);
    if (preset) {
      setWidth(preset.width);
      setHeight(preset.height);
    }
  };

  /* 手动修改宽高时，预设变为空（自定义） */
  const handleWidthChange = (v: number) => {
    setWidth(v || 1024);
    setSizePreset('');
  };
  const handleHeightChange = (v: number) => {
    setHeight(v || 1024);
    setSizePreset('');
  };

  /* #8：生图流程参考图上传——每一项是用户添加的一张待处理参考图（选图→填用途→AI分析→拼入）。
   * 用本地数组维护多张，每项独立 purpose 分析、独立拼入/删除，不影响其他项。 */
  const [refItems, setRefItems] = useState<Array<{
    file: File;
    preview: string;
    purpose: string;
    analyzing: boolean;
    error: string;
    fragment: string;        // AI 分析出的英文片段，用户可编辑
    descriptionCn: string;   // AI 分析出的中文说明（只读展示）
    refPath: string;         // 分析成功后端返回的 /gen-refs/xxx 路径，空串表示还没分析成功
    appended: boolean;       // 是否已点过"拼入提示词"
  }>>([]);

  /* 添加一张待处理参考图（选图后先只是待分析状态，不立即调用 AI） */
  const handleAddRefImage = (file: File) => {
    setRefItems((prev) => [...prev, {
      file,
      preview: URL.createObjectURL(file),
      purpose: '',
      analyzing: false,
      error: '',
      fragment: '',
      descriptionCn: '',
      refPath: '',
      appended: false,
    }]);
  };

  /* 更新某一项的用途文本 */
  const handleRefPurposeChange = (idx: number, purpose: string) => {
    setRefItems((prev) => prev.map((item, i) => i === idx ? { ...item, purpose } : item));
  };

  /* 调 AI 分析这张参考图（只提取 purpose 相关的特征） */
  const handleAnalyzeRef = async (idx: number) => {
    const item = refItems[idx];
    if (!item || !item.purpose.trim()) return;

    setRefItems((prev) => prev.map((it, i) => i === idx ? { ...it, analyzing: true, error: '' } : it));

    try {
      const formData = new FormData();
      formData.append('file', item.file);
      formData.append('purpose', item.purpose.trim());
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await apiUpload<any>('/api/gen/analyze-ref', formData);
      const data = unwrapData<any>(res); // eslint-disable-line @typescript-eslint/no-explicit-any
      setRefItems((prev) => prev.map((it, i) => i === idx ? {
        ...it,
        analyzing: false,
        fragment: data.fragment || '',
        descriptionCn: data.description_cn || '',
        refPath: data.ref_path || '',
      } : it));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AI 分析失败';
      setRefItems((prev) => prev.map((it, i) => i === idx ? { ...it, analyzing: false, error: msg } : it));
    }
  };

  /* 拼入提示词：把编辑后的英文片段追加到父组件当前激活的提示词末尾，
   * 并把 ref_path 加进 referencePaths（提交生图时随竞品原图一起作为图片输入附带） */
  const handleAppendRef = (idx: number) => {
    const item = refItems[idx];
    if (!item || !item.fragment.trim()) return;
    onAppendFragment(item.fragment.trim());
    if (item.refPath && !referencePaths.includes(item.refPath)) {
      onReferencePathsChange([...referencePaths, item.refPath]);
    }
    setRefItems((prev) => prev.map((it, i) => i === idx ? { ...it, appended: true } : it));
  };

  /* 删除已添加项：从本地列表移除，并同步从 referencePaths 摘除（如果已拼入过） */
  const handleRemoveRef = (idx: number) => {
    const item = refItems[idx];
    if (item?.refPath) {
      onReferencePathsChange(referencePaths.filter((p) => p !== item.refPath));
    }
    setRefItems((prev) => prev.filter((_, i) => i !== idx));
  };

  /* 清理轮询 */
  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, []);

  /* 开始轮询任务状态 */
  const startPolling = (tid: string) => {
    let elapsed = 0;
    const interval = 5000; /* 每 5 秒 */
    const maxDuration = 300000; /* 最多 5 分钟——与后端生图超时(300秒)一致，上游出图慢时 2 分钟会把"慢"误判成失败 */

    pollRef.current = setInterval(async () => {
      elapsed += interval;

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await apiGet<any>(`/api/gen/task/${tid}`);
        const task: GenTaskResponse = unwrapData(res);

        if (task.status === 'completed' || task.status === 'succeeded') {
          setTaskStatus('completed');
          // 后端字段是 image_urls（字符串数组），转成 {url} 对象数组
          const urls = task.image_urls || task.images || [];
          const imageList = urls.map((u: string | { url: string }) =>
            typeof u === 'string' ? { url: u } : u
          );
          setImages(imageList);
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        } else if (task.status === 'failed') {
          setTaskStatus('failed');
          setError(task.error || '生图任务失败');
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        }
        /* 仍为 processing 则继续轮询 */
      } catch (err) {
        /* 轮询出错不立即终止，等超时 */
        const msg = err instanceof Error ? err.message : '查询任务状态失败';
        console.error('轮询错误:', msg);
      }

      /* 超时终止 */
      if (elapsed >= maxDuration) {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        setTaskStatus('failed');
        setError('轮询超时（5 分钟），请前往生图任务页面查看进度');
      }
    }, interval);
  };

  /* 提交生图任务 */
  const handleSubmit = async () => {
    setSubmitting(true);
    setError('');
    setTaskId(null);
    setTaskStatus('idle');
    setImages([]);
    setMultiTaskHint('');  // #8：清空多任务提示

    try {
      /* 等比缩放到 API 最大尺寸限制（保持比例） */
      let submitWidth = width;
      let submitHeight = height;
      if (submitWidth > API_MAX_SIZE || submitHeight > API_MAX_SIZE) {
        const scale = API_MAX_SIZE / Math.max(submitWidth, submitHeight);
        submitWidth = Math.round(submitWidth * scale);
        submitHeight = Math.round(submitHeight * scale);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await apiPost<any>('/api/gen/submit', {
        rule_id: ruleId,
        rule_name: ruleName || '',
        version: version || '',
        prompt_positive: promptPositive,
        prompt_negative: promptNegative,
        width: submitWidth,
        height: submitHeight,
        count,
        attach_rule_image: attachRuleImage,
        reference_image_paths: referencePaths,
      });
      // 后端返回 {submitted, tasks: [{task_id, ...}], errors}（裸数据，unwrapData 原样透传）
      const data = unwrapData<any>(res);
      const tasks = data.tasks || [];
      const firstTask = tasks[0] || data;
      const returnedTaskId = firstTask.task_id || data.task_id;
      // #8：多任务过渡提示（前端 taskId/taskStatus/images 是单值，只跟踪第一个；多任务状态重构留后续）
      setMultiTaskHint(tasks.length > 1
        ? `已提交 ${tasks.length} 个任务，当前显示第 1 个，其余请到「生图任务」页查看`
        : '');

      if (returnedTaskId) {
        setTaskId(returnedTaskId);
        setTaskStatus('processing');
        startPolling(returnedTaskId);
      } else {
        setError(data.message || data.errors || '提交失败：未返回任务 ID');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '提交生图任务失败';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  /* 数量按钮组选项 */
  const countOptions = [1, 2, 3, 4];

  return (
    <div className="space-y-3">
      {/* #8：多任务过渡提示（count>1 提交后显示，提示其余任务去生图任务页）*/}
      {multiTaskHint && (
        <div className="px-3 py-2 bg-purple-900/20 border border-purple-700/40 rounded-md">
          <p className="text-xs font-mono text-purple-300">ℹ️ {multiTaskHint}</p>
        </div>
      )}
      {/* 产品尺寸预设下拉框 */}
      <Select
        label="产品尺寸"
        options={presetOptions}
        value={sizePreset}
        onChange={handlePresetChange}
      />

      {/* 宽高输入 + 比例显示 —— 窄栏内垂直排列 */}
      <div className="space-y-2">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <span className="text-sm font-mono text-codex-text-secondary min-w-[3rem]">宽:</span>
            <input
              type="number"
              value={width}
              onChange={(e) => handleWidthChange(Number(e.target.value))}
              className="flex-1 min-w-0 px-2 py-1.5 text-sm font-mono bg-codex-bg text-codex-text border border-codex-border rounded-md focus:outline-none focus:border-codex-accent focus:ring-1 focus:ring-codex-accent/30"
              min={256}
            />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-mono text-codex-text-secondary min-w-[3rem]">高:</span>
            <input
              type="number"
              value={height}
              onChange={(e) => handleHeightChange(Number(e.target.value))}
              className="flex-1 min-w-0 px-2 py-1.5 text-sm font-mono bg-codex-bg text-codex-text border border-codex-border rounded-md focus:outline-none focus:border-codex-accent focus:ring-1 focus:ring-codex-accent/30"
              min={256}
            />
          </div>
        </div>
        {/* 比例 + 缩放提示 —— 窄栏中自动换行 */}
        <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-codex-text-secondary">
          {ratioText && <span>📐 比例: {ratioText}</span>}
          {(width > API_MAX_SIZE || height > API_MAX_SIZE) && (
            <span className="text-codex-warning">
              ⚠ 提交时将等比缩放至 {API_MAX_SIZE}px 以内
            </span>
          )}
        </div>
      </div>

      {/* 数量选择（按钮组）—— 窄栏中自动换行 */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-mono text-codex-text-secondary min-w-[3rem]">数量:</span>
        <div className="flex gap-2">
          {countOptions.map((n) => (
            <button
              key={n}
              onClick={() => setCount(n)}
              className={`
                px-3 py-1.5 text-sm font-mono rounded-md
                transition-colors duration-150 cursor-pointer
                ${count === n
                  ? 'bg-codex-accent text-white'
                  : 'bg-codex-bg text-codex-text-secondary border border-codex-border hover:border-codex-accent hover:text-codex-text'
                }
              `}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* #8：生图流程参考图上传——折叠区，默认收起（不是每次生图都需要额外参考图，
          收起减少视觉干扰）。支持添加多张，每张独立填写用途+AI分析+拼入/删除。 */}
      <CollapsibleSection title="➕ 添加参考图" defaultExpanded={false}>
        <div className="space-y-3">
          {refItems.map((item, idx) => (
            <div key={idx} className="p-3 bg-codex-bg border border-codex-border rounded-md space-y-2">
              <div className="flex items-start gap-3">
                <img
                  src={item.preview}
                  alt="参考图预览"
                  className="w-16 h-16 rounded object-cover border border-codex-border shrink-0"
                />
                <div className="flex-1 min-w-0 space-y-2">
                  <input
                    type="text"
                    value={item.purpose}
                    onChange={(e) => handleRefPurposeChange(idx, e.target.value)}
                    placeholder="这张图的作用，如：主体角色参考 / 配色参考 / 构图参考"
                    disabled={item.analyzing || !!item.refPath}
                    className="w-full px-2 py-1.5 text-sm font-mono bg-codex-card text-codex-text border border-codex-border rounded-md placeholder:text-codex-text-secondary/50 focus:outline-none focus:border-codex-accent disabled:opacity-60"
                  />
                  {!item.refPath && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleAnalyzeRef(idx)}
                      loading={item.analyzing}
                      disabled={!item.purpose.trim()}
                    >
                      🔍 AI 分析并入提示词
                    </Button>
                  )}
                </div>
                <button
                  onClick={() => handleRemoveRef(idx)}
                  className="text-xs font-mono text-codex-text-secondary hover:text-codex-danger transition-colors cursor-pointer shrink-0"
                  title="删除这张参考图"
                >
                  ✕
                </button>
              </div>

              {item.error && (
                <p className="text-xs font-mono text-codex-danger">❌ {item.error}</p>
              )}

              {item.refPath && (
                <div className="space-y-2 pt-2 border-t border-codex-border">
                  <p className="text-xs font-mono text-codex-text-secondary">
                    💡 {item.descriptionCn}
                  </p>
                  <textarea
                    value={item.fragment}
                    onChange={(e) => setRefItems((prev) => prev.map((it, i) => i === idx ? { ...it, fragment: e.target.value, appended: false } : it))}
                    className="w-full px-2 py-1.5 text-xs font-mono bg-codex-card text-codex-text border border-codex-border rounded-md focus:outline-none focus:border-codex-accent"
                    rows={2}
                  />
                  <Button
                    variant={item.appended ? 'secondary' : 'primary'}
                    size="sm"
                    onClick={() => handleAppendRef(idx)}
                    disabled={!item.fragment.trim()}
                  >
                    {item.appended ? '✅ 已拼入（可再次点击重新拼入）' : '➕ 拼入提示词'}
                  </Button>
                </div>
              )}
            </div>
          ))}

          <FileUpload onFileSelect={handleAddRefImage} />
        </div>
      </CollapsibleSection>

      {/* 生成按钮 */}
      <Button
        variant="primary"
        onClick={handleSubmit}
        loading={submitting}
        disabled={taskStatus === 'processing'}
      >
        🎨 生成图片
      </Button>

      {/* OpenAI 同步模式提交等待提示：后端要同步等上游出图（实测 60 秒~4 分钟）才返回，
          不提示的话按钮长时间转圈会被误以为卡死 */}
      {submitting && (
        <p className="text-xs font-mono text-codex-text-secondary">
          ⏳ 正在生成图片…同步模式下最长可能等待约 5 分钟，请勿刷新页面
        </p>
      )}

      {/* 提交后状态区域 */}
      {taskStatus === 'processing' && taskId && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-mono text-codex-warning">
            <span className="inline-block w-4 h-4 border-2 border-codex-warning border-t-transparent rounded-full animate-spin" />
            <span>生成中... 已提交，任务ID: {taskId}</span>
          </div>
          <Link
            href="/gen"
            className="text-sm font-mono text-codex-accent hover:underline"
          >
            ↓ 查看任务进度
          </Link>
        </div>
      )}

      {/* 错误信息 */}
      {error && (
        <div className="px-4 py-2 bg-red-900/20 border border-codex-danger rounded-md">
          <p className="text-sm font-mono text-codex-danger">❌ {error}</p>
        </div>
      )}

      {/* 生成结果展示 */}
      {taskStatus === 'completed' && images.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-mono font-bold text-codex-success">
            📸 生成结果：
          </h4>
          {/* 窄栏适配：最多 2 列 */}
          <div className="grid grid-cols-2 gap-3">
            {images.map((img, idx) => (
              <div
                key={idx}
                className="bg-codex-bg border border-codex-border rounded-md overflow-hidden cursor-pointer hover:border-codex-accent transition-colors"
                onClick={() => setPreviewUrl(img.url)}
              >
                <img
                  src={img.url}
                  alt={img.filename || `生成图片 ${idx + 1}`}
                  className="w-full h-32 object-cover"
                />
                <p className="text-[10px] font-mono text-codex-text-secondary p-1 text-center truncate">
                  {img.filename || `图 ${idx + 1}`}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 大图预览遮罩 */}
      {previewUrl && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 cursor-pointer"
          onClick={() => setPreviewUrl(null)}
        >
          <div className="relative max-w-[90vw] max-h-[90vh]">
            <img
              src={previewUrl}
              alt="大图预览"
              className="max-w-full max-h-[85vh] object-contain rounded-lg"
            />
            <button
              onClick={() => setPreviewUrl(null)}
              className="absolute top-2 right-2 text-white text-xl bg-black/50 rounded-full w-8 h-8 flex items-center justify-center hover:bg-black/80 transition-colors cursor-pointer"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* R4：把用户勾选的可定制项英文片段拼到 base 提示词末尾。抽成纯函数供
 * effectivePositive（完整描述模式）和 effectiveEdit（#7 编辑指令模式）共用，
 * 两种 base 拼接逻辑完全一致，不重复维护两份。
 * 拼接前去掉 base 尾部的逗号/空格（用户手改可能留下），避免 "xxx, , fragment" 双逗号；
 * base 被清空时直接用 fragments，避免前导逗号。 */
function applyFragments(base: string, fragments: string[]): string {
  if (!fragments.length) return base;
  const trimmedBase = base.replace(/[，,\s]+$/, '').trim();
  return trimmedBase
    ? `${trimmedBase}, ${fragments.join(', ')}, each customizable element appears only once`
    : `${fragments.join(', ')}, each customizable element appears only once`;
}

/* #7：GET /api/gen/config 的 supports_reference 结果模块级缓存——A/B/C 三版各自
 * 渲染一个 PromptDisplay 实例，都要用这个值，缓存后只需请求一次，不用三份重复请求。
 * null 表示还没取过。 */
let _supportsReferenceCache: boolean | null = null;

export default function PromptDisplay({ result, ruleId, ruleName, version, hasRuleImage, ruleImageUrl }: PromptDisplayProps) {
  /* R3：维护"编辑后"的提示词 state，初始取 result 的值，result 变化（重新生成）时重置。
   * MergedPromptBlock 编辑完成时回写这里，ImageGenSection 用这里的值生图，
   * 修复原 bug：编辑后显示/生图仍是原值。R4 将在此基础上叠加可定制项勾选片段。 */
  const [editablePositive, setEditablePositive] = useState(result.image_prompt_positive);
  const [editableNegative, setEditableNegative] = useState(result.image_prompt_negative);
  /* #7：编辑指令式提示词的编辑态，随 result 同步的模式和 editablePositive 一致 */
  const [editableEdit, setEditableEdit] = useState(result.image_prompt_edit || '');
  /* #7：当前生图接口是否支持带参考图（GET /api/gen/config 的 supports_reference，
   * 挂载时取一次，用模块级缓存避免 A/B/C 三个 PromptDisplay 实例各发一次请求） */
  const [supportsReference, setSupportsReference] = useState<boolean>(_supportsReferenceCache ?? false);
  useEffect(() => {
    if (_supportsReferenceCache !== null) return;
    let cancelled = false;
    apiGet<any>('/api/gen/config') // eslint-disable-line @typescript-eslint/no-explicit-any
      .then((res) => {
        const supports = Boolean(unwrapData<any>(res)?.supports_reference); // eslint-disable-line @typescript-eslint/no-explicit-any
        _supportsReferenceCache = supports;
        if (!cancelled) setSupportsReference(supports);
      })
      .catch(() => {
        _supportsReferenceCache = false;
        if (!cancelled) setSupportsReference(false);
      });
    return () => { cancelled = true; };
  }, []);
  /* #7：是否使用"附带竞品原图"编辑模式。初始值：有竞品图 + 后端返回了编辑指令提示词
   * + 当前接口支持带图，三者都满足才默认开启；否则默认关闭（回落完整描述模式）。
   * 不支持/无图时下面的开关会被禁用，用户改不了这个初始判断。 */
  const [useReference, setUseReference] = useState(
    Boolean(hasRuleImage) && Boolean(result.image_prompt_edit) && supportsReference
  );
  /* #7：supportsReference 首次渲染时可能还没从 GET /api/gen/config 异步拉回来
   * （缓存未命中时初始是 false），拉回来之后要重新结算一次默认值——但只在"还没
   * 手动切换过开关"时结算，避免覆盖用户已经做出的选择。用 ref 记录是否已经手动切过。 */
  const userToggledRef = useRef(false);
  useEffect(() => {
    if (userToggledRef.current) return;
    setUseReference(Boolean(hasRuleImage) && Boolean(result.image_prompt_edit) && supportsReference);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supportsReference, result.image_prompt_edit, hasRuleImage]);
  /* R4：可定制项勾选状态，记录被选中项的索引数组。默认全不选（符合"可选可不选，未选则不改"） */
  const [selectedSlotIndices, setSelectedSlotIndices] = useState<number[]>([]);
  /* R3：editable 提示词的持久化 state。初始取 result 的值；重新生成时由 setResult(null)
   * 触发 PromptDisplay 卸载/重挂载，useState 初始化器自动取新 result 的值（主要重置机制）。
   * 此 effect 作为补充安全网：result 提示词值变化时同步 editable（仅依赖值，不依赖 result
   * 引用，避免引用变值不变时误重置编辑后的内容）。 */
  useEffect(() => {
    setEditablePositive(result.image_prompt_positive);
    setEditableNegative(result.image_prompt_negative);
    setEditableEdit(result.image_prompt_edit || '');
  }, [result.image_prompt_positive, result.image_prompt_negative, result.image_prompt_edit]);
  /* R4：勾选状态跟随可定制项变化（重新生成时重置），单独 effect 避免影响 editable */
  useEffect(() => {
    setSelectedSlotIndices([]);
  }, [result.customization_slots]);

  /* R4：计算实际用于生图的正向提示词。
   * base 是编辑后的 editablePositive（不含 fragment），叠加用户勾选项的 prompt_fragment。
   * 未勾选任何项时 selectedFragments 为空，effectivePositive === editablePositive，生图行为同 R3。 */
  const slots = result.customization_slots || [];
  const selectedFragments = slots
    .filter((_, i) => selectedSlotIndices.includes(i))
    .map((s) => s.prompt_fragment)
    .filter(Boolean);
  const effectivePositive = applyFragments(editablePositive, selectedFragments);
  /* #7：编辑指令模式下的等效拼接——同样的 base+fragment 拼接逻辑，只是 base 换成
   * editableEdit（编辑指令文本）而不是 editablePositive（完整描述文本） */
  const effectiveEdit = applyFragments(editableEdit, selectedFragments);
  /* #7：当前实际激活的文本（供 MergedPromptBlock 显示、生图使用）——
   * 开关开着且确有编辑指令文本时用编辑指令模式，否则回落完整描述模式 */
  const activeEffective = useReference && editableEdit ? effectiveEdit : effectivePositive;
  /* R5：finalPositive 是用户在"实际生图提示词"预览块里编辑后的最终值（含勾选项）。
   * 默认 undefined（用 activeEffective 自动拼接）；用户编辑预览块后覆盖。
   * base 或勾选变化时重置为 undefined（重新用 activeEffective），避免编辑值与勾选状态脱节。
   * #7：依赖也加 useReference/editableEdit——切换模式应视为"重新拼接"，不能让上一个
   * 模式编辑过的旧值继续覆盖新模式的文本。 */
  const [finalPositive, setFinalPositive] = useState<string | undefined>(undefined);
  useEffect(() => {
    setFinalPositive(undefined);
  }, [editablePositive, editableEdit, useReference, selectedSlotIndices]);
  /* #8：额外参考图路径列表（批次五：生图流程参考图上传）。用户在 ImageGenSection
   * 的"添加参考图"折叠区上传+AI分析后，点"拼入提示词"经 onAppendFragment 追加到
   * 当前激活模式的 base；提交生图时随 attach_rule_image 一起传给后端。 */
  const [referencePaths, setReferencePaths] = useState<string[]>([]);
  /* #8：把参考图分析出的英文片段追加到当前激活模式（编辑指令/完整描述）的 base 末尾，
   * 保持勾选状态不变——这是"新增类"追加而非替换，不需要像 MergedPromptBlock 完成编辑
   * 那样复位勾选框。追加到 base 而不是 activeEffective，避免下次勾选变化时被覆盖丢失。
   * 不复用 applyFragments——那个函数末尾固定拼"each customizable element appears
   * only once"，是专为可定制项勾选设计的收尾句，参考图片段（如色彩/构图描述）拼上
   * 这句话语义不通，这里只做简单的逗号追加。 */
  const handleAppendFragment = (fragment: string) => {
    const trimmed = fragment.trim();
    if (!trimmed) return;
    const append = (base: string) => {
      const trimmedBase = base.replace(/[，,\s]+$/, '').trim();
      return trimmedBase ? `${trimmedBase}, ${trimmed}` : trimmed;
    };
    if (useReference && editableEdit) {
      setEditableEdit(append);
    } else {
      setEditablePositive(append);
    }
  };
  const imageGenPositive = finalPositive ?? activeEffective;
  /* R5：预览块 textarea 也 auto-resize，对齐生图提示词编辑框的大小（不再固定高度） */
  const previewTextareaRef = useAutoResizeTextarea([imageGenPositive, selectedSlotIndices]);

  return (
    <div className="space-y-4 mt-3">
      {/* 🔒 核心卖点锁定区域 */}
      {SHOW_INFO_CARDS && (
      <Card className="border-l-4 border-l-orange-500 bg-codex-card">
        <h3 className="text-sm font-mono font-bold text-orange-400 mb-2">
          🔒 核心卖点（锁定）
        </h3>
        <div className="space-y-2 text-sm font-mono">
          <div className="flex gap-2">
            <span className="text-codex-text-secondary min-w-[5rem] shrink-0">卖点：</span>
            <span className="text-codex-text break-words min-w-0">{result.locked_core.core_selling_point}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-codex-text-secondary min-w-[5rem] shrink-0">类型：</span>
            <span className="text-codex-text break-words min-w-0">{result.locked_core.selling_point_type}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-codex-text-secondary min-w-[5rem] shrink-0">为何畅销：</span>
            <span className="text-codex-text break-words min-w-0">{result.locked_core.why_it_sells}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-codex-text-secondary min-w-[5rem] shrink-0">锁定规则：</span>
            <span className="text-codex-text break-words min-w-0">{result.locked_core.lock_rule}</span>
          </div>
        </div>
      </Card>
      )}

      {/* AI 推荐的改动（仅版本 B）。折叠交互与"中文结构化提示词"一致，默认收起——
          改动详情不是每次都需要细看，收起减少视觉干扰，想看时点标题栏展开。 */}
      {result.recommended_changes_detail && result.recommended_changes_detail.length > 0 && (
        <CollapsibleSection
          title="🎯 AI 推荐改动"
          defaultExpanded={false}
          titleColorClass="text-codex-success"
        >
          <div className="space-y-2">
            {result.recommended_changes_detail.map((change, idx) => (
              <div
                key={idx}
                className="flex flex-wrap items-start gap-2 text-sm font-mono p-2 bg-green-900/10 rounded border border-green-900/30"
              >
                <span className="text-codex-text-secondary min-w-[5rem] shrink-0">
                  {change.dimension}：
                </span>
                {change.original && (
                  <span className="text-codex-text-secondary line-through">
                    {change.original}
                  </span>
                )}
                {change.original && (
                  <span className="text-codex-text-secondary mx-1">→</span>
                )}
                <span className="text-codex-success font-medium">
                  {change.changed_to}
                </span>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* AI 推荐理由（仅版本 B） */}
      {SHOW_INFO_CARDS && result.reason && (
        <Card className="border-l-4 border-l-codex-accent bg-codex-card">
          <h3 className="text-sm font-mono font-bold text-codex-accent mb-2">
            💡 推荐理由
          </h3>
          <p className="text-sm font-mono text-codex-text leading-relaxed">
            {result.reason}
          </p>
        </Card>
      )}

      {/* #7：附带竞品原图开关——放在 MergedPromptBlock 正上方。只有"有竞品图 + 后端
          返回了编辑指令提示词 + 当前生图接口支持带图"三者都满足才可用，否则置灰
          并显示原因，用户点不了一个实际生效不了的开关。 */}
      {(() => {
        const noRuleImage = !hasRuleImage;
        const noEditPrompt = !result.image_prompt_edit;
        const notSupported = !supportsReference;
        const disabled = noRuleImage || noEditPrompt || notSupported;
        const disabledReason = notSupported
          ? '当前生图接口不支持参考图'
          : noRuleImage
            ? '该规则卡无竞品原图'
            : noEditPrompt
              ? '该版本暂未生成编辑指令提示词'
              : '';
        return (
          <div className="flex items-center gap-3 px-3 py-2 bg-codex-card border border-codex-border rounded-md">
            <label className={`flex items-center gap-2 text-sm font-mono ${disabled ? 'text-codex-text-secondary cursor-not-allowed' : 'text-codex-text cursor-pointer'}`}>
              <input
                type="checkbox"
                checked={useReference && !disabled}
                disabled={disabled}
                onChange={(e) => {
                  userToggledRef.current = true;
                  setUseReference(e.target.checked);
                }}
                className="cursor-pointer accent-codex-accent disabled:cursor-not-allowed"
              />
              🖼️ 附带竞品原图（编辑模式）
            </label>
            {disabled && disabledReason && (
              <span className="text-xs font-mono text-codex-text-secondary">（{disabledReason}）</span>
            )}
            {!disabled && ruleImageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={ruleImageUrl}
                alt="竞品原图"
                className="w-8 h-8 rounded object-cover border border-codex-border"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            )}
          </div>
        );
      })()}

      {/* 📝 生图提示词（正向+负向合并）。二期批次一：positive 改传 effectivePositive，
          让顶部编辑区直接显示"base + 已勾选片段"的完整内容，不用再看隐藏的预览框才能确认拼接结果。
          #7：改传 activeEffective——开关开着时显示编辑指令模式的拼接结果，否则完整描述模式。
          折叠交互与"中文结构化提示词"一致，默认展开（这是最常用的核心内容）。 */}
      <CollapsibleSection title="📝 生图提示词" defaultExpanded={true}>
        <MergedPromptBlock
          positive={activeEffective}
          negative={editableNegative}
          onPromptChange={(p, n) => {
            /* #7：完成编辑时回写到当前激活模式的 base（edit 或 positive），
               两套编辑互不覆盖——用户在编辑指令模式下改的内容不会污染完整描述模式的 base，反之亦然 */
            if (useReference && editableEdit) {
              setEditableEdit(p);
            } else {
              setEditablePositive(p);
            }
            setEditableNegative(n);
            /* 用户完成编辑时，已勾选片段已随 activeEffective 一起"烤入" p 成为新 base，
               勾选框复位避免二次拼接重复（不复位会导致同一片段被拼两次） */
            setSelectedSlotIndices([]);
          }}
        />
      </CollapsibleSection>

      {/* R4：可定制项勾选清单（A/B/C 三版均显示，后端返回了 customization_slots 时）。
       * 用户勾选后会在生图时把对应英文片段拼入正向提示词；未选则不改。
       * 放在 MergedPromptBlock（编辑区，只显示 base）之后、ImageGenSection（生图区，用叠加后的 effectivePositive）之前。
       * 折叠交互与"中文结构化提示词"一致，默认收起——大部分情况不需要额外定制，收起减少视觉干扰。 */}
      {result.customization_slots && result.customization_slots.length > 0 && (
        <CollapsibleSection
          title="🎨 可定制项（可选，勾选后拼入生图提示词）"
          defaultExpanded={false}
          titleColorClass="text-cyan-400"
        >
          <CustomizationSlotsSection
            slots={result.customization_slots}
            selectedIndices={selectedSlotIndices}
            onChange={setSelectedSlotIndices}
          />
        </CollapsibleSection>
      )}

      {/* R4：勾选了可定制项时，展示实际将用于生图的完整正向提示词（base + 勾选片段），
       * 让用户直观确认拼接结果，避免"勾了但不知道加没加"的困惑。
       * 二期批次一：默认隐藏——上方 MergedPromptBlock 已直接显示 activeEffective，
       * 这个预览框变得多余；finalPositive/previewTextareaRef state 保留不删，
       * 隐藏后不再被触发，imageGenPositive 自然回落 activeEffective。 */}
      {SHOW_FINAL_PREVIEW_BOX && selectedSlotIndices.length > 0 && selectedFragments.length > 0 && (
        <Card className="border-l-4 border-l-cyan-700 bg-codex-card">
          <h4 className="text-sm font-mono font-bold text-cyan-400 mb-2">
            📌 实际生图正向提示词（含勾选项，可编辑）
          </h4>
          <textarea
            ref={previewTextareaRef}
            value={finalPositive ?? activeEffective}
            onChange={(e) => setFinalPositive(e.target.value)}
            className="bg-codex-bg border border-codex-border rounded-lg p-3 text-sm font-mono text-codex-text w-full overflow-hidden focus:outline-none focus:border-codex-accent"
          />
          <p className="text-xs font-mono text-codex-text-secondary mt-1">
            勾选项已拼入，可在此微调后用于生图；改勾选会重新拼接
          </p>
        </Card>
      )}

      {/* 📄 中文结构化提示词（可收起） */}
      {result.structured_prompt_cn && (
        <CollapsiblePromptBlock
          title="📄 中文结构化提示词"
          content={result.structured_prompt_cn}
        />
      )}

      {/* 📋 改款说明 */}
      {SHOW_INFO_CARDS && (
      <Card className="bg-codex-card">
        <h3 className="text-sm font-mono font-bold text-codex-text mb-2">
          📋 改款说明
        </h3>
        <div className="space-y-2 text-sm font-mono">
          {/* 保留了 */}
          {result.change_summary.kept.length > 0 && (
            <div>
              <span className="text-codex-success font-medium">✅ 保留了：</span>
              <ul className="mt-1 ml-4 space-y-0.5">
                {result.change_summary.kept.map((item, idx) => (
                  <li key={idx} className="text-codex-text list-disc">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 改变了 */}
          {result.change_summary.changed.length > 0 && (
            <div>
              <span className="text-codex-warning font-medium">🔄 改变了：</span>
              <ul className="mt-1 ml-4 space-y-0.5">
                {result.change_summary.changed.map((item, idx) => (
                  <li key={idx} className="text-codex-text list-disc">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 基于规则 */}
          {result.change_summary.based_on_rule && (
            <div className="flex gap-2 pt-1 border-t border-codex-border">
              <span className="text-codex-text-secondary">📌 基于规则：</span>
              <span className="text-codex-accent">{result.change_summary.based_on_rule}</span>
            </div>
          )}
        </div>
      </Card>
      )}

      {/* 🖼️ 一键生图区域（需要 ruleId）。
          R4：promptPositive 用 imageGenPositive（激活模式的 base + 勾选的 fragment），
          promptNegative 仍用 editableNegative（可定制项只影响正向）。
          #7：attachRuleImage 传当前开关状态（=useReference），后端据此决定是否真的
          把竞品原图编码传给生图 API；referencePaths 本批次恒 []，批次五启用。
          折叠交互与"中文结构化提示词"一致，默认展开。 */}
      {ruleId && (
        <CollapsibleSection title="🖼️ 生成图片" defaultExpanded={true} titleColorClass="text-purple-400">
          <ImageGenSection
            ruleId={ruleId}
            ruleName={ruleName}
            version={version}
            promptPositive={imageGenPositive}
            promptNegative={editableNegative}
            attachRuleImage={useReference}
            referencePaths={referencePaths}
            onReferencePathsChange={setReferencePaths}
            onAppendFragment={handleAppendFragment}
          />
        </CollapsibleSection>
      )}
    </div>
  );
}

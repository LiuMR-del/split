'use client';

/**
 * 通用可折叠区域组件
 * 交互逻辑与原"中文结构化提示词"折叠块完全一致：点击标题栏展开/收起，
 * 右侧箭头随状态旋转。抽出后供"生图提示词/可定制项/生成图片/版本A/B/C 配置区"共用，
 * 不再各自维护一套折叠状态和标题栏样式。
 *
 * 默认非受控（内部自己管理展开状态，如中文结构化提示词）；
 * 传入 expanded + onExpandedChange 时切换为受控模式（如版本A/B/C 的配置区，
 * 需要在"生成成功"时由父组件强制收起）。
 */

import { useState, ReactNode } from 'react';

interface CollapsibleSectionProps {
  title: string;
  children: ReactNode;
  /** 非受控模式下的初始展开状态，默认 true（展开） */
  defaultExpanded?: boolean;
  /** 受控模式：传入后由父组件决定展开状态 */
  expanded?: boolean;
  /** 受控模式：点击标题栏时回调，父组件负责更新 expanded */
  onExpandedChange?: (expanded: boolean) => void;
  /** 标题文字颜色，对齐原 Card 左边框强调色（如 text-cyan-400），默认沿用普通文字色 */
  titleColorClass?: string;
  /** 容器左边框强调色（如 border-l-4 border-l-cyan-500），不传则是普通四边细边框 */
  accentBorderClass?: string;
}

export default function CollapsibleSection({
  title,
  children,
  defaultExpanded = true,
  expanded: controlledExpanded,
  onExpandedChange,
  titleColorClass = 'text-codex-text',
  accentBorderClass = '',
}: CollapsibleSectionProps) {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const isControlled = controlledExpanded !== undefined;
  const expanded = isControlled ? controlledExpanded : internalExpanded;

  const toggle = () => {
    const next = !expanded;
    if (isControlled) {
      onExpandedChange?.(next);
    } else {
      setInternalExpanded(next);
    }
  };

  return (
    <div className={`border border-codex-border rounded-lg overflow-hidden bg-codex-card ${accentBorderClass}`}>
      {/* 标题栏（可点击展开/收起，与中文结构化提示词交互一致） */}
      <button
        onClick={toggle}
        className={`
          w-full flex items-center justify-between
          px-3 py-2.5
          bg-codex-card hover:bg-codex-border/30
          text-sm font-mono font-bold ${titleColorClass}
          transition-colors duration-150
          cursor-pointer
        `}
      >
        <span>{title}</span>
        <span
          className={`
            text-codex-text-secondary transition-transform duration-200
            ${expanded ? 'rotate-180' : ''}
          `}
        >
          ▼
        </span>
      </button>

      {/* 展开后的内容 */}
      {expanded && (
        <div className="p-3 border-t border-codex-border">
          {children}
        </div>
      )}
    </div>
  );
}

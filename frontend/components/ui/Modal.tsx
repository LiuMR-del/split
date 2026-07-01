'use client';

/**
 * 通用弹窗组件
 * 全屏遮罩 + 居中内容区
 * 支持 sm/md/lg/xl 宽度
 * 点击遮罩或右上角 X 关闭
 * Codex 深色风格
 */

import { ReactNode, useEffect, useCallback } from 'react';

type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

interface ModalProps {
  children: ReactNode;
  onClose: () => void;
  size?: ModalSize;
  title?: string;
  className?: string;
}

/* 各尺寸对应的最大宽度 */
const sizeStyles: Record<ModalSize, string> = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-3xl',
  xl: 'max-w-5xl',
};

export default function Modal({
  children,
  onClose,
  size = 'md',
  title,
  className = '',
}: ModalProps) {
  /* ESC 键关闭 */
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    /* 阻止背景滚动 */
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [handleKeyDown]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* 半透明黑色遮罩 */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />

      {/* 内容区 */}
      <div
        className={`
          relative w-full ${sizeStyles[size]}
          mx-4 max-h-[90vh] overflow-y-auto
          bg-codex-card border border-codex-border rounded-lg
          shadow-2xl
          ${className}
        `}
      >
        {/* 顶部标题栏（如有标题） */}
        {title && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-codex-border">
            <h2 className="text-lg font-mono font-bold text-codex-text">
              {title}
            </h2>
            <button
              onClick={onClose}
              className="text-codex-text-secondary hover:text-codex-text transition-colors text-xl cursor-pointer"
              aria-label="关闭"
            >
              ✕
            </button>
          </div>
        )}

        {/* 无标题时仅显示关闭按钮 */}
        {!title && (
          <button
            onClick={onClose}
            className="absolute top-3 right-3 z-10 text-codex-text-secondary hover:text-codex-text transition-colors text-xl cursor-pointer"
            aria-label="关闭"
          >
            ✕
          </button>
        )}

        {/* 内容 */}
        <div className={title ? 'p-6' : 'p-6 pt-10'}>
          {children}
        </div>
      </div>
    </div>
  );
}

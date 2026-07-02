'use client';

/**
 * 文件上传组件
 * 支持拖拽上传、点击选择、剪贴板粘贴（Ctrl+V / Cmd+V）上传
 * 选择文件后显示预览缩略图
 * Codex 深色风格
 */

import { useRef, useState, useCallback, useEffect } from 'react';

interface FileUploadProps {
  onFileSelect: (file: File) => void;
  accept?: string;
  uploading?: boolean;
}

export default function FileUpload({
  onFileSelect,
  accept = 'image/*',
  uploading = false,
}: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  /* 粘贴成功后的短暂提示反馈 */
  const [pasteFlash, setPasteFlash] = useState(false);

  /* 处理文件选择 */
  const handleFile = useCallback(
    (file: File) => {
      /* 生成预览 URL */
      const url = URL.createObjectURL(file);
      setPreview(url);
      onFileSelect(file);
    },
    [onFileSelect]
  );

  /* 点击触发文件选择 */
  const handleClick = () => {
    if (!uploading) {
      inputRef.current?.click();
    }
  };

  /* input change 事件 */
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  /* 拖拽事件 */
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  /*
   * 剪贴板粘贴上传（Ctrl+V / Cmd+V）。
   * 监听在 document 上而不是组件内部：浏览器的粘贴事件不会像点击那样
   * 冒泡到刚渲染的容器上，用户复制一张图后可能焦点还停留在别处
   * （比如刚从截图工具切回来），只在组件内监听会经常"贴了没反应"。
   * 用 document 监听 + 组件挂载期间才生效，离开页面自动清理。
   */
  useEffect(() => {
    if (uploading) return;

    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            handleFile(file);
            /* 短暂高亮反馈，告诉用户粘贴生效了 */
            setPasteFlash(true);
            setTimeout(() => setPasteFlash(false), 500);
          }
          break;
        }
      }
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [uploading, handleFile]);

  return (
    <div
      ref={containerRef}
      onClick={handleClick}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`
        relative flex flex-col items-center justify-center
        w-full min-h-[200px] p-6
        border-2 border-dashed rounded-lg
        transition-colors duration-150 cursor-pointer
        ${dragOver || pasteFlash
          ? 'border-codex-accent bg-codex-accent/5'
          : 'border-codex-border hover:border-codex-text-secondary'
        }
      `}
    >
      {/* 隐藏的文件 input */}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleChange}
        className="hidden"
      />

      {/* 预览缩略图 */}
      {preview ? (
        <div className="flex flex-col items-center gap-3">
          <img
            src={preview}
            alt="预览"
            className="max-h-[160px] max-w-full rounded-md object-contain"
          />
          <p className="text-xs text-codex-text-secondary font-mono">
            点击重新选择，或直接粘贴新图片替换
          </p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <span className="text-4xl">📸</span>
          <p className="text-sm text-codex-text-secondary font-mono text-center">
            拖拽图片到此处、点击选择，或按 Ctrl+V（Mac: ⌘+V）粘贴
          </p>
        </div>
      )}

      {/* 上传中遮罩 */}
      {uploading && (
        <div className="absolute inset-0 flex items-center justify-center bg-codex-bg/70 rounded-lg">
          <div className="flex flex-col items-center gap-2">
            <span className="inline-block w-8 h-8 border-2 border-codex-accent border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-codex-accent font-mono">上传中...</p>
          </div>
        </div>
      )}
    </div>
  );
}

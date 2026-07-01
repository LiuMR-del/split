'use client';

/**
 * 文件上传组件
 * 支持拖拽上传和点击选择
 * 选择文件后显示预览缩略图
 * Codex 深色风格
 */

import { useRef, useState, useCallback } from 'react';

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
  const [preview, setPreview] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

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

  return (
    <div
      onClick={handleClick}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`
        relative flex flex-col items-center justify-center
        w-full min-h-[200px] p-6
        border-2 border-dashed rounded-lg
        transition-colors duration-150 cursor-pointer
        ${dragOver
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
            点击重新选择
          </p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <span className="text-4xl">📸</span>
          <p className="text-sm text-codex-text-secondary font-mono text-center">
            拖拽图片到此处，或点击选择
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

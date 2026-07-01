'use client';

/**
 * 图片上传组件
 * 支持批量上传、拖拽选择、AI自动打标
 * 上传进度显示
 * Codex 深色风格
 */

import { useRef, useState, useCallback } from 'react';
import { apiUpload } from '@/lib/api';
import Button from '@/components/ui/Button';

interface ImageUploaderProps {
  /** 上传完成后的回调，用于刷新列表 */
  onUploadComplete: () => void;
  /** 控制显示/隐藏 */
  onClose?: () => void;
}

interface FileItem {
  file: File;
  preview: string;
}

export default function ImageUploader({
  onUploadComplete,
  onClose,
}: ImageUploaderProps) {
  /* 已选择的文件列表 */
  const [files, setFiles] = useState<FileItem[]>([]);
  /* 自动 AI 打标开关 */
  const [autoTag, setAutoTag] = useState(true);
  /* 上传状态 */
  const [uploading, setUploading] = useState(false);
  /* 上传进度：已完成数 / 总数 */
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  /* 错误信息 */
  const [error, setError] = useState('');
  /* 拖拽状态 */
  const [dragOver, setDragOver] = useState(false);
  /* 隐藏文件输入引用 */
  const inputRef = useRef<HTMLInputElement>(null);

  /* 处理文件添加（去重） */
  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const arr = Array.from(newFiles).filter(
      (f) => f.type.startsWith('image/')
    );
    if (arr.length === 0) return;

    setFiles((prev) => {
      const existingNames = new Set(prev.map((p) => p.file.name));
      const additions = arr
        .filter((f) => !existingNames.has(f.name))
        .map((file) => ({
          file,
          preview: URL.createObjectURL(file),
        }));
      return [...prev, ...additions];
    });
  }, []);

  /* 移除单个文件 */
  const removeFile = (index: number) => {
    setFiles((prev) => {
      URL.revokeObjectURL(prev[index].preview);
      return prev.filter((_, i) => i !== index);
    });
  };

  /* 点击选择文件 */
  const handleClick = () => {
    if (!uploading) inputRef.current?.click();
  };

  /* input change */
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(e.target.files);
    /* 重置 input 以允许重复选择同一文件 */
    e.target.value = '';
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
    if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
  };

  /* 开始上传 */
  const handleUpload = async () => {
    if (files.length === 0) return;

    setUploading(true);
    setError('');
    setProgress({ done: 0, total: files.length });

    try {
      const formData = new FormData();
      files.forEach((item) => {
        formData.append('files', item.file);
      });
      formData.append('auto_tag', String(autoTag));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await apiUpload<any>('/api/library/upload', formData);

      setProgress({ done: files.length, total: files.length });

      /* 短暂延迟后清理并回调 */
      setTimeout(() => {
        /* 释放预览 URL */
        files.forEach((item) => URL.revokeObjectURL(item.preview));
        setFiles([]);
        setUploading(false);
        onUploadComplete();
        onClose?.();
      }, 800);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '上传失败';
      setError(msg);
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* 拖拽区域 */}
      <div
        onClick={handleClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`
          flex flex-col items-center justify-center
          w-full min-h-[150px] p-6
          border-2 border-dashed rounded-lg
          transition-colors duration-150 cursor-pointer
          ${dragOver
            ? 'border-codex-accent bg-codex-accent/5'
            : 'border-codex-border hover:border-codex-text-secondary'
          }
        `}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleChange}
          className="hidden"
        />
        <span className="text-3xl mb-2">📁</span>
        <p className="text-sm text-codex-text-secondary font-mono text-center">
          拖拽图片到此处，或点击选择（支持多选）
        </p>
      </div>

      {/* 已选文件列表 */}
      {files.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-mono text-codex-text-secondary">
            已选择 {files.length} 个文件
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-[200px] overflow-y-auto">
            {files.map((item, idx) => (
              <div
                key={idx}
                className="relative group bg-codex-bg border border-codex-border rounded-md p-1"
              >
                <img
                  src={item.preview}
                  alt={item.file.name}
                  className="w-full h-16 object-cover rounded"
                />
                <p className="text-[10px] font-mono text-codex-text-secondary truncate mt-1 px-0.5">
                  {item.file.name}
                </p>
                {/* 删除按钮 */}
                {!uploading && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile(idx);
                    }}
                    className="absolute top-0 right-0 w-5 h-5 flex items-center justify-center bg-codex-danger/80 text-white text-xs rounded-bl-md rounded-tr-md opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI 打标选项 */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={autoTag}
          onChange={(e) => setAutoTag(e.target.checked)}
          className="w-4 h-4 accent-[var(--color-codex-accent)] bg-codex-card border-codex-border rounded"
        />
        <span className="text-sm font-mono text-codex-text">
          🤖 自动 AI 打标
        </span>
      </label>

      {/* 上传进度条 */}
      {uploading && (
        <div className="space-y-2">
          <div className="w-full h-2 bg-codex-border rounded-full overflow-hidden">
            <div
              className="h-full bg-codex-accent rounded-full transition-all duration-300"
              style={{
                width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%`,
              }}
            />
          </div>
          <p className="text-xs font-mono text-codex-text-secondary text-center">
            {progress.done === progress.total
              ? `✅ 上传完成 (${progress.done}/${progress.total})`
              : `上传中... (${progress.done}/${progress.total})`}
          </p>
        </div>
      )}

      {/* 错误提示 */}
      {error && (
        <div className="px-4 py-2 bg-red-900/20 border border-codex-danger rounded-md">
          <p className="text-sm font-mono text-codex-danger">&#10060; {error}</p>
        </div>
      )}

      {/* 操作按钮 */}
      <div className="flex gap-3 justify-end">
        {onClose && (
          <Button variant="secondary" onClick={onClose} disabled={uploading}>
            取消
          </Button>
        )}
        <Button
          variant="primary"
          onClick={handleUpload}
          loading={uploading}
          disabled={files.length === 0}
        >
          开始上传
        </Button>
      </div>
    </div>
  );
}

'use client';

/**
 * 图片网格展示组件
 * 响应式网格布局，展示图库中的图片卡片
 * 每张卡片显示缩略图、标签、AI/人工审核状态
 * Codex 深色风格
 */

import Badge from '@/components/ui/Badge';
import { getImageUrl } from '@/lib/api';

/* 图库图片数据类型 —— 字段与后端 API 返回保持一致 */
export interface LibraryImage {
  /** 后端 image_id（如 IMG-0001） */
  image_id: string;
  /** 兼容旧字段：id 等价于 image_id */
  id?: string;
  filename: string;
  /** 原图相对 URL（/library-images/xxx） */
  file_path?: string;
  /** 缩略图相对 URL（/library-thumbnails/xxx） */
  thumbnail_path?: string;
  /** 主题标签 */
  themes?: string[];
  /** 风格标签 */
  styles?: string[];
  /** 色彩情绪标签 */
  color_moods?: string[];
  /** 情绪标签 */
  emotions?: string[];
  /** 目标人群 */
  target_audiences?: string[];
  /** 描述 */
  description?: string;
  /** 元素 */
  elements?: string[];
  /** AI 是否已打标 */
  ai_tagged?: boolean;
  /** 人工是否已审核 */
  manually_reviewed?: boolean;
  /** 构图类型 */
  layout_type?: string;
  /** 创建时间 */
  created_date?: string;
}

interface ImageGridProps {
  images: LibraryImage[];
  onImageClick: (image: LibraryImage) => void;
}

export default function ImageGrid({ images, onImageClick }: ImageGridProps) {
  /* 空状态 */
  if (images.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-codex-text-secondary">
        <span className="text-5xl mb-4">📭</span>
        <p className="text-sm font-mono">暂无图片，点击上方"上传图片"按钮添加</p>
      </div>
    );
  }

  /* 收集一张图的所有标签（直接从顶层字段读取） */
  const collectTags = (image: LibraryImage): string[] => {
    const tags: string[] = [];
    if (image.themes) tags.push(...image.themes);
    if (image.styles) tags.push(...image.styles);
    if (image.color_moods) tags.push(...image.color_moods);
    if (image.emotions) tags.push(...image.emotions);
    if (image.layout_type) tags.push(image.layout_type);
    return tags;
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {images.map((image) => {
        const allTags = collectTags(image);
        const displayTags = allTags.slice(0, 4);
        const extraCount = allTags.length - 4;
        /* 缩略图 URL：拼接后端地址 */
        const thumbUrl = image.thumbnail_path
          ? getImageUrl(image.thumbnail_path)
          : null;

        return (
          <div
            key={image.image_id || image.id}
            onClick={() => onImageClick(image)}
            className="
              bg-codex-card border border-codex-border rounded-lg
              overflow-hidden cursor-pointer
              transition-all duration-200
              hover:border-codex-accent hover:shadow-lg hover:shadow-codex-accent/10
              group
            "
          >
            {/* 缩略图区域 */}
            <div className="relative w-full h-40 bg-codex-bg flex items-center justify-center overflow-hidden">
              {thumbUrl ? (
                <img
                  src={thumbUrl}
                  alt={image.filename}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
              ) : (
                <span className="text-4xl text-codex-text-secondary">&#128247;</span>
              )}

              {/* 右上角状态指示 */}
              <div className="absolute top-2 right-2 flex gap-1">
                {image.ai_tagged ? (
                  <span className="px-1.5 py-0.5 text-[10px] font-mono bg-codex-accent/20 text-codex-accent border border-codex-accent/40 rounded">
                    AI
                  </span>
                ) : (
                  <span className="px-1.5 py-0.5 text-[10px] font-mono bg-codex-warning/20 text-codex-warning border border-codex-warning/40 rounded">
                    未标
                  </span>
                )}
                {image.manually_reviewed && (
                  <span className="px-1.5 py-0.5 text-[10px] font-mono bg-codex-success/20 text-codex-success border border-codex-success/40 rounded">
                    &#9989;
                  </span>
                )}
              </div>
            </div>

            {/* 底部标签区域 */}
            <div className="p-3">
              <p className="text-xs font-mono text-codex-text-secondary truncate mb-2">
                {image.filename}
              </p>
              {displayTags.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {displayTags.map((tag, idx) => (
                    <Badge key={idx} variant="default">
                      {tag}
                    </Badge>
                  ))}
                  {extraCount > 0 && (
                    <Badge variant="default">+{extraCount}</Badge>
                  )}
                </div>
              ) : (
                <p className="text-[10px] font-mono text-codex-text-secondary/60">
                  暂无标签
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

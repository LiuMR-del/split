'use client';

/**
 * 图库管理主页面
 * 包含：顶部标题+统计+上传按钮、筛选栏、图片网格、分页
 * Codex 深色风格
 */

import { useState, useEffect, useCallback } from 'react';
import { apiGet } from '@/lib/api';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import Select from '@/components/ui/Select';
import Modal from '@/components/ui/Modal';
import ImageUploader from '@/components/library/ImageUploader';
import ImageGrid, { type LibraryImage } from '@/components/library/ImageGrid';
import ImageDetailModal from '@/components/library/ImageDetailModal';

/* 词表类型 */
interface Vocabularies {
  style?: string[];
  color_mood?: string[];
  core_emotion?: string[];
  [key: string]: string[] | undefined;
}

/* 分页响应类型 —— 对应后端 { success, data: { items, total, page, ... } } */
interface LibraryListData {
  items?: LibraryImage[];
  total?: number;
  page?: number;
  page_size?: number;
  total_pages?: number;
}

interface LibraryResponse {
  success?: boolean;
  data?: LibraryListData;
}

export default function LibraryPage() {
  /* 图片列表 */
  const [images, setImages] = useState<LibraryImage[]>([]);
  /* 总数 */
  const [total, setTotal] = useState(0);
  /* 分页 */
  const [page, setPage] = useState(1);
  const pageSize = 20;
  /* 加载状态 */
  const [loading, setLoading] = useState(true);
  /* 错误 */
  const [error, setError] = useState('');

  /* 筛选条件 */
  const [filterTheme, setFilterTheme] = useState('');
  const [filterStyle, setFilterStyle] = useState('');
  const [filterColorMood, setFilterColorMood] = useState('');
  const [filterEmotion, setFilterEmotion] = useState('');

  /* 弹窗状态 */
  const [showUploader, setShowUploader] = useState(false);
  const [selectedImage, setSelectedImage] = useState<LibraryImage | null>(null);

  /* 词表数据 */
  const [vocabularies, setVocabularies] = useState<Vocabularies>({});

  /* 加载词表 */
  useEffect(() => {
    const loadVocabularies = async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await apiGet<any>('/api/vocabularies');
        setVocabularies(res.data || res || {});
      } catch {
        /* 词表加载失败不影响主功能 */
      }
    };
    loadVocabularies();
  }, []);

  /* 加载图片列表 */
  const loadImages = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      /* 构建查询参数 */
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('page_size', String(pageSize));
      if (filterTheme) params.set('theme', filterTheme);
      if (filterStyle) params.set('style', filterStyle);
      if (filterColorMood) params.set('color_mood', filterColorMood);
      if (filterEmotion) params.set('emotion', filterEmotion);

      const res = await apiGet<LibraryResponse>(
        `/api/library?${params.toString()}`
      );

      /* 防御性解包：后端返回 { success, data: { items, total, ... } } */
      const payload = res.data || {};
      const items = payload.items || [];
      setImages(Array.isArray(items) ? items : []);
      setTotal(payload.total || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载图库失败');
    } finally {
      setLoading(false);
    }
  }, [page, filterTheme, filterStyle, filterColorMood, filterEmotion]);

  /* 初始加载 + 筛选/分页变化时重新加载 */
  useEffect(() => {
    loadImages();
  }, [loadImages]);

  /* 筛选变化时重置到第一页 */
  const handleFilterChange = (
    setter: (v: string) => void,
    value: string
  ) => {
    setter(value);
    setPage(1);
  };

  /* 总页数 */
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  /* 风格筛选选项 */
  const styleFilterOptions = [
    { label: '全部风格', value: '' },
    ...(vocabularies.style || []).map((s) => ({ label: s, value: s })),
  ];

  /* 色彩情绪筛选选项 */
  const colorMoodFilterOptions = [
    { label: '全部色彩', value: '' },
    ...(vocabularies.color_mood || []).map((c) => ({ label: c, value: c })),
  ];

  /* 情绪筛选选项 */
  const emotionFilterOptions = [
    { label: '全部情绪', value: '' },
    ...(vocabularies.core_emotion || []).map((e) => ({ label: e, value: e })),
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* 顶部：标题 + 统计 + 上传按钮 */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Link
              href="/"
              className="text-codex-text-secondary hover:text-codex-text font-mono text-sm transition-colors"
            >
              ← 返回
            </Link>
            <h1 className="text-2xl font-bold text-codex-text font-mono">
              &#128218; 自有图库
            </h1>
          </div>
          <p className="text-sm text-codex-text-secondary font-mono mt-1">
            共 {total} 张图片
          </p>
        </div>
        <Button variant="primary" onClick={() => setShowUploader(true)}>
          &#128228; 上传图片
        </Button>
      </div>

      {/* 筛选栏 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6 p-4 bg-codex-card border border-codex-border rounded-lg">
        {/* 主题筛选（文字输入） */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm text-codex-text-secondary font-mono">
            🎨 主题
          </label>
          <input
            type="text"
            value={filterTheme}
            onChange={(e) => handleFilterChange(setFilterTheme, e.target.value)}
            placeholder="输入主题关键词..."
            className="
              w-full px-3 py-2 text-sm font-mono
              bg-codex-bg text-codex-text
              border border-codex-border rounded-md
              placeholder:text-codex-text-secondary/50
              focus:outline-none focus:border-codex-accent focus:ring-1 focus:ring-codex-accent/30
            "
          />
        </div>

        {/* 风格筛选 */}
        <Select
          label="🖌️ 风格"
          options={styleFilterOptions}
          value={filterStyle}
          onChange={(v) => handleFilterChange(setFilterStyle, v)}
        />

        {/* 色彩情绪筛选 */}
        <Select
          label="🌈 色彩情绪"
          options={colorMoodFilterOptions}
          value={filterColorMood}
          onChange={(v) => handleFilterChange(setFilterColorMood, v)}
        />

        {/* 情绪筛选 */}
        <Select
          label="💫 情绪"
          options={emotionFilterOptions}
          value={filterEmotion}
          onChange={(v) => handleFilterChange(setFilterEmotion, v)}
        />
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mb-6 px-4 py-3 bg-red-900/20 border border-codex-danger rounded-md">
          <p className="text-sm font-mono text-codex-danger">&#10060; {error}</p>
          <Button
            variant="secondary"
            size="sm"
            onClick={loadImages}
            className="mt-2"
          >
            重试
          </Button>
        </div>
      )}

      {/* 加载骨架屏 */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="bg-codex-card border border-codex-border rounded-lg overflow-hidden animate-pulse"
            >
              <div className="w-full h-40 bg-codex-border/30" />
              <div className="p-3 space-y-2">
                <div className="h-3 bg-codex-border/30 rounded w-3/4" />
                <div className="flex gap-1">
                  <div className="h-5 bg-codex-border/30 rounded-full w-12" />
                  <div className="h-5 bg-codex-border/30 rounded-full w-16" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* 图片网格 */
        <ImageGrid
          images={images}
          onImageClick={(img) => setSelectedImage(img)}
        />
      )}

      {/* 分页 */}
      {!loading && total > pageSize && (
        <div className="flex items-center justify-center gap-3 mt-8">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            &#9664; 上一页
          </Button>
          <span className="text-sm font-mono text-codex-text-secondary">
            第 {page} / {totalPages} 页
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            下一页 &#9654;
          </Button>
        </div>
      )}

      {/* 上传弹窗 */}
      {showUploader && (
        <Modal
          onClose={() => setShowUploader(false)}
          size="lg"
          title="&#128228; 上传图片"
        >
          <ImageUploader
            onUploadComplete={() => {
              setShowUploader(false);
              setPage(1);
              loadImages();
            }}
            onClose={() => setShowUploader(false)}
          />
        </Modal>
      )}

      {/* 图片详情弹窗 */}
      {selectedImage && (
        <ImageDetailModal
          image={selectedImage}
          onClose={() => setSelectedImage(null)}
          onSave={() => {
            setSelectedImage(null);
            loadImages();
          }}
          vocabularies={vocabularies}
        />
      )}
    </div>
  );
}

'use client';

/**
 * 图片详情弹窗组件
 * 左侧大图展示，右侧标签编辑表单
 * 支持 AI 重新打标、保存、删除操作
 * Codex 深色风格
 */

import { useState, useEffect } from 'react';
import { apiPost, apiPut, apiDelete, getImageUrl, unwrapData } from '@/lib/api';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import Select from '@/components/ui/Select';
import TagSelector from '@/components/rules/TagSelector';
import type { LibraryImage } from '@/components/library/ImageGrid';

/* 词表数据类型 */
interface Vocabularies {
  style?: string[];
  color_mood?: string[];
  core_emotion?: string[];
  [key: string]: string[] | undefined;
}

interface ImageDetailModalProps {
  image: LibraryImage;
  onClose: () => void;
  onSave: () => void;
  vocabularies: Vocabularies;
}

export default function ImageDetailModal({
  image,
  onClose,
  onSave,
  vocabularies,
}: ImageDetailModalProps) {
  /* 标签编辑状态 —— 从顶层字段读取（对应后端扁平结构） */
  const [themes, setThemes] = useState<string[]>(image.themes || []);
  const [style, setStyle] = useState(
    (image.styles && image.styles.length > 0) ? image.styles[0] : ''
  );
  const [colorMood, setColorMood] = useState(
    (image.color_moods && image.color_moods.length > 0) ? image.color_moods[0] : ''
  );
  const [emotions, setEmotions] = useState<string[]>(image.emotions || []);
  const [targetAudience, setTargetAudience] = useState<string[]>(
    image.target_audiences || []
  );
  const [description, setDescription] = useState(image.description || '');
  const [elements, setElements] = useState<string[]>(image.elements || []);
  /* 构图类型 */
  const [layoutType, setLayoutType] = useState(image.layout_type || '');

  /* 操作状态 */
  const [saving, setSaving] = useState(false);
  const [tagging, setTagging] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  /* 新元素输入 */
  const [newElement, setNewElement] = useState('');
  /* 自定义主题输入 */
  const [newTheme, setNewTheme] = useState('');

  /* 图片 URL —— file_path 为原图相对 URL */
  const imageUrl = image.file_path
    ? getImageUrl(image.file_path)
    : image.thumbnail_path
      ? getImageUrl(image.thumbnail_path)
      : null;

  /* 成功提示自动消失 */
  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(''), 3000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  /* 保存标签 —— 后端 PUT /api/library/{image_id} */
  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const imageId = image.image_id || image.id;
      await apiPut(`/api/library/${imageId}`, {
        themes,
        styles: style ? [style] : [],
        color_moods: colorMood ? [colorMood] : [],
        emotions,
        target_audiences: targetAudience,
        description,
        elements,
        layout_type: layoutType || undefined,
        manually_reviewed: true,
      });
      setSuccess('保存成功');
      onSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  /* AI 重新打标 */
  const handleAiTag = async () => {
    setTagging(true);
    setError('');
    try {
      const imageId = image.image_id || image.id;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await apiPost<any>(`/api/library/${imageId}/tag`);
      const tags = unwrapData<any>(res) || {};
      /* 用 AI 返回的标签更新表单（后端返回扁平结构） */
      if (tags.themes) setThemes(tags.themes);
      if (tags.styles?.length) setStyle(tags.styles[0]);
      if (tags.color_moods?.length) setColorMood(tags.color_moods[0]);
      if (tags.emotions) setEmotions(tags.emotions);
      if (tags.target_audiences) setTargetAudience(tags.target_audiences);
      if (tags.description) setDescription(tags.description);
      if (tags.elements) setElements(tags.elements);
      if (tags.layout_type) setLayoutType(tags.layout_type);
      setSuccess('AI 打标完成，请检查后保存');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI 打标失败');
    } finally {
      setTagging(false);
    }
  };

  /* 删除图片 */
  const handleDelete = async () => {
    setDeleting(true);
    setError('');
    try {
      const imageId = image.image_id || image.id;
      await apiDelete(`/api/library/${imageId}`);
      onSave();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
      setDeleting(false);
    }
  };

  /* 添加元素 */
  const addElement = () => {
    const val = newElement.trim();
    if (val && !elements.includes(val)) {
      setElements([...elements, val]);
      setNewElement('');
    }
  };

  /* 添加自定义主题 */
  const addCustomTheme = () => {
    const val = newTheme.trim();
    if (val && !themes.includes(val)) {
      setThemes([...themes, val]);
      setNewTheme('');
    }
  };

  /* 风格选项 */
  const styleOptions = [
    { label: '— 请选择风格 —', value: '' },
    ...(vocabularies.style || []).map((s) => ({ label: s, value: s })),
  ];

  /* 色彩情绪选项 */
  const colorMoodOptions = [
    { label: '— 请选择色彩情绪 —', value: '' },
    ...(vocabularies.color_mood || []).map((c) => ({ label: c, value: c })),
  ];

  /* 构图类型选项 */
  const layoutTypeOptions = [
    { label: '— 请选择构图 —', value: '' },
    ...(vocabularies.layout_type || []).map((l) => ({ label: l, value: l })),
  ];

  return (
    <Modal onClose={onClose} size="xl" title={`📷 ${image.filename}`}>
      <div className="flex flex-col lg:flex-row gap-6">
        {/* 左侧：图片大图 */}
        <div className="lg:w-1/2 flex-shrink-0">
          <div className="w-full bg-codex-bg border border-codex-border rounded-lg overflow-hidden flex items-center justify-center min-h-[300px]">
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={image.filename}
                className="w-full h-auto max-h-[500px] object-contain"
              />
            ) : (
              <span className="text-6xl text-codex-text-secondary">&#128247;</span>
            )}
          </div>

          {/* 状态信息 */}
          <div className="flex gap-2 mt-3">
            <span
              className={`px-2 py-1 text-xs font-mono rounded border ${
                image.ai_tagged
                  ? 'bg-codex-accent/10 text-codex-accent border-codex-accent/30'
                  : 'bg-codex-warning/10 text-codex-warning border-codex-warning/30'
              }`}
            >
              {image.ai_tagged ? '🤖 AI 已打标' : '⏳ 未打标'}
            </span>
            <span
              className={`px-2 py-1 text-xs font-mono rounded border ${
                image.manually_reviewed
                  ? 'bg-codex-success/10 text-codex-success border-codex-success/30'
                  : 'bg-codex-card text-codex-text-secondary border-codex-border'
              }`}
            >
              {image.manually_reviewed ? '✅ 已审核' : '📝 未审核'}
            </span>
          </div>
        </div>

        {/* 右侧：标签编辑表单 */}
        <div className="lg:w-1/2 space-y-4">
          {/* 主题（多选 + 自定义） */}
          <div className="space-y-1.5">
            <label className="text-sm text-codex-text-secondary font-mono">
              🎨 主题
            </label>
            {/* 已选标签 */}
            {themes.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {themes.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-mono border bg-codex-card text-codex-text border-codex-border"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => setThemes(themes.filter((t) => t !== tag))}
                      className="text-codex-text-secondary hover:text-codex-danger transition-colors cursor-pointer ml-0.5"
                    >
                      &times;
                    </button>
                  </span>
                ))}
              </div>
            )}
            {/* 添加自定义主题 */}
            <div className="flex gap-2">
              <input
                type="text"
                value={newTheme}
                onChange={(e) => setNewTheme(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addCustomTheme();
                  }
                }}
                placeholder="输入主题后回车添加..."
                className="
                  flex-1 px-3 py-1.5 text-xs font-mono
                  bg-codex-card text-codex-text
                  border border-codex-border rounded-md
                  placeholder:text-codex-text-secondary/50
                  focus:outline-none focus:border-codex-accent focus:ring-1 focus:ring-codex-accent/30
                "
              />
              <Button size="sm" variant="secondary" onClick={addCustomTheme}>
                +
              </Button>
            </div>
          </div>

          {/* 风格（下拉） */}
          <Select
            label="🖌️ 风格"
            options={styleOptions}
            value={style}
            onChange={setStyle}
          />

          {/* 色彩情绪（下拉） */}
          <Select
            label="🌈 色彩情绪"
            options={colorMoodOptions}
            value={colorMood}
            onChange={setColorMood}
          />

          {/* 构图（下拉） */}
          <Select
            label="🏗 构图"
            options={layoutTypeOptions}
            value={layoutType}
            onChange={setLayoutType}
          />

          {/* 情绪（多选） */}
          <TagSelector
            label="💫 情绪"
            options={vocabularies.core_emotion || []}
            selected={emotions}
            onChange={setEmotions}
          />

          {/* 目标人群（多选自定义） */}
          <div className="space-y-1.5">
            <label className="text-sm text-codex-text-secondary font-mono">
              👥 目标人群
            </label>
            {targetAudience.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {targetAudience.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-mono border bg-codex-card text-codex-text border-codex-border"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() =>
                        setTargetAudience(targetAudience.filter((t) => t !== tag))
                      }
                      className="text-codex-text-secondary hover:text-codex-danger transition-colors cursor-pointer ml-0.5"
                    >
                      &times;
                    </button>
                  </span>
                ))}
              </div>
            )}
            <input
              type="text"
              placeholder="输入目标人群后回车添加..."
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const val = (e.target as HTMLInputElement).value.trim();
                  if (val && !targetAudience.includes(val)) {
                    setTargetAudience([...targetAudience, val]);
                    (e.target as HTMLInputElement).value = '';
                  }
                }
              }}
              className="
                w-full px-3 py-1.5 text-xs font-mono
                bg-codex-card text-codex-text
                border border-codex-border rounded-md
                placeholder:text-codex-text-secondary/50
                focus:outline-none focus:border-codex-accent focus:ring-1 focus:ring-codex-accent/30
              "
            />
          </div>

          {/* 描述 */}
          <div className="space-y-1.5">
            <label className="text-sm text-codex-text-secondary font-mono">
              📝 描述
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="输入图片描述..."
              className="
                w-full px-3 py-2 text-xs font-mono
                bg-codex-card text-codex-text
                border border-codex-border rounded-md
                placeholder:text-codex-text-secondary/50
                focus:outline-none focus:border-codex-accent focus:ring-1 focus:ring-codex-accent/30
                resize-none
              "
            />
          </div>

          {/* 元素 */}
          <div className="space-y-1.5">
            <label className="text-sm text-codex-text-secondary font-mono">
              🧩 元素
            </label>
            {elements.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {elements.map((el, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-mono border bg-codex-card text-codex-text border-codex-border"
                  >
                    {el}
                    <button
                      type="button"
                      onClick={() =>
                        setElements(elements.filter((_, i) => i !== idx))
                      }
                      className="text-codex-text-secondary hover:text-codex-danger transition-colors cursor-pointer ml-0.5"
                    >
                      &times;
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input
                type="text"
                value={newElement}
                onChange={(e) => setNewElement(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addElement();
                  }
                }}
                placeholder="输入元素后回车添加..."
                className="
                  flex-1 px-3 py-1.5 text-xs font-mono
                  bg-codex-card text-codex-text
                  border border-codex-border rounded-md
                  placeholder:text-codex-text-secondary/50
                  focus:outline-none focus:border-codex-accent focus:ring-1 focus:ring-codex-accent/30
                "
              />
              <Button size="sm" variant="secondary" onClick={addElement}>
                +
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* 提示信息 */}
      {error && (
        <div className="mt-4 px-4 py-2 bg-red-900/20 border border-codex-danger rounded-md">
          <p className="text-sm font-mono text-codex-danger">&#10060; {error}</p>
        </div>
      )}
      {success && (
        <div className="mt-4 px-4 py-2 bg-green-900/20 border border-codex-success rounded-md">
          <p className="text-sm font-mono text-codex-success">&#9989; {success}</p>
        </div>
      )}

      {/* 底部按钮 */}
      <div className="flex flex-col sm:flex-row gap-3 mt-6 pt-4 border-t border-codex-border">
        <Button
          variant="secondary"
          onClick={handleAiTag}
          loading={tagging}
          disabled={saving || deleting}
        >
          🤖 AI 重新打标
        </Button>
        <div className="flex-1" />
        {confirmDelete ? (
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-codex-danger">
              确认删除此图片？
            </span>
            <Button
              variant="danger"
              size="sm"
              onClick={handleDelete}
              loading={deleting}
            >
              确认删除
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
            >
              取消
            </Button>
          </div>
        ) : (
          <Button
            variant="danger"
            onClick={() => setConfirmDelete(true)}
            disabled={saving || tagging}
          >
            &#128465; 删除
          </Button>
        )}
        <Button
          variant="primary"
          onClick={handleSave}
          loading={saving}
          disabled={tagging || deleting}
        >
          &#128190; 保存
        </Button>
      </div>
    </Modal>
  );
}

/**
 * 产品尺寸预设 —— 共享单一事实来源
 *
 * 原本这些常量写在 PromptDisplay.tsx 里，只有生图区用得到。三期阶段一起，
 * 自定义尺寸预设要在多处合并展示（生图区、后续阶段三的批量生成栏），
 * 所以抽到这里统一维护，别处 import，不再各自复制一份。
 *
 * 本文件是纯常量 + 纯函数，没有 React 依赖，不需要 'use client'。
 */

/** 尺寸预设条目类型（内置预设） */
export interface SizePreset {
  label: string;
  value: string;
  width: number;
  height: number;
  category: string;
}

/**
 * 产品尺寸预设数据（基于实际印刷尺寸）
 * 选择后自动填充宽高，提交时等比缩放到 API 限制范围内
 */
export const PRODUCT_SIZE_PRESETS: readonly SizePreset[] = [
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
];

/** 生图 API 最大尺寸限制（AIReiter） */
export const API_MAX_SIZE = 1600;

/** 自定义尺寸预设在下拉框里的 value 前缀，防与内置预设 value 撞车 */
export const CUSTOM_SIZE_PREFIX = 'custom:';

/**
 * 等比缩放到 API 尺寸上限内（超限才缩，不放大）。
 * 三期阶段三提取：生图区与批量生成栏共用同一份缩放规则，避免两处各写一遍算错。
 */
export function clampToApiMax(width: number, height: number): { width: number; height: number } {
  if (width <= API_MAX_SIZE && height <= API_MAX_SIZE) {
    return { width, height };
  }
  const scale = API_MAX_SIZE / Math.max(width, height);
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

/**
 * 构建尺寸下拉选项：内置预设 + 用户保存的自定义预设。
 * 三期阶段三提取：生图区（ImageGenSection）与批量生成栏共用。
 */
export function buildSizeOptions(
  customPresets: Array<{ label: string; width: number; height: number }>
): Array<{ label: string; value: string }> {
  const opts: Array<{ label: string; value: string }> = [
    { label: '请选择产品尺寸', value: '' },
  ];
  for (const p of PRODUCT_SIZE_PRESETS) {
    opts.push({ label: p.label, value: p.value });
  }
  for (const p of customPresets) {
    opts.push({
      label: `[自定义] ${p.label} (${p.width}×${p.height})`,
      value: CUSTOM_SIZE_PREFIX + p.label,
    });
  }
  return opts;
}

/**
 * 按下拉框选中的 value 解析出宽高。
 * 命中内置/自定义预设返回宽高，空值或找不到返回 null（调用方保持当前宽高不变）。
 */
export function resolveSizeByValue(
  value: string,
  customPresets: Array<{ label: string; width: number; height: number }>
): { width: number; height: number } | null {
  if (!value) return null;
  if (value.startsWith(CUSTOM_SIZE_PREFIX)) {
    const label = value.slice(CUSTOM_SIZE_PREFIX.length);
    const found = customPresets.find((p) => p.label === label);
    return found ? { width: found.width, height: found.height } : null;
  }
  const preset = PRODUCT_SIZE_PRESETS.find((p) => p.value === value);
  return preset ? { width: preset.width, height: preset.height } : null;
}

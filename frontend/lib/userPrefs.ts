/**
 * 用户偏好读写层（三期阶段一）
 *
 * 存"跨规则卡通用"的两类偏好，落后端 data/user_prefs.json（不是 localStorage）——
 * 换浏览器/清缓存不丢。与 lib/localStorage.ts 是两回事：那个存版本C 按规则卡隔离的
 * 维度自定义值（跟着规则卡走），这里存全局的产品名/尺寸（跟着人走）。
 *
 * 模块级缓存 + 并发去重：A/B/C 三个版本组件各渲染一个 PromptDisplay/ProductSelect
 * 实例，挂载时都要读偏好，缓存后只发一次请求（参考 PromptDisplay 里
 * _supportsReferenceCache 的做法）。
 *
 * 容错原则：所有函数静默降级——后端没起/接口失败时返回空默认值 + console.warn，
 * 绝不抛错阻断页面。偏好是锦上添花的功能，坏了最多是"记不住"，不能影响生成/生图。
 */

import { apiGet, apiPost, apiPut, apiDelete, unwrapData } from '@/lib/api';

/** 自定义尺寸预设（用户手动输入宽高后保存的） */
export interface CustomSizePreset {
  label: string;
  width: number;
  height: number;
}

/** 上次使用的尺寸（preset 为空串表示手动输入模式） */
export interface LastSize {
  preset: string;
  width: number;
  height: number;
}

export interface UserPrefs {
  custom_products: string[];
  custom_size_presets: CustomSizePreset[];
  last_size: LastSize | null;
}

/** 后端不可用时的空偏好（每次返回新对象，防调用方改到共享引用） */
function emptyPrefs(): UserPrefs {
  return { custom_products: [], custom_size_presets: [], last_size: null };
}

/* 模块级缓存：null 表示还没取过 */
let _cache: UserPrefs | null = null;
/* 进行中的请求：多个组件同时挂载时共用同一个 Promise，只发一次请求 */
let _inflight: Promise<UserPrefs> | null = null;

/** 读取用户偏好（带缓存 + 并发去重）。失败返回空默认值，不抛错。 */
export async function fetchPrefs(): Promise<UserPrefs> {
  if (_cache) return _cache;
  if (_inflight) return _inflight;

  _inflight = (async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await apiGet<any>('/api/prefs');
      const data = unwrapData<UserPrefs>(res);
      _cache = {
        custom_products: Array.isArray(data?.custom_products) ? data.custom_products : [],
        custom_size_presets: Array.isArray(data?.custom_size_presets) ? data.custom_size_presets : [],
        last_size: data?.last_size ?? null,
      };
      return _cache;
    } catch (err) {
      console.warn('[userPrefs] 读取用户偏好失败，本次使用空偏好：', err);
      return emptyPrefs(); // 不写 _cache，下次挂载还能重试
    } finally {
      _inflight = null;
    }
  })();

  return _inflight;
}

/** 同步读缓存（没取过返回 null）。用于需要立即拿值又不想 await 的场景。 */
export function getCachedPrefs(): UserPrefs | null {
  return _cache;
}

/**
 * 保存一个新的自定义产品名。
 *
 * 调用方（三个版本组件的 handleGenerate）**不 await**——保存偏好不能拖慢生成流程，
 * 失败也只是"这次没记住"，静默即可。
 *
 * 三重跳过条件：值为空 / 已在当前下拉框已有选项里（说明来自规则卡，不算自定义）/
 * 已在缓存里（避免重复请求）。
 */
export function addCustomProductIfNew(value: string, knownValues: string[]): void {
  const name = (value || '').trim();
  if (!name) return;
  if (knownValues.includes(name)) return;
  if (_cache?.custom_products.includes(name)) return;

  (async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await apiPost<any>('/api/prefs/custom-products', { name });
      const data = unwrapData<{ custom_products: string[] }>(res);
      if (_cache && Array.isArray(data?.custom_products)) {
        _cache = { ..._cache, custom_products: data.custom_products };
      }
    } catch (err) {
      console.warn('[userPrefs] 保存自定义产品失败（不影响本次生成）：', err);
    }
  })();
}

/** 删除一个自定义产品名。返回更新后的列表（失败时返回当前缓存值，UI 不变）。 */
export async function removeCustomProduct(name: string): Promise<string[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await apiDelete<any>(
      `/api/prefs/custom-products?name=${encodeURIComponent(name)}`
    );
    const data = unwrapData<{ custom_products: string[] }>(res);
    const list = Array.isArray(data?.custom_products) ? data.custom_products : [];
    if (_cache) _cache = { ..._cache, custom_products: list };
    return list;
  } catch (err) {
    console.warn('[userPrefs] 删除自定义产品失败：', err);
    return _cache?.custom_products ?? [];
  }
}

/** 新增/更新一个自定义尺寸预设（按 label 去重，同名视为更新）。
 * 失败抛错——这个操作是用户主动点击的，需要在 UI 上给出反馈（与产品名的 fire-and-forget 不同）。 */
export async function addCustomSize(preset: CustomSizePreset): Promise<CustomSizePreset[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await apiPost<any>('/api/prefs/custom-sizes', preset);
  const data = unwrapData<{ custom_size_presets: CustomSizePreset[] }>(res);
  const list = Array.isArray(data?.custom_size_presets) ? data.custom_size_presets : [];
  if (_cache) _cache = { ..._cache, custom_size_presets: list };
  return list;
}

/** 删除一个自定义尺寸预设。返回更新后的列表（失败时返回当前缓存值）。 */
export async function removeCustomSize(label: string): Promise<CustomSizePreset[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await apiDelete<any>(
      `/api/prefs/custom-sizes?label=${encodeURIComponent(label)}`
    );
    const data = unwrapData<{ custom_size_presets: CustomSizePreset[] }>(res);
    const list = Array.isArray(data?.custom_size_presets) ? data.custom_size_presets : [];
    if (_cache) _cache = { ..._cache, custom_size_presets: list };
    return list;
  } catch (err) {
    console.warn('[userPrefs] 删除自定义尺寸失败：', err);
    return _cache?.custom_size_presets ?? [];
  }
}

/**
 * 记住"上次使用的尺寸"。fire-and-forget，调用方不 await。
 *
 * 立即同步更新本地缓存——这样后挂载的 PromptDisplay 实例（A/B/C 三栏里另外两个）
 * 能读到最新值，不用等请求回来。
 */
export function saveLastSize(last: LastSize): void {
  if (_cache) _cache = { ..._cache, last_size: last };
  (async () => {
    try {
      await apiPut('/api/prefs/last-size', last);
    } catch (err) {
      console.warn('[userPrefs] 保存上次使用尺寸失败：', err);
    }
  })();
}

/**
 * 生图配置读取层（三期阶段三提取）
 *
 * 原本 `supports_reference` 的模块级缓存写在 `PromptDisplay.tsx` 里
 * （`_supportsReferenceCache`），只有那个组件用。阶段三的"批量生成勾选方案"栏
 * 也要判断当前生图接口是否支持带参考图，所以提取到这里共用，不再复制一份。
 *
 * 缓存 + 并发去重：A/B/C 三个 PromptDisplay 实例 + 批量生成栏都要这个值，
 * 缓存后整个页面只发一次请求（做法同 lib/userPrefs.ts 的 fetchPrefs）。
 *
 * 容错：失败返回 false（保守——当作不支持带图，回落纯文本生图），不抛错。
 */

import { apiGet, unwrapData } from '@/lib/api';

/* null 表示还没取过 */
let _cache: boolean | null = null;
/* 进行中的请求，多个组件同时挂载时共用 */
let _inflight: Promise<boolean> | null = null;

/**
 * 当前生图接口是否支持附带参考图（后端 REFERENCE_SUPPORT[api_type]）。
 * 带模块级缓存 + 并发去重；请求失败时返回 false 且**不写缓存**（下次可重试）。
 */
export async function getSupportsReference(): Promise<boolean> {
  if (_cache !== null) return _cache;
  if (_inflight) return _inflight;

  _inflight = (async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await apiGet<any>('/api/gen/config');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const supports = Boolean(unwrapData<any>(res)?.supports_reference);
      _cache = supports;
      return supports;
    } catch {
      /* 取不到就保守当作不支持（回落纯文本生图），不写缓存以便下次重试 */
      return false;
    } finally {
      _inflight = null;
    }
  })();

  return _inflight;
}

/** 同步读缓存（还没取过返回 null）。用于需要立即拿初始值的场景。 */
export function getCachedSupportsReference(): boolean | null {
  return _cache;
}

/**
 * API 请求工具模块
 * 封装 fetch 函数，统一处理请求/响应
 * 后端地址：http://localhost:8000
 */

/* 后端 API 基础地址 */
export const BASE_URL = "http://localhost:8000";

/** 将后端返回的相对路径转为完整可访问的图片 URL */
export function getImageUrl(path?: string): string {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  return `${BASE_URL}${path}`;
}

/* 通用请求函数：处理请求头、错误、JSON 解析 */
async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${BASE_URL}${endpoint}`;

  const config: RequestInit = {
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    ...options,
  };

  const response = await fetch(url, config);

  /* 请求失败时抛出错误 */
  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `API 请求失败: ${response.status} ${response.statusText} - ${errorBody}`
    );
  }

  /* 204 No Content 返回空 */
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

/* GET 请求 */
export async function apiGet<T>(endpoint: string): Promise<T> {
  return request<T>(endpoint, { method: "GET" });
}

/* POST 请求 */
export async function apiPost<T>(
  endpoint: string,
  data?: unknown
): Promise<T> {
  return request<T>(endpoint, {
    method: "POST",
    body: data ? JSON.stringify(data) : undefined,
  });
}

/* PUT 请求 */
export async function apiPut<T>(
  endpoint: string,
  data?: unknown
): Promise<T> {
  return request<T>(endpoint, {
    method: "PUT",
    body: data ? JSON.stringify(data) : undefined,
  });
}

/* DELETE 请求 */
export async function apiDelete<T>(endpoint: string): Promise<T> {
  return request<T>(endpoint, { method: "DELETE" });
}

/* 文件上传请求（FormData，不设 Content-Type，由浏览器自动处理 boundary） */
export async function apiUpload<T>(
  endpoint: string,
  formData: FormData
): Promise<T> {
  const url = `${BASE_URL}${endpoint}`;

  const response = await fetch(url, {
    method: "POST",
    body: formData,
    /* 注意：不设置 Content-Type header，让浏览器自动添加 multipart boundary */
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `API 请求失败: ${response.status} ${response.statusText} - ${errorBody}`
    );
  }

  return response.json();
}

/**
 * 统一解包后端响应。
 *
 * 后端接口分两种返回格式：
 * - 包装格式：{"success": true, "data": ...}（rules/analyze/prompts/library 等大多数接口）
 * - 裸数据格式：直接返回数据本身（settings/vocabularies/gen 相关接口）
 *
 * 这个函数自动判断并返回真正的数据，调用方不用每次手写 res.data || res 猜测。
 * 只有当响应同时具备 success 和 data 两个字段时才解包，否则原样返回
 * （所以 {success, message} 这种没有 data 字段的响应会原样返回，
 *  调用方可以正常读取 message）。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function unwrapData<T>(res: any): T {
  if (res && typeof res === 'object' && 'success' in res && 'data' in res) {
    return res.data as T;
  }
  return res as T;
}

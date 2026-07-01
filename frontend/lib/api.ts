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

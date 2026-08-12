"""
生图客户端 - 支持 AIReiter（异步 submit/poll）和 OpenAI（同步）两种模式
"""

import uuid
import base64
from typing import Optional, List

import httpx

from models.image_gen import ImageGenConfig

# #7：批次三 Spike 结论——仅 OpenAI 模式的 /v1/images/edits 确认支持带参考图
# （用竞品图+编辑指令实测，生成结果真的保留了原图构图/风格，只替换了指定元素）。
# AIReiter 模式当前环境无法验证：项目配置的 api_url 实际是自建代理，没有实现
# AIReiter 原生 /api/openapi/submit 路由（不管带不带图都 404）；真正的 aireiter.com
# 域名在当前网络环境 DNS 无法解析。不能假设 AIReiter 支持带图，保持 False。
REFERENCE_SUPPORT = {"openai": True, "aireiter": False}


class ImageGenClient:
    """生图客户端，根据 api_type 自动分发到不同后端"""

    def __init__(self, config: ImageGenConfig):
        self.config = config
        self.base_url = config.api_url.rstrip("/")

    def _headers(self, include_content_type: bool = True) -> dict:
        """构建请求头。multipart 请求（/v1/images/edits）不能手动设 Content-Type
        （httpx 需要自己生成带 boundary 的 multipart/form-data），所以加开关。"""
        headers = {"Authorization": f"Bearer {self.config.api_key}"}
        if include_content_type:
            headers["Content-Type"] = "application/json"
        return headers

    # ==================== 统一入口 ====================

    async def submit_task(
        self,
        prompt: str,
        width: int = 1024,
        height: int = 1024,
        negative_prompt: str = "",
        reference_images: Optional[List[dict]] = None,
    ) -> dict:
        """
        提交生图任务。

        根据 config.api_type 分发：
        - "openai"   → 同步调用 /v1/images/generations，直接返回图片
        - "aireiter" → 异步提交到 submit 接口，后续需要 poll

        参数:
            reference_images: 参考图列表，每项 {"b64": str, "mime": str}（见
                image_format_utils.prepare_image_for_vlm 的返回格式）。#7：仅
                OpenAI 模式实际使用（切换到 /v1/images/edits）；AIReiter 模式
                当前不支持（REFERENCE_SUPPORT），传了也会被忽略，调用方
                （routers/image_gen.py）应先查 REFERENCE_SUPPORT 再决定要不要
                准备这些图，避免白做图片预处理的开销。

        返回:
            openai 模式:
                {"out_task_id": str, "status": "completed", "image_urls": list}
            aireiter 模式:
                {"out_task_id": str, "status": str, "task_id": str, "estimated_credits": float}
        """
        if self.config.api_type == "openai":
            return await self._openai_generate(prompt, negative_prompt, width, height, reference_images)
        else:
            return await self._aireiter_submit(prompt, negative_prompt, width, height)

    async def query_task(self, out_task_id: str) -> dict:
        """
        查询任务状态。

        OpenAI 模式下直接返回"已完成"（submit 时就已经拿到结果）。
        AIReiter 模式下走原有的异步查询逻辑。
        """
        if self.config.api_type == "openai":
            # OpenAI 同步模式：submit 时已经拿到结果，无需 poll
            return {
                "status": "completed",
                "image_urls": [],
                "error": "",
                "raw": {},
            }
        else:
            return await self._aireiter_query(out_task_id)

    async def test_connection(self) -> dict:
        """
        测试生图 API 连接。

        OpenAI 模式：尝试调 /v1/models 验证 API Key
        AIReiter 模式：尝试查询 /api/openapi/balance 验证
        """
        if self.config.api_type == "openai":
            return await self._test_openai()
        else:
            return await self._test_aireiter()

    # ==================== OpenAI 同步模式 ====================

    async def _openai_generate(
        self,
        prompt: str,
        negative_prompt: str,
        width: int,
        height: int,
        reference_images: Optional[List[dict]] = None,
    ) -> dict:
        """OpenAI 同步生图（gpt-image-2 等）。

        #7：有参考图时切 /v1/images/edits（multipart，真正带图生成，Spike 已验证）；
        无图走现状 /v1/images/generations（纯文本）。两分支共用 negative_prompt 合并、
        size 转换、响应解析逻辑。
        """
        out_task_id = f"split-{uuid.uuid4().hex[:12]}"

        # gpt-image-2 不支持 negative_prompt，合并到正向提示词里
        full_prompt = prompt
        if negative_prompt:
            full_prompt += f"\n\nDo not include: {negative_prompt}"

        # 把 width x height 转成 OpenAI 支持的 size 字符串
        size = self._get_openai_size(width, height)

        # 上游代理出图耗时不稳定（实测 60 秒~4 分钟，带图编辑更慢），120 秒会把
        # "慢"误判成"错"报 500，放宽到 300 秒覆盖慢峰
        async with httpx.AsyncClient(timeout=300.0) as client:
            if reference_images:
                url = f"{self.base_url}/v1/images/edits"
                # #7：multipart 请求——httpx 需要自己生成带 boundary 的
                # multipart/form-data，_headers(include_content_type=False)
                # 不手动设 Content-Type，交给 httpx 处理
                files = []
                for i, ref in enumerate(reference_images):
                    img_bytes = base64.b64decode(ref["b64"])
                    mime = ref.get("mime", "image/jpeg")
                    ext = mime.split("/")[-1] if "/" in mime else "jpg"
                    files.append(("image[]", (f"ref_{i}.{ext}", img_bytes, mime)))
                data = {
                    "model": self.config.model,
                    "prompt": full_prompt,
                    "n": "1",
                    "size": size,
                }
                try:
                    resp = await client.post(
                        url, files=files, data=data,
                        headers=self._headers(include_content_type=False),
                    )
                except httpx.ConnectError:
                    raise Exception("无法连接到生图 API 服务器")
                except httpx.TimeoutException:
                    raise Exception("生图请求超时（300秒），上游出图过慢，请稍后重试")
            else:
                url = f"{self.base_url}/v1/images/generations"
                body = {
                    "model": self.config.model,
                    "prompt": full_prompt,
                    "n": 1,
                    "size": size,
                }
                try:
                    resp = await client.post(url, json=body, headers=self._headers())
                except httpx.ConnectError:
                    raise Exception("无法连接到生图 API 服务器")
                except httpx.TimeoutException:
                    raise Exception("生图请求超时（300秒），上游出图过慢，请稍后重试")

            try:
                data = resp.json()
            except Exception:
                raise Exception(f"API 响应非 JSON 格式，HTTP 状态码: {resp.status_code}")

            if resp.status_code != 200:
                error_msg = data.get("error", {}).get("message", str(data))
                raise Exception(f"生图失败: {error_msg}")

            # 提取图片 URL
            image_urls = []
            for item in data.get("data", []):
                if item.get("url"):
                    image_urls.append(item["url"])
                elif item.get("b64_json"):
                    # 返回 base64 数据 URI，由前端/下载流程处理
                    image_urls.append(
                        f"data:image/png;base64,{item['b64_json']}"
                    )

            return {
                "out_task_id": out_task_id,
                "status": "completed",
                "image_urls": image_urls,
                "estimated_credits": 0,
            }

    def _get_openai_size(self, width: int, height: int) -> str:
        """将任意宽高转换为 OpenAI 支持的 size 字符串"""
        if height == 0:
            return "1024x1024"
        ratio = width / height
        if ratio > 1.2:
            return "1536x1024"  # 横版
        elif ratio < 0.8:
            return "1024x1536"  # 竖版
        else:
            return "1024x1024"  # 正方形

    async def _test_openai(self) -> dict:
        """测试 OpenAI 模式连接：调 /v1/models 验证 API Key"""
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(
                    f"{self.base_url}/v1/models",
                    headers=self._headers(),
                )

                if resp.status_code == 200:
                    return {"success": True, "message": "连接成功（OpenAI 模式）"}
                elif resp.status_code in (401, 403):
                    return {"success": False, "message": "API Key 无效或已过期"}
                else:
                    # 有些代理不支持 /v1/models，状态码非 401/403 仍可视为连通
                    return {
                        "success": True,
                        "message": f"连接已建立（HTTP {resp.status_code}），建议实际生图验证",
                    }
        except httpx.ConnectError:
            return {"success": False, "message": "无法连接到生图 API 服务器，请检查地址"}
        except httpx.TimeoutException:
            return {"success": False, "message": "连接超时（15秒）"}
        except Exception as e:
            return {"success": False, "message": f"连接异常: {str(e)}"}

    # ==================== AIReiter 异步模式 ====================

    async def _aireiter_submit(
        self,
        prompt: str,
        negative_prompt: str,
        width: int,
        height: int,
    ) -> dict:
        """AIReiter 异步提交生图任务"""
        out_task_id = f"split-{uuid.uuid4().hex[:12]}"

        # 构建 params
        params = {
            "prompt": prompt,
            "width": width,
            "height": height,
        }
        if negative_prompt:
            params["negative_prompt"] = negative_prompt

        body = {
            "out_task_id": out_task_id,
            "model": self.config.model,
            "params": params,
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                resp = await client.post(
                    f"{self.base_url}/api/openapi/submit",
                    json=body,
                    headers=self._headers(),
                )
            except httpx.ConnectError:
                raise Exception("无法连接到生图 API 服务器")
            except httpx.TimeoutException:
                raise Exception("提交请求超时（30秒）")

            # 尝试解析 JSON
            try:
                data = resp.json()
            except Exception:
                raise Exception(f"API 响应非 JSON 格式，HTTP 状态码: {resp.status_code}")

            if data.get("statusCode") != 200 and not data.get("ok"):
                msg = data.get("message", data.get("msg", "未知错误"))
                raise Exception(f"提交失败: {msg}")

            task_data = data.get("data", {})
            return {
                "out_task_id": out_task_id,
                "status": task_data.get("status", "pending"),
                "task_id": task_data.get("task_id", ""),
                "estimated_credits": task_data.get("estimated_credits", 0),
            }

    async def _aireiter_query(self, out_task_id: str) -> dict:
        """AIReiter 异步查询任务状态"""
        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                resp = await client.post(
                    f"{self.base_url}/api/openapi/query",
                    json={"out_task_id": out_task_id},
                    headers=self._headers(),
                )
            except httpx.ConnectError:
                return {
                    "status": "error",
                    "image_urls": [],
                    "error": "无法连接到生图 API",
                    "raw": {},
                }
            except httpx.TimeoutException:
                return {
                    "status": "error",
                    "image_urls": [],
                    "error": "查询请求超时",
                    "raw": {},
                }

            # 尝试解析 JSON
            try:
                data = resp.json()
            except Exception:
                return {
                    "status": "error",
                    "image_urls": [],
                    "error": f"响应非 JSON，HTTP {resp.status_code}",
                    "raw": {},
                }

            if data.get("statusCode") != 200 and not data.get("ok"):
                return {
                    "status": "failed",
                    "image_urls": [],
                    "error": data.get("message", data.get("msg", "查询失败")),
                    "raw": data,
                }

            task_data = data.get("data", {})
            status = task_data.get("status", "unknown")

            # 提取图片 URL（兼容多种可能的字段名）
            image_urls = []
            candidate_keys = [
                "output", "image_url", "images", "result",
                "output_url", "url", "output_images",
                "image_urls", "outputs", "result_url",
            ]
            for key in candidate_keys:
                val = task_data.get(key)
                if val:
                    if isinstance(val, list):
                        for item in val:
                            if isinstance(item, str):
                                image_urls.append(item)
                            elif isinstance(item, dict):
                                # 尝试多种可能的 URL 字段
                                for url_key in ["url", "image_url", "src", "link"]:
                                    u = item.get(url_key, "")
                                    if u:
                                        image_urls.append(u)
                                        break
                    elif isinstance(val, str):
                        image_urls.append(val)
                    elif isinstance(val, dict):
                        for url_key in ["url", "image_url", "src", "link"]:
                            u = val.get(url_key, "")
                            if u:
                                image_urls.append(u)
                                break

            # 清理空字符串和重复
            image_urls = list(dict.fromkeys(u for u in image_urls if u))

            # 标准化状态：将常见的完成态统一为 "completed"
            if status in ("succeeded", "success", "done", "finished"):
                status = "completed"

            return {
                "status": status,
                "image_urls": image_urls,
                "error": task_data.get("error", task_data.get("error_message", "")),
                "raw": task_data,
            }

    async def _test_aireiter(self) -> dict:
        """测试 AIReiter 模式连接：查询余额接口验证 API Key"""
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                # 尝试查询余额
                resp = await client.get(
                    f"{self.base_url}/api/openapi/balance",
                    headers=self._headers(),
                )
                try:
                    data = resp.json()
                except Exception:
                    # 如果余额接口不返回 JSON，尝试用 query 一个不存在的任务来验证
                    return await self._test_via_query(client)

                if data.get("statusCode") == 200 or data.get("ok"):
                    balance_info = data.get("data", {})
                    return {
                        "success": True,
                        "message": f"连接成功！余额信息: {balance_info}",
                    }
                elif resp.status_code == 401 or resp.status_code == 403:
                    return {"success": False, "message": "API Key 无效或已过期"}
                elif resp.status_code == 404:
                    # 余额接口不存在，用 query 接口测试
                    return await self._test_via_query(client)
                else:
                    return {
                        "success": False,
                        "message": f"API 返回异常: {data.get('message', f'HTTP {resp.status_code}')}",
                    }
        except httpx.ConnectError:
            return {"success": False, "message": "无法连接到生图 API 服务器，请检查地址"}
        except httpx.TimeoutException:
            return {"success": False, "message": "连接超时（15秒）"}
        except Exception as e:
            return {"success": False, "message": f"连接异常: {str(e)}"}

    async def _test_via_query(self, client: httpx.AsyncClient) -> dict:
        """备用测试：通过 query 接口查询一个不存在的任务来验证连接"""
        try:
            resp = await client.post(
                f"{self.base_url}/api/openapi/query",
                json={"out_task_id": "test-connection-check"},
                headers=self._headers(),
            )
            if resp.status_code == 401 or resp.status_code == 403:
                return {"success": False, "message": "API Key 无效或已过期"}

            # 即使返回"任务不存在"也说明连接是通的
            return {"success": True, "message": "连接成功（通过 query 接口验证）"}
        except Exception as e:
            return {"success": False, "message": f"验证失败: {str(e)}"}

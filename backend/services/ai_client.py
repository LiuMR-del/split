"""
统一 AI 客户端 - 支持 OpenAI 和 Anthropic API 格式
"""

import json
from pathlib import Path
from typing import Optional

import httpx
from models.settings import AIModelConfig

# 默认配置文件路径（AI 分析模型配置，与生图配置 gen_config.json 分开存）
DEFAULT_CONFIG_PATH = Path(__file__).parent.parent / "data" / "config.json"


def load_ai_client_from_config(config_path: Optional[Path] = None) -> Optional["AIClient"]:
    """从配置文件加载 AIClient，配置缺失或 api_key 为空时返回 None。

    供 routers/prompts.py、routers/library.py 等多处路由共用，
    避免各自重复实现"读 config.json → 校验 api_key → 构造 AIClient"。

    参数:
        config_path: 配置文件路径，默认为 data/config.json

    返回:
        AIClient 实例；配置不存在/无效/api_key 为空时返回 None
    """
    path = config_path or DEFAULT_CONFIG_PATH
    if not path.exists():
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            config_data = json.load(f)
        if not config_data.get("api_key"):
            return None
        config = AIModelConfig(**config_data)
        return AIClient(config)
    except Exception:
        return None


class AIClient:
    """统一 AI 客户端，支持 OpenAI 和 Anthropic API 格式"""

    def __init__(self, config: AIModelConfig):
        self.config = config

    async def analyze_image(
        self,
        image_base64: str,
        system_prompt: str,
        user_prompt: str,
        media_type: str = "image/jpeg",
    ) -> str:
        """
        发送图片给 VLM 分析，返回文本响应。
        根据 provider 自动选择 OpenAI 或 Anthropic 请求格式。
        media_type: 图片 MIME 类型，如 image/jpeg、image/png、image/webp
        """
        if self.config.provider == "anthropic":
            return await self._anthropic_image_request(image_base64, system_prompt, user_prompt, media_type)
        else:
            # openai 和 custom 都走 OpenAI 兼容格式
            return await self._openai_image_request(image_base64, system_prompt, user_prompt, media_type)

    async def text_request(self, system_prompt: str, user_prompt: str) -> str:
        """
        发送纯文本请求（不带图片），返回文本响应。
        根据 provider 自动选择 OpenAI 或 Anthropic 请求格式。
        供需要纯文本 AI 调用的场景使用（如 prompt_generator 的改款推荐）。
        """
        if self.config.provider == "anthropic":
            return await self._anthropic_text_request(system_prompt, user_prompt)
        else:
            return await self._openai_text_request(system_prompt, user_prompt)

    async def test_connection(self) -> dict:
        """
        测试连接是否正常。
        发一个简单的文本请求（不发图片），验证 key 和 url 是否有效。
        返回 {"success": bool, "message": str}
        """
        try:
            if self.config.provider == "anthropic":
                return await self._anthropic_test()
            else:
                return await self._openai_test()
        except httpx.ConnectError:
            return {"success": False, "message": "无法连接到 API 服务器，请检查 API 地址是否正确"}
        except httpx.TimeoutException:
            return {"success": False, "message": "连接超时，请检查网络或 API 地址"}
        except Exception as e:
            return {"success": False, "message": f"连接失败: {str(e)}"}

    # -------------------- OpenAI 兼容格式 --------------------

    async def _openai_image_request(
        self, image_base64: str, system_prompt: str, user_prompt: str, media_type: str = "image/jpeg"
    ) -> str:
        """OpenAI 格式的图片分析请求"""
        url = f"{self.config.api_url.rstrip('/')}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.config.api_key}",
            "Content-Type": "application/json",
        }
        body = {
            "model": self.config.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:{media_type};base64,{image_base64}"},
                        },
                        {"type": "text", "text": user_prompt},
                    ],
                },
            ],
            "max_tokens": 4096,
        }

        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(url, json=body, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            return data["choices"][0]["message"]["content"]

    async def _openai_text_request(self, system_prompt: str, user_prompt: str) -> str:
        """OpenAI 格式的纯文本请求（不带图片）"""
        url = f"{self.config.api_url.rstrip('/')}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.config.api_key}",
            "Content-Type": "application/json",
        }
        body = {
            "model": self.config.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "max_tokens": 4096,
        }

        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(url, json=body, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            return data["choices"][0]["message"]["content"]

    async def _openai_test(self) -> dict:
        """OpenAI 格式的连接测试（纯文本请求）"""
        url = f"{self.config.api_url.rstrip('/')}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.config.api_key}",
            "Content-Type": "application/json",
        }
        body = {
            "model": self.config.model,
            "messages": [{"role": "user", "content": "Hi, reply with OK"}],
            "max_tokens": 10,
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(url, json=body, headers=headers)
            if resp.status_code == 401:
                return {"success": False, "message": "API Key 无效，请检查后重试"}
            if resp.status_code == 404:
                return {"success": False, "message": "API 地址或模型名称有误，请检查配置"}
            # 尝试解析 JSON 响应
            try:
                data = resp.json()
            except Exception:
                # 响应不是有效 JSON（代理/转发可能返回 HTML 或空内容）
                text = resp.text[:200] if resp.text else "(空响应)"
                if resp.status_code >= 400:
                    return {"success": False, "message": f"API 返回错误 {resp.status_code}：{text}"}
                return {"success": False, "message": f"API 返回了非 JSON 响应（HTTP {resp.status_code}），请检查 API 地址是否正确。响应内容：{text}"}
            # HTTP 错误但有 JSON 错误消息
            if resp.status_code >= 400:
                error_msg = data.get("error", {}).get("message", "") if isinstance(data, dict) else str(data)
                return {"success": False, "message": f"API 错误 {resp.status_code}：{error_msg}"}
            model_used = data.get("model", self.config.model)
            return {"success": True, "message": f"连接成功！模型: {model_used}"}

    # -------------------- Anthropic 格式 --------------------

    async def _anthropic_image_request(
        self, image_base64: str, system_prompt: str, user_prompt: str, media_type: str = "image/jpeg"
    ) -> str:
        """Anthropic 格式的图片分析请求"""
        url = f"{self.config.api_url.rstrip('/')}/messages"
        headers = {
            "x-api-key": self.config.api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        }
        body = {
            "model": self.config.model,
            "max_tokens": 4096,
            "system": system_prompt,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": image_base64,
                            },
                        },
                        {"type": "text", "text": user_prompt},
                    ],
                }
            ],
        }

        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(url, json=body, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            # Anthropic 响应格式：content 是数组，取第一个 text block
            for block in data.get("content", []):
                if block.get("type") == "text":
                    return block["text"]
            return ""

    async def _anthropic_text_request(self, system_prompt: str, user_prompt: str) -> str:
        """Anthropic 格式的纯文本请求（不带图片）"""
        url = f"{self.config.api_url.rstrip('/')}/messages"
        headers = {
            "x-api-key": self.config.api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        }
        body = {
            "model": self.config.model,
            "max_tokens": 4096,
            "system": system_prompt,
            "messages": [{"role": "user", "content": user_prompt}],
        }

        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(url, json=body, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            for block in data.get("content", []):
                if block.get("type") == "text":
                    return block["text"]
            return ""

    async def _anthropic_test(self) -> dict:
        """Anthropic 格式的连接测试（纯文本请求）"""
        url = f"{self.config.api_url.rstrip('/')}/messages"
        headers = {
            "x-api-key": self.config.api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        }
        body = {
            "model": self.config.model,
            "max_tokens": 10,
            "messages": [{"role": "user", "content": "Hi, reply with OK"}],
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(url, json=body, headers=headers)
            if resp.status_code == 401:
                return {"success": False, "message": "API Key 无效，请检查后重试"}
            if resp.status_code == 404:
                return {"success": False, "message": "API 地址或模型名称有误，请检查配置"}
            try:
                data = resp.json()
            except Exception:
                text = resp.text[:200] if resp.text else "(空响应)"
                if resp.status_code >= 400:
                    return {"success": False, "message": f"API 返回错误 {resp.status_code}：{text}"}
                return {"success": False, "message": f"API 返回了非 JSON 响应（HTTP {resp.status_code}），请检查 API 地址是否正确。响应内容：{text}"}
            if resp.status_code >= 400:
                error_msg = data.get("error", {}).get("message", "") if isinstance(data, dict) else str(data)
                return {"success": False, "message": f"API 错误 {resp.status_code}：{error_msg}"}
            model_used = data.get("model", self.config.model)
            return {"success": True, "message": f"连接成功！模型: {model_used}"}

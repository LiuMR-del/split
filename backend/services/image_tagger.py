"""
AI 自动图片打标服务

调用 VLM（视觉语言模型）分析图片，返回结构化标签。
标签严格从受控词表中选择。
"""

import base64
import io
import json
import re
from pathlib import Path
from typing import Optional

from services.ai_client import AIClient
from prompts.image_tagging import get_image_tagging_prompt, IMAGE_TAGGING_USER_PROMPT

# 注册 AVIF/HEIF 支持（如果 pillow-heif 已安装）
try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
except ImportError:
    pass


class ImageTagger:
    """AI 自动图片打标器"""

    def __init__(self, ai_client: AIClient):
        """
        参数:
            ai_client: AIClient 实例，用于调用 VLM
        """
        self.ai_client = ai_client

    async def tag_image(self, image_path: str) -> dict:
        """
        调用 VLM 分析图片，返回结构化标签。

        参数:
            image_path: 图片文件的绝对路径

        返回:
            标签字典，包含 themes, styles, color_moods, emotions,
            target_audiences, description, elements
        """
        # 读取图片并转 base64（不支持的格式自动转 JPEG）
        path = Path(image_path)
        if not path.exists():
            raise FileNotFoundError(f"图片文件不存在: {image_path}")

        image_base64, media_type = self._prepare_image(path)

        # 构造系统提示词（嵌入受控词表）
        system_prompt = get_image_tagging_prompt()

        # 调用 VLM 分析
        response = await self.ai_client.analyze_image(
            image_base64=image_base64,
            system_prompt=system_prompt,
            user_prompt=IMAGE_TAGGING_USER_PROMPT,
            media_type=media_type,
        )

        # 解析 VLM 返回的 JSON
        tags = self._extract_json(response)

        # 确保返回结构完整
        return self._normalize_tags(tags)

    # VLM 原生支持的格式
    VLM_SUPPORTED = {".jpg", ".jpeg", ".png", ".gif", ".webp"}

    def _prepare_image(self, path: Path) -> tuple:
        """读取图片，不支持的格式自动转 JPEG。返回 (base64, media_type)"""
        suffix = path.suffix.lower()
        if suffix in self.VLM_SUPPORTED:
            data = path.read_bytes()
            return base64.b64encode(data).decode("utf-8"), self._get_media_type(suffix)
        # avif/bmp/tiff 等转 JPEG
        try:
            from PIL import Image
            img = Image.open(str(path))
            if img.mode in ("RGBA", "LA", "P"):
                img = img.convert("RGB")
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=90)
            return base64.b64encode(buf.getvalue()).decode("utf-8"), "image/jpeg"
        except ImportError:
            data = path.read_bytes()
            return base64.b64encode(data).decode("utf-8"), "image/jpeg"

    def _get_media_type(self, suffix: str) -> str:
        """根据文件后缀推断 MIME 类型"""
        type_map = {
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
            ".webp": "image/webp",
            ".gif": "image/gif",
            ".bmp": "image/bmp",
            ".avif": "image/avif",
            ".tif": "image/tiff",
            ".tiff": "image/tiff",
        }
        return type_map.get(suffix, "image/jpeg")

    def _normalize_tags(self, tags: dict) -> dict:
        """确保标签结构完整，缺失字段补默认值"""
        return {
            "themes": tags.get("themes", []),
            "styles": tags.get("styles", []),
            "color_moods": tags.get("color_moods", []),
            "emotions": tags.get("emotions", []),
            "target_audiences": tags.get("target_audiences", []),
            "description": tags.get("description", ""),
            "elements": tags.get("elements", []),
        }

    def _extract_json(self, text: str) -> dict:
        """
        从 AI 响应文本中提取 JSON。
        依次尝试三种策略（与项目中其他模块的逻辑保持一致）：
        1. 直接解析整段文本
        2. 提取 ```json ... ``` 代码块
        3. 找第一个 { 到最后一个 } 之间的内容
        """
        # 策略 1：直接解析
        try:
            return json.loads(text.strip())
        except (json.JSONDecodeError, ValueError):
            pass

        # 策略 2：代码块提取
        pattern = r"```(?:json)?\s*\n?(.*?)\n?\s*```"
        match = re.search(pattern, text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(1).strip())
            except (json.JSONDecodeError, ValueError):
                pass

        # 策略 3：花括号范围
        first_brace = text.find("{")
        last_brace = text.rfind("}")
        if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
            try:
                return json.loads(text[first_brace:last_brace + 1])
            except (json.JSONDecodeError, ValueError):
                pass

        # 全部失败，返回空标签
        return {"parse_error": f"无法从 AI 响应中提取有效 JSON，原始响应: {text[:200]}"}

"""
AI 自动图片打标服务

调用 VLM（视觉语言模型）分析图片，返回结构化标签。
标签严格从受控词表中选择。
"""

from pathlib import Path
from typing import Optional

from services.ai_client import AIClient
from services.image_format_utils import prepare_image_for_vlm
from services.ai_response_utils import extract_json_from_ai_response
from prompts.image_tagging import get_image_tagging_prompt, IMAGE_TAGGING_USER_PROMPT


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
        # 读取图片并转 base64（不支持的格式自动转 JPEG，逻辑见 image_format_utils）
        path = Path(image_path)
        if not path.exists():
            raise FileNotFoundError(f"图片文件不存在: {image_path}")

        image_base64, media_type = prepare_image_for_vlm(path)

        # 构造系统提示词（嵌入受控词表）
        system_prompt = get_image_tagging_prompt()

        # 调用 VLM 分析
        response = await self.ai_client.analyze_image(
            image_base64=image_base64,
            system_prompt=system_prompt,
            user_prompt=IMAGE_TAGGING_USER_PROMPT,
            media_type=media_type,
            temperature=0,
        )

        # 解析 VLM 返回的 JSON（注意：打标场景解析失败时用 parse_error 单字段兜底，
        # 不需要 raw_response，所以不能直接复用共享函数的失败分支，
        # 但成功路径完全一致，直接调用共享实现）
        tags = extract_json_from_ai_response(response)

        # 确保返回结构完整
        return self._normalize_tags(tags)

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

"""
图片分析核心逻辑
调用 VLM 进行 SABC 分级 + 6 层规则拆解，输出完整规则卡。
"""

import base64
import io
import json
import re
from datetime import datetime
from pathlib import Path

from services.ai_client import AIClient
from models.rule_card import RuleCard
from prompts.sabc_grading import SABC_GRADING_SYSTEM_PROMPT
from prompts.rule_extraction import get_rule_extraction_prompt

# 规则卡 JSON 文件存储目录
RULES_DIR = Path(__file__).parent.parent / "data" / "rules"

# VLM API 通常只支持这些格式，其他格式需要转换
VLM_SUPPORTED_FORMATS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}

# 注册 AVIF/HEIF 支持（如果 pillow-heif 已安装）
try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
except ImportError:
    pass


class ImageAnalyzer:
    """图片分析器：调用 VLM 分析竞品图，输出规则卡"""

    def __init__(self, ai_client: AIClient):
        self.ai_client = ai_client

    def _prepare_image(self, image_path: str) -> tuple:
        """
        读取图片并准备 base64 + media_type。
        如果图片格式不被 VLM 支持（avif/bmp/tiff 等），自动转换为 JPEG。
        返回 (base64_string, media_type)
        """
        suffix = Path(image_path).suffix.lower()

        # VLM 原生支持的格式，直接读取
        if suffix in VLM_SUPPORTED_FORMATS:
            image_data = Path(image_path).read_bytes()
            type_map = {
                ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                ".png": "image/png", ".webp": "image/webp",
                ".gif": "image/gif",
            }
            media_type = type_map.get(suffix, "image/jpeg")
            return base64.b64encode(image_data).decode(), media_type

        # 不支持的格式（avif/bmp/tiff 等），用 Pillow 转成 JPEG
        try:
            from PIL import Image
            img = Image.open(image_path)
            # RGBA/透明通道转 RGB（JPEG 不支持透明）
            if img.mode in ("RGBA", "LA", "P"):
                img = img.convert("RGB")
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=90)
            return base64.b64encode(buf.getvalue()).decode(), "image/jpeg"
        except ImportError:
            # Pillow 没安装，降级直接发原格式（可能被 API 拒绝）
            image_data = Path(image_path).read_bytes()
            return base64.b64encode(image_data).decode(), "image/jpeg"
        except Exception as e:
            raise Exception(f"图片格式转换失败（{suffix}）: {str(e)}")

    async def analyze(self, image_path: str) -> dict:
        """
        完整分析流程：
        1. 读取图片（不支持的格式自动转换为 JPEG）
        2. 第一步：调 VLM 做 SABC 分级
        3. 第二步：调 VLM 做 6 层规则拆解
        4. 合并结果，生成规则卡
        """
        # 读取图片并转 base64（自动处理格式兼容）
        image_base64, media_type = self._prepare_image(image_path)

        # 第一步：SABC 分级
        sabc_result = await self._grade_sabc(image_base64, media_type)

        # 第二步：6 层规则拆解
        rule_result = await self._extract_rules(image_base64, media_type)

        # 合并并生成规则卡
        rule_card = self._build_rule_card(sabc_result, rule_result, image_path)

        return {
            "rule_card": rule_card,
            "sabc_raw": sabc_result,
            "rule_raw": rule_result,
        }

    async def _grade_sabc(self, image_base64: str, media_type: str) -> dict:
        """调 VLM 做 SABC 分级"""
        system_prompt = SABC_GRADING_SYSTEM_PROMPT
        # SABC 提示词要求 JSON 输出，补充明确格式要求
        user_prompt = (
            "请分析这张竞品产品图的复用价值，按 SABC 四级分级。\n"
            '请严格按以下 JSON 格式输出：\n'
            '{\n'
            '  "reuse_level": "S/A/B/C",\n'
            '  "reuse_level_reason": "等级判断理由",\n'
            '  "key_reusable_elements": ["可复用元素1", "可复用元素2"]\n'
            '}'
        )

        response = await self.ai_client.analyze_image(
            image_base64=image_base64,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            media_type=media_type,
        )

        return self._extract_json(response)

    async def _extract_rules(self, image_base64: str, media_type: str) -> dict:
        """调 VLM 做 6 层规则拆解"""
        system_prompt = get_rule_extraction_prompt()
        user_prompt = (
            "请分析这张竞品产品图，按 6 层结构拆解出完整的规则卡，"
            "严格按要求的 JSON 格式输出。"
            "所有分类字段必须从给定的受控词表中选择。"
        )

        response = await self.ai_client.analyze_image(
            image_base64=image_base64,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            media_type=media_type,
        )

        return self._extract_json(response)

    def _extract_json(self, text: str) -> dict:
        """
        从 VLM 响应文本中提取 JSON。
        依次尝试三种策略：
        1. 直接解析整段文本
        2. 提取 ```json ... ``` 代码块中的内容
        3. 找第一个 { 到最后一个 } 之间的内容
        """
        # 策略 1：直接解析整段文本
        try:
            return json.loads(text.strip())
        except (json.JSONDecodeError, ValueError):
            pass

        # 策略 2：提取 ```json ... ``` 代码块
        pattern = r"```(?:json)?\s*\n?(.*?)\n?\s*```"
        match = re.search(pattern, text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(1).strip())
            except (json.JSONDecodeError, ValueError):
                pass

        # 策略 3：找第一个 { 到最后一个 } 之间的内容
        first_brace = text.find("{")
        last_brace = text.rfind("}")
        if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
            try:
                return json.loads(text[first_brace : last_brace + 1])
            except (json.JSONDecodeError, ValueError):
                pass

        # 全部失败，返回原始文本包装
        return {"raw_response": text, "parse_error": "无法从 VLM 响应中提取有效 JSON"}

    def _generate_rule_id(self) -> str:
        """
        生成递增的规则 ID（如 RULE-0001）。
        读取 data/rules/ 目录下已有的规则卡数量来决定编号。
        """
        RULES_DIR.mkdir(parents=True, exist_ok=True)
        existing = list(RULES_DIR.glob("RULE-*.json"))
        next_num = len(existing) + 1
        return f"RULE-{next_num:04d}"

    def _build_rule_card(self, sabc_result: dict, rule_result: dict, image_path: str) -> dict:
        """
        合并 SABC 分级和规则拆解结果，生成完整规则卡。
        - 生成递增的 rule_id
        - 将 SABC 的 reuse_level 合并到规则卡
        - 设置 source_images、created_date 等元数据
        """
        rule_id = self._generate_rule_id()
        today = datetime.now().strftime("%Y-%m-%d")
        image_filename = Path(image_path).name

        # 从 SABC 结果取复用等级（如果 SABC 解析失败，降级为空字符串）
        reuse_level = sabc_result.get("reuse_level", "")
        reuse_level_reason = sabc_result.get("reuse_level_reason", "")

        # 从规则拆解结果构建各层数据
        # 如果 rule_result 解析失败（含 parse_error），使用空壳结构
        if "parse_error" in rule_result:
            rule_card = self._empty_rule_card(rule_id, today, image_filename, reuse_level)
            rule_card["_parse_error"] = rule_result.get("parse_error", "")
            rule_card["_raw_response"] = rule_result.get("raw_response", "")
            return rule_card

        # 正常合并：用规则拆解结果作为主体，补充元数据和 SABC 等级
        rule_card = {
            "rule_id": rule_id,
            "rule_name": rule_result.get("rule_name", "未命名规则"),
            "reuse_level": reuse_level if reuse_level else rule_result.get("layer_5_data", {}).get("reuse_level", ""),
            "source_images": [image_filename],
            "created_date": today,
            "last_updated": today,
            # 6 层数据
            "layer_0_core": rule_result.get("layer_0_core", {}),
            "layer_1_commercial": rule_result.get("layer_1_commercial", {}),
            "layer_2_visual": rule_result.get("layer_2_visual", {}),
            "layer_3_variable": rule_result.get("layer_3_variable", {}),
            "layer_4_product": rule_result.get("layer_4_product", {}),
            "layer_5_data": rule_result.get("layer_5_data", {}),
        }

        # 将 SABC 的 reuse_level 和 reason 同步到 layer_5_data
        if reuse_level and isinstance(rule_card.get("layer_5_data"), dict):
            rule_card["layer_5_data"]["reuse_level"] = reuse_level
        if reuse_level_reason and isinstance(rule_card.get("layer_5_data"), dict):
            rule_card["layer_5_data"]["reuse_level_reason"] = reuse_level_reason

        return rule_card

    def _empty_rule_card(self, rule_id: str, today: str, image_filename: str, reuse_level: str) -> dict:
        """当 VLM 解析失败时，生成一个空壳规则卡"""
        return {
            "rule_id": rule_id,
            "rule_name": "解析失败 - 待人工填写",
            "reuse_level": reuse_level,
            "source_images": [image_filename],
            "created_date": today,
            "last_updated": today,
            "layer_0_core": {
                "core_selling_point": "",
                "selling_point_type": "",
                "why_it_sells": "",
                "lock_rule": "",
            },
            "layer_1_commercial": {
                "target_audience": [],
                "use_scenario": [],
                "purchase_motivation": "",
                "core_emotion": [],
                "price_sensitivity": "",
            },
            "layer_2_visual": {
                "layout_formula": "",
                "must_have_elements": [],
                "style": "",
                "color_mood": "",
                "text_hierarchy": "",
            },
            "layer_3_variable": {
                "replaceable_elements": {},
                "must_not_change": [],
            },
            "layer_4_product": {
                "adaptations": {},
            },
            "layer_5_data": {
                "source_sales_rank": "",
                "proven_platforms": [],
                "seasonal_dependency": "",
                "ip_dependency": "",
                "reuse_level": reuse_level,
                "reuse_level_reason": "",
            },
        }

"""
提示词生成服务
核心功能：基于规则卡 + 用户选择的替换方案 + 目标产品，生成提示词。
支持三个版本：
- 版本 B：AI 推荐风格版（随机/AI 推荐改款方向）
- 版本 C 模板：生成可交互的下拉框选项结构
- 版本 C 生成：根据用户选择组装最终提示词
"""

import json
import logging
from typing import List, Optional

from prompts.prompt_generation import (
    get_recommendation_prompt,
    get_customization_analysis_prompt,
    get_option_translation_prompt,
    ELEMENT_EXTRACTION_PROMPT_TEMPLATE,
    ELEMENT_VARIANT_PROMPT_TEMPLATE,
)
from services.ai_response_utils import extract_json_from_ai_response
from services.vocab_utils import extract_english_part


# 通用负向提示词（生图时需要排除的内容）
# 注意：不排除 text/letters/words，因为 POD 产品需要 AI 画上示例文字
# 排除中文文字，确保生成的图不出现中文。提示词本身可含中文，仅约束生成图。
# 该常量被版本A/B/C共用（_build_image_prompts 和 generate_version_a 都引用它）。
# 用词精确指向"中文文字"（chinese characters/text、hanzi），不用泛 "chinese"
# 以免误伤中式风格/亚洲元素；不用 cjk characters（会连带排除日韩文字，超出需求）；
# 不用 chinese fonts（"fonts"易被理解为字体风格，可能压制书法/水墨等合法风格）。
# 注意：OpenAI 同步模式下 negative_prompt 会被合并进正向（Do not include: ...），
# 对指令遵循弱的模型可能有"粉红大象"效应，因此"图无中文"主要靠正向的
# "english text only" 引导（见 _build_image_prompts / generate_version_a 质量词），
# 这里的负向词作为补充（对支持独立 negative_prompt 字段的模型生效）。
COMMON_NEGATIVE_PROMPTS = [
    "watermark",
    "signature",
    "photorealistic",
    "photo",
    "3d render",
    "low quality",
    "blurry",
    "distorted",
    "deformed",
    "ugly",
    "duplicate",
    "cropped",
    "out of frame",
    "extra limbs",
    "bad anatomy",
    "chinese characters",
    "chinese text",
    "hanzi",
]

# POD 印刷质量补充排除项（COMMON_NEGATIVE_PROMPTS 之外的 POD 专属负向词，
# 版本A 的 generate_version_a 和 版本B/C 的 _build_image_prompts 共用，避免重复定义）
# #15：去掉 watermark/signature——它们已在 COMMON_NEGATIVE_PROMPTS 里，拼接处虽有
# 去重兜底，源头去掉更干净，也避免维护两处。
POD_NEGATIVE_ADDITIONS = [
    "low resolution",
    "blurry edges", "unprintable artifacts",
]


class PromptGenerator:
    """提示词生成器：基于规则卡生成三版提示词"""

    def __init__(self, ai_client=None):
        """
        参数:
            ai_client: AIClient 实例，用于版本B的AI推荐。
                       为 None 时使用"随机推荐"模式（取第一个替代方案）。
        """
        self.ai_client = ai_client

    # ==================== 版本 B：AI 推荐风格版 ====================

    async def generate_version_b(
        self,
        rule_card: dict,
        target_product: str,
        library_recommendations: Optional[List[dict]] = None,
        num_directions: int = 1,
    ) -> dict:
        """版本 B：AI 推荐风格版

        如果有 ai_client，调用 AI 推荐最佳改款方向；
        否则使用"随机推荐"模式（从 alternatives 中选第一个替代方案）。

        参数:
            rule_card: 规则卡字典（RuleCard.model_dump() 的结果）
            target_product: 目标产品类型（如 "毛毯"、"抱枕"）
            library_recommendations: 可选，自有图库推荐的参考图列表
            num_directions: 推荐几套方案（三期阶段三）。1（默认）= 原有单套路径，
                            返回形状与改造前**完全一致**；>1 返回
                            `{"directions": [套1, 套2, ...], "num_directions": N}`。

        返回:
            num_directions == 1: 包含锁定核心、推荐改动、提示词等的完整结果字典（旧形状）
            num_directions > 1:  {"directions": [...], "num_directions": N}
        """
        # 提取核心数据
        layer_3 = rule_card.get("layer_3_variable", {})
        layer_4 = rule_card.get("layer_4_product", {})

        # 产品适配规则：多套方案共用同一份，只算一次
        adaptation = self._get_adaptation(layer_4, target_product)

        # ── 三期阶段三：多方案路径 ──
        if num_directions > 1:
            if self.ai_client:
                multi = await self._ai_recommend_multi(
                    rule_card, target_product, num_directions
                )
                recommendations = multi.get("recommendations", [])
                # AI 顶层 slots 缺失时传 None 走规则卡兜底（与单套 R4 语义一致）
                slots_raw = multi.get("customization_slots")
            else:
                recommendations = self._random_recommend_multi(
                    layer_3, target_product, num_directions
                )
                slots_raw = None

            # 可定制项与"选哪套方案"无关，只算一份塞进每套结果
            # （PromptDisplay 无需改动即可展示可定制项）
            customization_slots = self._extract_customization_slots(rule_card, slots_raw)

            directions = [
                self._assemble_version_b_direction(
                    rule_card=rule_card,
                    recommended=rec,
                    customization_slots=customization_slots,
                    adaptation=adaptation,
                    target_product=target_product,
                    library_recommendations=library_recommendations,
                )
                for rec in recommendations
            ]
            return {"directions": directions, "num_directions": len(directions)}

        # ── 单套路径（默认，行为与改造前等价）──
        if self.ai_client:
            # AI 推荐模式
            recommended = await self._ai_recommend(rule_card, target_product)
        else:
            # 随机推荐模式：从 alternatives 取第一个
            recommended = self._random_recommend(layer_3, target_product)

        # R4：提取可定制项。传 None（字段缺失，如随机模式/AI降级）走规则卡兜底；
        # AI 显式返回 [] 表示"无可定制项"则尊重，不兜底。故不设默认 []，缺失传 None。
        customization_slots = self._extract_customization_slots(
            rule_card, recommended.get("customization_slots")
        )

        return self._assemble_version_b_direction(
            rule_card=rule_card,
            recommended=recommended,
            customization_slots=customization_slots,
            adaptation=adaptation,
            target_product=target_product,
            library_recommendations=library_recommendations,
        )

    def _assemble_version_b_direction(
        self,
        rule_card: dict,
        recommended: dict,
        customization_slots: list,
        adaptation: dict,
        target_product: str,
        library_recommendations: Optional[List[dict]] = None,
    ) -> dict:
        """把一套推荐方案组装成版本B 的结果 dict（三期阶段三抽出的纯重构）。

        单套路径与多方案路径共用这一份组装逻辑，保证两条路径产出的字段
        **逐字段一致**（前端 PromptDisplay 直接消费，形状不能有差异）。

        参数:
            recommended: 一套推荐（含 recommended_changes/reason/三段英文描述/negative_elements）
            customization_slots: 已经过 _extract_customization_slots 处理的可定制项列表
            adaptation: 已算好的产品适配规则（多套共用，避免重复计算）
        """
        layer_0 = rule_card.get("layer_0_core", {})
        layer_2 = rule_card.get("layer_2_visual", {})
        layer_3 = rule_card.get("layer_3_variable", {})

        locked_core = layer_0.get("core_selling_point", "")
        recommended_changes = recommended.get("recommended_changes", {})
        reason = recommended.get("reason", "随机选取替代方案")

        # 组装中文结构化提示词
        structured_prompt_cn = self._build_structured_prompt_cn(
            layer_0, layer_2, layer_3, recommended_changes, adaptation, target_product,
            library_recommendations=library_recommendations,
        )

        # 组装英文生图提示词
        image_prompt_positive, image_prompt_negative = self._build_image_prompts(
            rule_card, layer_0, layer_2, layer_3, recommended_changes, recommended, adaptation,
            target_product, library_recommendations=library_recommendations,
        )

        # 生成改款说明
        change_summary = self._build_change_summary(layer_3, recommended_changes, locked_core)

        # #2：出口加工 recommended_changes_detail，供前端版本B卡片显示"维度:原值->新值"。
        # original 只从 layer_3 取（单一事实来源，不让 AI 重述避免不一致），参考 _build_change_summary 同款逻辑。
        # key 恒等于 layer_3 维度名（_random_recommend 遍历 layer_3，AI prompt 约束"只从第3层选"）；
        # 取不到时 original 留空字符串，前端有 change.original && 守卫兜底。
        replaceable = layer_3.get("replaceable_elements", {})
        recommended_changes_detail = []
        for dim, val in recommended_changes.items():
            item = replaceable.get(dim, {})
            original = item.get("original", "") if isinstance(item, dict) else ""
            recommended_changes_detail.append({
                "dimension": dim,
                "original": original,
                "changed_to": val,
            })

        # #7：编辑指令式提示词（image_prompt_edit）——modifications 直接从 layer_3
        # 原始 item（非 recommended_changes_detail 里已字符串化的值）取，才能用上
        # original_en/alternatives_en 做语言映射（见 _edit_value_for_original/_chosen）
        edit_modifications = []
        for dim, val in recommended_changes.items():
            item = replaceable.get(dim, {})
            original_val = self._edit_value_for_original(item)
            chosen_val = self._edit_value_for_chosen(item, val)
            if chosen_val != original_val:
                edit_modifications.append(f"Replace {original_val} with {chosen_val}.")
        image_prompt_edit = self._build_edit_prompt(target_product, edit_modifications)

        return {
            "locked_core": locked_core,
            "recommended_changes": recommended_changes,
            "recommended_changes_detail": recommended_changes_detail,
            "reason": reason,
            "structured_prompt_cn": structured_prompt_cn,
            "image_prompt_positive": image_prompt_positive,
            "image_prompt_negative": image_prompt_negative,
            "image_prompt_edit": image_prompt_edit,
            "change_summary": change_summary,
            # R4：可定制项列表，前端展示为可选 checkbox，勾选后其 prompt_fragment 拼入生图提示词
            "customization_slots": customization_slots,
        }

    # ==================== 版本 A：资料库关联版 ====================

    async def generate_version_a(
        self,
        rule_card: dict,
        reference_images: list,
        target_product: str,
    ) -> dict:
        """版本 A：资料库关联版——基于参考图结构化生成提示词

        与版本 B 的区别：
        - 版本 B：AI 从可变边界随机选替换方案
        - 版本 A：从参考图的标签中提取视觉特征，结构化融入提示词

        参数:
            rule_card: 规则卡字典（RuleCard.model_dump() 的结果）
            reference_images: 用户选中的参考图列表（每项为 ImageTag.model_dump() 的结果）
            target_product: 目标产品类型（如 "毛毯"、"抱枕"）

        返回:
            包含锁定核心、参考图信息、提示词等的完整结果字典
        """
        layer0 = rule_card.get("layer_0_core", {})
        layer2 = rule_card.get("layer_2_visual", {})
        layer4 = rule_card.get("layer_4_product", {})

        # 1. 锁定核心卖点
        locked_core = {
            "core_selling_point": layer0.get("core_selling_point", ""),
            "selling_point_type": layer0.get("selling_point_type", ""),
            "why_it_sells": layer0.get("why_it_sells", ""),
            "lock_rule": layer0.get("lock_rule", ""),
        }

        # 2. 从参考图提取结构化视觉特征
        ref_visual_style = []   # type: List[str]
        ref_color_palette = []  # type: List[str]
        ref_composition = []    # type: List[str]
        ref_elements = []       # type: List[str]

        for img in reference_images:
            # #1：图库 styles/color_moods/layout_type 经 _extract_english，含 CJK 的丢弃（图库打标是中文）
            for s in (img.get('styles') or []):
                eng = self._extract_english(s)
                if eng and not self._contains_cjk(eng) and eng not in ref_visual_style:
                    ref_visual_style.append(eng)
                elif eng and self._contains_cjk(eng):
                    logging.warning("#1: 版本A ref style 含中文，丢弃: %s", eng[:50])
            for c in (img.get('color_moods') or []):
                eng = self._extract_english(c)
                if eng and not self._contains_cjk(eng) and eng not in ref_color_palette:
                    ref_color_palette.append(eng)
                elif eng and self._contains_cjk(eng):
                    logging.warning("#1: 版本A ref color 含中文，丢弃: %s", eng[:50])
            layout = img.get('layout_type', '')
            if layout:
                eng = self._extract_english(layout)
                if eng and not self._contains_cjk(eng) and eng not in ref_composition:
                    ref_composition.append(eng)
                elif eng and self._contains_cjk(eng):
                    logging.warning("#1: 版本A ref layout 含中文，丢弃: %s", eng[:50])
            for e in (img.get('elements') or []):
                if e and not self._contains_cjk(e) and e not in ref_elements:
                    ref_elements.append(e)
                elif e and self._contains_cjk(e):
                    logging.warning("#1: 版本A ref element 含中文，丢弃: %s", e[:50])

        # 3. 获取产品适配规则
        adaptation = self._get_adaptation(layer4, target_product)

        # 4. #4：构建英文正向提示词——按语义分段（与 _build_image_prompts 同款模板），
        # 换行分隔而非逗号拼一整行。target_product 之前从未进入过这版提示词，这次补上。
        composition_parts = []  # type: List[str]
        style_parts = []        # type: List[str]
        reference_note = ""     # type: str  # 参考元素是"提示"不是"必须画"，独立一句而非塞进 MUST include

        # 核心构图（从规则卡）+ 参考图构图特征。#1b：优先 layout_formula_en（VLM 英文输出），
        # 缺失回退中文。layout 是关键构图信息，无 _en 时保留中文+warning（不丢信息）。
        layout_formula = layer2.get("layout_formula", "")
        layout_en = layer2.get("layout_formula_en") or layout_formula
        self._append_english(composition_parts, layout_en, "layout_formula", allow_cjk_fallback=True)
        if ref_composition:
            composition_parts.append("composition reference: {}".format(', '.join(ref_composition)))

        # 产品适配说明（怎么把设计放到目标产品上，本质是构图相关信息）
        adapt_notes = adaptation.get("adaptation_notes", "")
        # #6：不再拼 canvas_ratio 到英文提示词——规则卡里的画布比例和用户在生图
        # 界面实选的宽高可能矛盾（如规则卡记录 1:1 但用户选了 3:4 竖版毯子），
        # 以实选尺寸为准，比例约束改由 image_gen.py submit 时前置（见 _ratio_text）。
        # 中文结构化提示词里的画布比例展示不受影响，仍照常显示。
        if adapt_notes:
            # #1：adaptation_notes 可能是中文（如"通用适配"），关键适配信息保留+warning（不丢）
            self._append_english(composition_parts, adapt_notes, "adaptation_notes", allow_cjk_fallback=True)

        # 参考图风格融合（ref_visual_style 元素已 CJK 过滤，fallback 用 _append_english 兜底）
        if ref_visual_style:
            style_parts.append("{} style".format(', '.join(ref_visual_style)))
        else:
            fallback_style = self._extract_english(layer2.get("style", ""))
            self._append_english(style_parts, fallback_style, "fallback_style")

        # 参考图色彩融合
        if ref_color_palette:
            style_parts.append("{} color palette".format(', '.join(ref_color_palette)))
        else:
            fallback_color = self._extract_english(layer2.get("color_mood", ""))
            if fallback_color and not self._contains_cjk(fallback_color):
                style_parts.append(fallback_color)
            elif fallback_color:
                logging.warning("#1: fallback color_mood 含中文，丢弃: %s", fallback_color[:50])

        # 参考图元素（作为参考提示，不是必须画的——保留原语义，独立一句不进 MUST include）
        if ref_elements:
            reference_note = "design elements reference: {}".format(', '.join(ref_elements[:5]))

        # POD 定制要素：_get_pod_hints 返回 [文字定制句, "clean printable design",
        # "high resolution..."]，前者归 Personalization，后两条质量要求归 Requirements
        pod_hints = self._get_pod_hints(rule_card)
        personalization_line = pod_hints[0] if pod_hints else ""
        requirements_parts = list(pod_hints[1:]) if pod_hints else []

        # 通用质量
        # R1：正向引导"只画英文文字"——比负向排除更可靠。OpenAI 模式下负向会被
        # 合并进正向（Do not include: ...），对弱模型有"粉红大象"效应，正向引导是主保障。
        requirements_parts.extend(["english text only", "high quality", "detailed", "professional design"])

        product_en = self._extract_product_name_en(target_product)
        lines = [f"Create a {product_en} print-on-demand design."]
        if composition_parts:
            lines.append("Composition: " + ", ".join(composition_parts) + ".")
        if style_parts:
            lines.append("Style: " + ", ".join(style_parts) + ".")
        if reference_note:
            lines.append(reference_note + ".")
        if personalization_line:
            lines.append("Personalization: " + personalization_line + ".")
        if requirements_parts:
            lines.append("Requirements: " + ", ".join(requirements_parts) + ".")

        positive = "\n".join(lines)

        # 5. 构建负向提示词
        negative_parts = list(COMMON_NEGATIVE_PROMPTS)
        # POD 印刷质量排除项
        for neg in POD_NEGATIVE_ADDITIONS:
            if neg not in negative_parts:
                negative_parts.append(neg)
        negative = ", ".join(negative_parts)

        # 6. 构建中文结构化提示词
        cn_parts = []  # type: List[str]
        cn_parts.append(
            "基于规则「{}」+ {} 张参考图生成".format(
                rule_card.get('rule_name', ''), len(reference_images)
            )
        )
        cn_parts.append("目标产品：{}".format(target_product))
        cn_parts.append("核心卖点：{}".format(locked_core['core_selling_point']))
        cn_parts.append(
            "参考图风格：{}".format(
                ', '.join(ref_visual_style) if ref_visual_style else '无'
            )
        )
        cn_parts.append(
            "参考图色彩：{}".format(
                ', '.join(ref_color_palette) if ref_color_palette else '无'
            )
        )
        cn_parts.append(
            "参考图构图：{}".format(
                ', '.join(ref_composition) if ref_composition else '无'
            )
        )
        cn_parts.append(
            "参考图元素：{}".format(
                ', '.join(ref_elements[:5]) if ref_elements else '无'
            )
        )
        structured_cn = "\n".join(cn_parts)

        # 7. 改款说明
        ref_summary = [
            "{}: {}".format(
                img.get('image_id', 'IMG-?'),
                ', '.join(img.get('styles', []))
            )
            for img in reference_images
        ]
        change_summary = {
            "kept": [
                locked_core['core_selling_point'],
                "参考了 {} 张自有图的风格特征".format(len(reference_images)),
            ],
            "changed": [
                "风格方向：基于参考图 {}".format(', '.join(ref_visual_style))
                if ref_visual_style else "",
                "色彩方向：基于参考图 {}".format(', '.join(ref_color_palette))
                if ref_color_palette else "",
                "构图参考：{}".format(', '.join(ref_composition))
                if ref_composition else "",
            ],
            "based_on_rule": rule_card.get("rule_name", ""),
            "reference_images": ref_summary,
        }
        # 过滤空字符串
        change_summary["changed"] = [c for c in change_summary["changed"] if c]

        # R4：可定制项--有 AI 走 AI 分析判断，无 AI 走规则卡兜底
        customization_slots = await self._get_customization_slots_with_ai_fallback(rule_card)

        # #7：编辑指令式提示词——版本A没有"元素替换"概念（不是从规则卡替换某个维度，
        # 是基于参考图做风格迁移），modifications 是风格/色彩/构图指令，只有实际提取到
        # 对应特征的才生成对应一条
        edit_modifications = []
        if ref_visual_style:
            edit_modifications.append(f"Restyle with: {', '.join(ref_visual_style)} style.")
        if ref_color_palette:
            edit_modifications.append(f"Recolor with: {', '.join(ref_color_palette)} palette.")
        if ref_composition:
            edit_modifications.append(f"Adjust composition to: {', '.join(ref_composition)}.")
        image_prompt_edit = self._build_edit_prompt(target_product, edit_modifications)

        return {
            "locked_core": locked_core,
            "structured_prompt_cn": structured_cn,
            "image_prompt_positive": positive,
            "image_prompt_negative": negative,
            "image_prompt_edit": image_prompt_edit,
            "change_summary": change_summary,
            "reference_images_used": [
                img.get('image_id', '') for img in reference_images
            ],
            # R4：可定制项列表，前端展示为可选 checkbox，勾选后拼入生图提示词
            "customization_slots": customization_slots,
        }

    # ==================== 版本 C：自定义模板版 ====================

    async def generate_version_c_template(self, rule_card: dict) -> dict:
        """版本 C：自定义模板版

        基于规则卡的第3层可变边界，生成前端下拉框选项结构。

        参数:
            rule_card: 规则卡字典

        返回:
            包含 locked_fields, selectable_fields, product_options 的结构
        """
        layer_0 = rule_card.get("layer_0_core", {})
        layer_3 = rule_card.get("layer_3_variable", {})
        layer_4 = rule_card.get("layer_4_product", {})

        # 1. 锁定的字段（灰色不可编辑）
        locked_fields = [
            {"label": "核心卖点", "value": layer_0.get("core_selling_point", "")},
            {"label": "卖点类型", "value": layer_0.get("selling_point_type", "")},
            {"label": "锁定规则", "value": layer_0.get("lock_rule", "")},
        ]

        # 2. 可选字段（下拉框）：从第3层的 replaceable_elements 生成
        selectable_fields = []
        replaceable = layer_3.get("replaceable_elements", {})
        for field_name, item in replaceable.items():
            original_value = item.get("original", "")
            alternatives = item.get("alternatives", [])

            # 构建选项列表，第一个是 original
            options = [
                {"label": f"{original_value}（原始）", "value": original_value, "is_original": True}
            ]
            for alt in alternatives:
                options.append({"label": alt, "value": alt, "is_original": False})

            selectable_fields.append({
                "field_name": field_name,
                "label": field_name,
                "options": options,
            })

        # #4b：给纯英文的选项加中文小字翻译（只前端展示用，不进最终提示词）。
        # original/alternatives 是 VLM 对每张图自由生成的值（犬种名称、装饰组合等），
        # 不是受控词表固定选项，没有现成中英对照表，只能临时调 AI 翻译；
        # 翻译结果不影响 value/is_original，翻错不影响生图，容错空间大。
        await self._translate_english_options(selectable_fields)

        # 3. 产品类型选项：从第4层的 adaptations keys 生成
        product_options = []
        adaptations = layer_4.get("adaptations", {})
        for product_name in adaptations:
            product_options.append({"label": product_name, "value": product_name})

        return {
            "locked_fields": locked_fields,
            "selectable_fields": selectable_fields,
            "product_options": product_options,
        }

    async def _translate_english_options(self, selectable_fields: list) -> None:
        """#4b：给 selectable_fields 里纯英文的 option 就地加 label_cn 字段。

        只翻译 value 本身不含 CJK 字符的选项（判断用 value 而非 label，因为 label
        可能带"（原始）"这种中文后缀，用 value 更干净）；纯数字/符号（如尺寸值）
        不含字母，翻译没有意义，也跳过。无 AI 客户端、AI 调用失败、JSON 解析失败
        时都直接跳过——这只是锦上添花的小字提示，不应该因为翻译失败而影响整个
        模板接口的可用性。
        """
        if not self.ai_client:
            return

        # 收集去重（同一个英文值可能在多个维度里重复出现，只翻一次）
        terms = []  # type: List[str]
        seen = set()
        for field in selectable_fields:
            for opt in field.get("options", []):
                value = opt.get("value", "")
                if not value or self._contains_cjk(value):
                    continue
                if not any(c.isalpha() for c in value):
                    continue  # 纯数字/符号，没有翻译的意义
                if value not in seen:
                    seen.add(value)
                    terms.append(value)

        if not terms:
            return

        system_prompt = get_option_translation_prompt(json.dumps(terms, ensure_ascii=False))
        result = await self._call_ai_for_json(
            system_prompt, "请严格按 JSON 格式输出翻译结果。", temperature=0,
        )
        if not result or "parse_error" in result:
            logging.warning("#4b: 版本C选项翻译失败，跳过（不影响下拉框正常使用）")
            return

        translations = result.get("translations", [])
        if len(translations) != len(terms):
            logging.warning(
                "#4b: 版本C选项翻译结果数量(%d)与请求数量(%d)不符，跳过",
                len(translations), len(terms),
            )
            return

        term_to_cn = dict(zip(terms, translations))
        for field in selectable_fields:
            for opt in field.get("options", []):
                cn = term_to_cn.get(opt.get("value", ""))
                if cn:
                    opt["label_cn"] = cn

    # ==================== 版本 C：根据用户选择生成 ====================

    async def generate_from_selections(
        self,
        rule_card: dict,
        selections: dict,
        target_product: str,
        library_recommendations: Optional[List[dict]] = None,
    ) -> dict:
        """根据用户在版本C中的选择，组装最终提示词

        参数:
            rule_card: 规则卡字典
            selections: 用户的选择映射，如 {"散落装饰": "暗红玫瑰花瓣", "配色方案": "黑+白+金"}
            target_product: 目标产品类型（如 "毛毯"）
            library_recommendations: 可选，自有图库推荐的参考图列表

        返回:
            同版本B的返回结构
        """
        layer_0 = rule_card.get("layer_0_core", {})
        layer_2 = rule_card.get("layer_2_visual", {})
        layer_3 = rule_card.get("layer_3_variable", {})
        layer_4 = rule_card.get("layer_4_product", {})

        locked_core = layer_0.get("core_selling_point", "")

        # 用户的选择就是推荐的改动
        recommended_changes = selections

        # 获取产品适配规则
        adaptation = self._get_adaptation(layer_4, target_product)

        # 组装中文结构化提示词
        structured_prompt_cn = self._build_structured_prompt_cn(
            layer_0, layer_2, layer_3, recommended_changes, adaptation, target_product,
            library_recommendations=library_recommendations,
        )

        # 组装英文生图提示词（没有 AI 推荐的辅助描述，使用从规则卡直接提取的信息）
        recommended_info = {
            "style_description": "",
            "color_description": "",
            "layout_description": "",
            "negative_elements": [],
        }
        image_prompt_positive, image_prompt_negative = self._build_image_prompts(
            rule_card, layer_0, layer_2, layer_3, recommended_changes, recommended_info, adaptation,
            target_product, library_recommendations=library_recommendations,
        )

        # 生成改款说明
        change_summary = self._build_change_summary(layer_3, recommended_changes, locked_core)

        # #7：编辑指令式提示词——判断"哪些维度真的变了"复用 _build_change_summary 同款
        # 标准（chosen = changes.get(field) or original，chosen == original 才算没变），
        # 不重新发明一套判断逻辑，避免两处标准不一致
        replaceable = layer_3.get("replaceable_elements", {})
        edit_modifications = []
        for field_name, item in replaceable.items():
            original = item.get("original", "") if isinstance(item, dict) else str(item or "")
            chosen = recommended_changes.get(field_name) or original
            if chosen == original:
                continue
            original_val = self._edit_value_for_original(item)
            chosen_val = self._edit_value_for_chosen(item, chosen)
            if chosen_val != original_val:
                edit_modifications.append(f"Replace {original_val} with {chosen_val}.")
        image_prompt_edit = self._build_edit_prompt(target_product, edit_modifications)

        # R4：可定制项--有 AI 走 AI 分析判断，无 AI 走规则卡兜底
        customization_slots = await self._get_customization_slots_with_ai_fallback(rule_card)
        return {
            "locked_core": locked_core,
            "recommended_changes": recommended_changes,
            "reason": "用户自定义选择",
            "structured_prompt_cn": structured_prompt_cn,
            "image_prompt_positive": image_prompt_positive,
            "image_prompt_negative": image_prompt_negative,
            "image_prompt_edit": image_prompt_edit,
            "change_summary": change_summary,
            # R4：可定制项列表，前端展示为可选 checkbox，勾选后拼入生图提示词
            "customization_slots": customization_slots,
        }

    # ==================== 内部辅助方法 ====================

    def _get_pod_hints(self, rule_card: dict) -> list:
        """从规则卡提取 POD（按需定制印刷）相关提示

        优先使用规则卡上显式的 is_text_slot 字段判断文字槽位（新分析出的规则卡会有此字段）；
        如果规则卡是旧数据、没有 is_text_slot 字段，兜底用关键词字符串匹配（向后兼容）。

        参数:
            rule_card: 规则卡字典

        返回:
            POD 相关英文提示词列表
        """
        layer2 = rule_card.get("layer_2_visual", {})
        layer3 = rule_card.get("layer_3_variable", {})
        must_have = layer2.get("must_have_elements", [])
        replaceable = layer3.get("replaceable_elements", {})

        # ── 从规则卡中提取竞品图上实际识别到的文字 ──
        extracted_texts = {}  # slot/dim_name → 实际文字

        # 判断这份规则卡是否属于"新版"——是否任一元素显式带了 is_text_slot 字段
        has_explicit_flags = any(
            isinstance(elem, dict) and "is_text_slot" in elem for elem in must_have
        ) or any(
            isinstance(item, dict) and "is_text_slot" in item for item in replaceable.values()
        )

        if has_explicit_flags:
            # ── 优先路径：显式 is_text_slot 字段（新规则卡，VLM 分析阶段已标注）──
            # 从 replaceable_elements 里标记了 is_text_slot=True 的项取原始文案
            for dim_name, item in replaceable.items():
                if isinstance(item, dict) and item.get("is_text_slot"):
                    original = item.get("original", "")
                    if original and len(original) < 100:  # 排除过长的描述
                        # R1：确保示例文案为英文，避免正向写中文与负向排除中文矛盾
                        extracted_texts[dim_name] = self._sanitize_text_slot_value(dim_name, original)

            # 从 must_have_elements 里标记了 is_text_slot=True 的项取描述
            for elem in must_have:
                if not isinstance(elem, dict) or not elem.get("is_text_slot"):
                    continue
                slot = elem.get("slot", "")
                desc = elem.get("description", "")
                if slot in extracted_texts:
                    continue
                # 语义去重：同一个文字元素往往在 layer_3（replaceable，如 犬种名称='Dachshund'）
                # 和 layer_2（must_have，如 主题文字区='大号手写体主题文字，当前为"Dachshund"'）各记一次，
                # 槽位名不同所以上面的 slot 去重挡不住。desc 里若包含任何已提取的文案值，
                # 判定为同一元素跳过——否则同一文字在提示词里出现两次，生图会画出两份（图中出现两个 name 的根因之一）
                if any(val and val in desc for val in extracted_texts.values()):
                    continue
                # R1：用 _sanitize 确保示例文案为英文（含中文等非 ASCII 转占位符），
                # 避免正向写中文与负向排除中文矛盾
                if desc and len(desc) < 80:
                    extracted_texts[slot] = self._sanitize_text_slot_value(slot, desc)
                elif "名字" in slot.lower() or "name" in slot.lower():
                    extracted_texts[slot] = "NAME"
                elif "日期" in slot.lower() or "date" in slot.lower():
                    extracted_texts[slot] = "2026"
        else:
            # ── 兜底路径：关键词字符串匹配（兼容没有 is_text_slot 字段的旧规则卡）──
            text_keywords = ['标题', '文案', '名字', '名称', '短句', '日期',
                             'title', 'text', 'name', 'slogan', 'date']

            # 从可替换元素中提取（这里的 original 是竞品图上的真实文案）
            for dim_name, item in replaceable.items():
                if any(kw in dim_name.lower() for kw in text_keywords):
                    original = item.get("original", "") if isinstance(item, dict) else str(item)
                    if original and len(original) < 100:  # 排除过长的描述
                        # R1：确保示例文案为英文，避免正向写中文与负向排除中文矛盾
                        extracted_texts[dim_name] = self._sanitize_text_slot_value(dim_name, original)

            # 从 must_have_elements 中补充（如果 replaceable 没覆盖到的文字槽位）
            for elem in must_have:
                if not isinstance(elem, dict):
                    continue
                slot = elem.get("slot", "")
                desc = elem.get("description", "")
                slot_lower = (slot + desc).lower()
                if any(kw in slot_lower for kw in text_keywords):
                    # 检查 desc 是否像具体文案（而非"两个人名字"这种描述）
                    if slot not in extracted_texts:
                        # 语义去重：desc 包含已提取的文案值 = 两层记的同一个文字元素，跳过防重复（同优先路径）
                        if any(val and val in desc for val in extracted_texts.values()):
                            continue
                        # R1：用 _sanitize 确保示例文案为英文（含中文等非 ASCII 转占位符）
                        if desc and len(desc) < 80:
                            extracted_texts[slot] = self._sanitize_text_slot_value(slot, desc)
                        elif "名字" in slot_lower or "name" in slot_lower:
                            extracted_texts[slot] = "NAME"
                        elif "日期" in slot_lower or "date" in slot_lower:
                            extracted_texts[slot] = "2026"

        # ── 生成 POD 定制提示词（这部分逻辑不变） ──
        hints = []  # type: List[str]

        if extracted_texts:
            # 有具体文字，用识别到的真实文案作示例
            # 按"值"去重（保序）：不同槽位的中文描述会被 _sanitize 统一转成 'NAME'，
            # 不去重就输出 'NAME', 'NAME'——提示词字面要求画两个 NAME，图上必然重复
            text_parts = []
            seen_values = set()
            for slot, text in extracted_texts.items():
                if text in seen_values:
                    continue
                seen_values.add(text)
                text_parts.append(f"'{text}'")
            hints.append(
                f"include personalized text elements in the design: {', '.join(text_parts)}, "
                "each text appears exactly once, "
                "positioned naturally as part of the layout for print-on-demand customization"
            )
        else:
            # 没有识别到具体文字，通用提示
            hints.append(
                "design should be suitable for print-on-demand personalization, "
                "include sample text 'NAME' in the design, positioned naturally as part of the layout"
            )

        # 通用 POD 质量要求
        # #15：删掉 "no watermark no signature"--负向列表已含 watermark/signature，
        # 正向写否定句对指令遵循弱的模型有"粉红大象"效应（反被诱导画出水印）。
        hints.extend([
            "clean printable design",
            "high resolution suitable for fabric/product printing",
        ])

        return hints

    async def _call_ai_for_json(self, system_prompt: str, user_prompt: str, temperature: Optional[float] = None) -> Optional[dict]:
        """封装"调 AI 文本请求 + 解析 JSON"，失败返回 None。

        供 _ai_recommend（版本B 改款推荐）和 _ai_analyze_customization_slots（A/C 可定制项分析）共用，
        消除"序列化 rule_card + 调 AI + 解析 JSON + 异常处理"的重复骨架。降级策略由调用方控制。

        参数:
            temperature: 可选，结构化任务传 0（稳定输出），创意任务不传（保持多样性）
        """
        try:
            response = await self.ai_client.text_request(system_prompt, user_prompt, temperature=temperature)
            return extract_json_from_ai_response(response)
        except Exception:
            return None

    async def _get_customization_slots_with_ai_fallback(self, rule_card: dict) -> list:
        """R4：可定制项--有 AI 走 AI 分析判断（不全加），无 AI 走规则卡兜底。"""
        if self.ai_client:
            return await self._ai_analyze_customization_slots(rule_card)
        return self._extract_customization_slots(rule_card, None)

    async def _ai_analyze_customization_slots(self, rule_card: dict) -> list:
        """R4：AI 分析规则卡，判断适配这张图的可定制项（不全加，AI 判断哪些适配+位置）。

        供版本A/C 用（它们不做改款推荐，但需要 AI 判断可定制项）。AI 基于规则卡
        （VLM 分析图得出的结构化数据）判断哪些定制项适配、位置在哪。失败时兜底
        从规则卡 is_text_slot 项提取。
        """
        rule_card_json = json.dumps(rule_card, ensure_ascii=False, indent=2)
        system_prompt = get_customization_analysis_prompt(rule_card_json)
        user_prompt = "请基于规则卡判断这张图适合哪些可定制项，严格按 JSON 格式输出。"
        result = await self._call_ai_for_json(system_prompt, user_prompt, temperature=0)
        if result is None:
            return self._extract_customization_slots(rule_card, None)  # AI 调用失败兜底
        ai_slots = result.get("customization_slots", []) if isinstance(result, dict) else []
        # 用 _extract_customization_slots 校验（传 AI 返回的 slots，主路径校验+补 fragment）
        return self._extract_customization_slots(rule_card, ai_slots)

    async def _ai_recommend(self, rule_card: dict, target_product: str) -> dict:
        """调用 AI 推荐改款方向

        参数:
            rule_card: 完整规则卡字典
            target_product: 目标产品类型

        返回:
            AI 推荐的结果字典
        """
        # 构造提示词
        rule_card_json = json.dumps(rule_card, ensure_ascii=False, indent=2)
        system_prompt = get_recommendation_prompt(rule_card_json, target_product)
        user_prompt = f"请基于规则卡为「{target_product}」推荐一个改款方向，严格按 JSON 格式输出。"

        result = await self._call_ai_for_json(system_prompt, user_prompt)
        if result and "recommended_changes" in result:
            return result
        # AI 调用失败（result is None）或返回格式异常，降级为随机推荐
        layer_3 = rule_card.get("layer_3_variable", {})
        fallback = self._random_recommend(layer_3, target_product)
        fallback["reason"] = (
            "AI 调用失败或返回格式异常，已降级为随机推荐" if result is None
            else "AI 返回格式异常，已降级为随机推荐"
        )
        return fallback

    def _random_recommend(self, layer_3: dict, target_product: str) -> dict:
        """随机推荐模式：从 alternatives 中取第一个替代方案

        参数:
            layer_3: 第3层可变边界数据
            target_product: 目标产品类型

        返回:
            推荐结果字典
        """
        recommended_changes = {}
        replaceable = layer_3.get("replaceable_elements", {})

        for field_name, item in replaceable.items():
            alternatives = item.get("alternatives", [])
            if alternatives:
                # 取第一个替代方案
                recommended_changes[field_name] = alternatives[0]
            else:
                # 没有替代方案，保持原始值
                recommended_changes[field_name] = item.get("original", "")

        return {
            "recommended_changes": recommended_changes,
            "reason": f"随机推荐模式：为每个可替换维度选取了第一个替代方案，适配「{target_product}」产品",
            "style_description": "",
            "color_description": "",
            "layout_description": "",
            "negative_elements": [],
        }

    async def _ai_recommend_multi(
        self, rule_card: dict, target_product: str, num_directions: int
    ) -> dict:
        """三期阶段三：一次 AI 调用返回多套差异化改款方案。

        参数:
            num_directions: 期望的方案数（>1）

        返回:
            {"recommendations": List[dict], "customization_slots": Optional[list]}
            —— recommendations 至少 1 项；AI 失败/无有效项时降级为随机轮转推荐。
        """
        rule_card_json = json.dumps(rule_card, ensure_ascii=False, indent=2)
        system_prompt = get_recommendation_prompt(
            rule_card_json, target_product, num_directions=num_directions
        )
        user_prompt = (
            f"请基于规则卡为「{target_product}」推荐 {num_directions} 套彼此明显差异化的"
            f"改款方案，严格按 JSON 格式输出。"
        )

        # 创意任务不传 temperature（#13 约定），保持多套方案的多样性
        result = await self._call_ai_for_json(system_prompt, user_prompt)

        layer_3 = rule_card.get("layer_3_variable", {})
        if not result:
            logging.warning(
                "多方案推荐 AI 调用失败，降级为随机轮转推荐（期望 %d 套）", num_directions
            )
            return {
                "recommendations": self._random_recommend_multi(
                    layer_3, target_product, num_directions, degraded_note="AI 调用失败"
                ),
                "customization_slots": None,
            }

        raw_list = result.get("recommendations")
        valid = []
        if isinstance(raw_list, list):
            for rec in raw_list:
                # recommended_changes 必须是非空 dict，否则这套方案没有任何可用改动，丢弃
                if isinstance(rec, dict) and isinstance(rec.get("recommended_changes"), dict) \
                        and rec["recommended_changes"]:
                    valid.append(rec)

        if not valid:
            logging.warning(
                "多方案推荐 AI 返回格式异常（无有效方案），降级为随机轮转推荐（期望 %d 套）",
                num_directions,
            )
            return {
                "recommendations": self._random_recommend_multi(
                    layer_3, target_product, num_directions, degraded_note="AI 返回格式异常"
                ),
                "customization_slots": result.get("customization_slots"),
            }

        if len(valid) < num_directions:
            # 有效项不足也照常返回（不报错）——少几套方案仍然可用，
            # 前端按实际条数渲染卡片
            logging.warning(
                "多方案推荐：AI 只返回了 %d 套有效方案（期望 %d 套）", len(valid), num_directions
            )

        return {
            "recommendations": valid[:num_directions],
            "customization_slots": result.get("customization_slots"),
        }

    def _random_recommend_multi(
        self,
        layer_3: dict,
        target_product: str,
        num_directions: int,
        degraded_note: str = "",
    ) -> List[dict]:
        """三期阶段三：无 AI / AI 降级时的多方案推荐——轮转取 alternatives。

        第 i 套方案的每个维度取 `alternatives[i % len(alternatives)]`
        （空 alternatives 用 original）。只要某维度的 alternatives 数量 > 1，
        各套方案就天然不同，不会给出 N 套一模一样的结果。

        参数:
            degraded_note: 非空时说明这是从 AI 降级来的，写进 reason 让用户知道
        """
        replaceable = layer_3.get("replaceable_elements", {})
        results = []  # type: List[dict]

        for i in range(num_directions):
            recommended_changes = {}
            for field_name, item in replaceable.items():
                alternatives = item.get("alternatives", []) if isinstance(item, dict) else []
                if alternatives:
                    recommended_changes[field_name] = alternatives[i % len(alternatives)]
                else:
                    recommended_changes[field_name] = (
                        item.get("original", "") if isinstance(item, dict) else ""
                    )
            prefix = f"{degraded_note}，已降级为" if degraded_note else ""
            results.append({
                "recommended_changes": recommended_changes,
                "reason": (
                    f"{prefix}随机轮转推荐（第 {i + 1} 套）：为每个可替换维度选取了第 "
                    f"{i + 1} 个候选替代方案，适配「{target_product}」产品"
                ),
                "style_description": "",
                "color_description": "",
                "layout_description": "",
                "negative_elements": [],
            })

        return results

    def _parse_is_text_slot(self, raw) -> bool:
        """R4：解析 is_text_slot 字段为布尔值。

        LLM 常返回字符串 "true"/"false" 而非布尔，bool("false")==True 会误判，
        故字符串时按内容判断（strip+lower=="true"）；非字符串走 bool()。
        主路径（AI 返回）和兜底路径（规则卡）共用，保证一致。
        """
        if isinstance(raw, str):
            return raw.strip().lower() == "true"
        return bool(raw)

    def _extract_customization_slots(self, rule_card: dict, ai_slots: list) -> list:
        """R4：提取可定制项列表，供前端展示为可选 checkbox。

        优先用 AI 返回的 ai_slots（校验+补全 prompt_fragment）；
        AI 未返回或格式异常时，从规则卡兜底——layer_2.must_have_elements 和
        layer_3.replaceable_elements 里 is_text_slot=True 的项都是可定制文字位。
        兜底逻辑与 _get_pod_hints 同源数据、同思路。返回的每项都含
        slot_name/position/description/is_text_slot/prompt_fragment（fragment 全英文，
        呼应 R1 图无中文）。
        """
        slots = []
        # 主路径：AI 返回了 customization_slots（含空数组 []——尊重 AI"无可定制项"的判断，不兜底）
        if isinstance(ai_slots, list):
            for s in ai_slots:
                if not isinstance(s, dict) or not s.get("slot_name"):
                    continue
                slot = {
                    "slot_name": str(s.get("slot_name", "")),
                    "position": str(s.get("position", "")),
                    "description": str(s.get("description", "")),
                    # R4：用 _parse_is_text_slot 解析（字符串 true/false 防误判）
                    "is_text_slot": self._parse_is_text_slot(s.get("is_text_slot", False)),
                }
                # prompt_fragment 缺失或含中文则兜底生成（确保英文，呼应 R1）
                frag = s.get("prompt_fragment", "")
                if frag and not self._contains_cjk(frag):
                    slot["prompt_fragment"] = str(frag)
                else:
                    slot["prompt_fragment"] = self._build_slot_prompt_fragment(slot)
                slots.append(slot)
            return slots[:5]  # AI 显式返回（含空 [] 或格式无效）尊重，不兜底；限制最多 5 项

        # 兜底路径：ai_slots 非 list（缺失/None，如随机模式/A/C 版本），从规则卡提取。
        # 从 layer_2.must_have_elements 提取 is_text_slot 项（带 position 实际位置，与图设计适搭），
        # description 优先用 layer_3 同组 original（真实文案）。
        # 按优先级排序（名字/年龄/团队/家族优先），限制最多 5 项，避免过多定制项。
        layer2 = rule_card.get("layer_2_visual", {})
        layer3 = rule_card.get("layer_3_variable", {})
        must_have = layer2.get("must_have_elements", [])
        replaceable = layer3.get("replaceable_elements", {})

        # 优先关键词组（名字/年龄/团队/家族），用于排序 + layer2<->layer3 匹配
        priority_groups = [
            ['名字', '姓名', '名称', 'name'],
            ['年龄', 'age', '生日', 'birthday', '日期', 'date', 'year', '年份'],
            ['团队', 'team', '队伍', '球队'],
            ['家族', 'family', '家庭', '姓氏', 'surname'],
        ]

        def match_group(name):
            nl = (name or "").lower()
            for i, kws in enumerate(priority_groups):
                if any(kw in nl for kw in kws):
                    return i
            return len(priority_groups)  # 非优先，排后

        # layer3 的 is_text_slot 项按组索引（取 original 真实文案）
        layer3_original_by_group = {}
        for dim_name, item in replaceable.items():
            if isinstance(item, dict) and self._parse_is_text_slot(item.get("is_text_slot", False)):
                g = match_group(dim_name)
                if g not in layer3_original_by_group:
                    layer3_original_by_group[g] = item.get("original", "")

        raw_slots = []
        for elem in must_have:
            if not (isinstance(elem, dict) and self._parse_is_text_slot(elem.get("is_text_slot", False))):
                continue
            slot_name = elem.get("slot", "")
            g = match_group(slot_name)
            # description 优先用 layer3 同组 original（真实文案），否则 layer2.description
            desc = layer3_original_by_group.get(g) or elem.get("description", "")
            raw_slots.append({
                "slot_name": slot_name,
                "position": elem.get("position", ""),  # layer2 实际位置（与图设计适搭）
                "description": desc,
                "is_text_slot": True,
                "_group": g,
            })
        # 按优先级排序（名字/年龄/团队/家族在前），限制最多 5 项
        raw_slots.sort(key=lambda s: s["_group"])
        for s in raw_slots[:5]:
            del s["_group"]
            s["prompt_fragment"] = self._build_slot_prompt_fragment(s)
            slots.append(s)
        return slots

    def _translate_position_cn(self, position: str) -> str:
        """把中文位置描述映射成英文（如"顶部居中"->"top center"），用于 fragment。

        让定制项位置与图中的设计适搭（layer_2.must_have 的 position 是 VLM 分析图得出的
        实际位置），而非通用 "in the design"。覆盖常见位置词。
        """
        parts = []
        if any(w in position for w in ["顶", "上"]):
            parts.append("top")
        if any(w in position for w in ["底", "下"]):
            parts.append("bottom")
        if any(w in position for w in ["居中", "中央", "中心"]):
            parts.append("center")
        if "左" in position:
            parts.append("left")
        if "右" in position:
            parts.append("right")
        if "胸" in position:
            parts.append("chest")
        return " ".join(parts)

    def _build_slot_prompt_fragment(self, slot: dict) -> str:
        """R4：为缺失 prompt_fragment 的可定制项兜底生成英文片段（拼入正向生图提示词）。

        文字定制位带具体文案（经 _sanitize 去中文，呼应 R1），让每个槽位 fragment 不同、
        对生图有实际引导；文案为中文或缺失时回退通用表述。图案元素位用元素描述。
        position/description 可能中文，取英文部分；含中文或无英文用通用表述，确保全英文。
        """
        is_text = slot.get("is_text_slot", False)
        position = slot.get("position", "")
        position_en = self._extract_english(position)
        if not position_en or self._contains_cjk(position_en):
            # 中文 position 映射成英文（与图设计适搭，如"顶部居中"->"top center"）
            position_en = self._translate_position_cn(position) or "in the design"
        if is_text:
            # 文字槽位：带具体文案（经 _sanitize 去中文），让每个槽位 fragment 不同
            original = slot.get("description", "") or slot.get("slot_name", "")
            if original:
                sanitized = self._sanitize_text_slot_value(slot.get("slot_name", ""), original)
                # sanitized 为英文文案时带上；为占位符 NAME/2026（中文文案转的）时用通用表述
                if sanitized and not self._contains_cjk(sanitized) and sanitized not in ("NAME", "2026"):
                    return f"customizable text '{sanitized}' {position_en}".strip()
            return f"customizable text placeholder {position_en}".strip()
        desc = slot.get("description", "")
        desc_en = self._extract_english(desc)
        if not desc_en or self._contains_cjk(desc_en):
            desc_en = "element"
        return f"customizable {desc_en} {position_en}".strip()

    def _get_adaptation(self, layer_4: dict, target_product: str) -> dict:
        """获取产品适配规则

        参数:
            layer_4: 第4层产品适配数据
            target_product: 目标产品类型

        返回:
            适配规则字典，找不到则返回空的默认值
        """
        adaptations = layer_4.get("adaptations", {})

        # 精确匹配
        if target_product in adaptations:
            return adaptations[target_product]

        # 模糊匹配（目标产品名包含在某个 key 中，或反过来）
        for key, value in adaptations.items():
            if target_product in key or key in target_product:
                return value

        # 找不到适配规则，返回默认值
        return {
            "canvas_ratio": "1:1",
            "adaptation_notes": "通用适配",
            "simplify": [],
            "enhance": [],
        }

    def _build_structured_prompt_cn(
        self,
        layer_0: dict,
        layer_2: dict,
        layer_3: dict,
        changes: dict,
        adaptation: dict,
        target_product: str,
        library_recommendations: Optional[List[dict]] = None,
    ) -> str:
        """组装中文结构化提示词

        每行标注来自哪一层，便于用户理解提示词的来源。

        参数:
            layer_0: 第0层核心卖点
            layer_2: 第2层视觉结构
            layer_3: 第3层可变边界
            changes: 替换方案（推荐的或用户选择的）
            adaptation: 产品适配规则
            target_product: 目标产品类型
            library_recommendations: 可选，自有图库推荐的参考图列表

        返回:
            多行中文结构化提示词
        """
        lines = []

        # 第0层：核心卖点（锁定）
        lines.append(f"【第0层 - 核心卖点🔒】")
        lines.append(f"  核心卖点：{layer_0.get('core_selling_point', '')}")
        lines.append(f"  锁定规则：{layer_0.get('lock_rule', '')}")
        lines.append("")

        # 第2层：视觉结构
        lines.append(f"【第2层 - 视觉结构】")
        lines.append(f"  构图公式：{layer_2.get('layout_formula', '')}")
        lines.append(f"  视觉风格：{layer_2.get('style', '')}")
        lines.append(f"  色彩情绪：{layer_2.get('color_mood', '')}")
        lines.append(f"  文字层级：{layer_2.get('text_hierarchy', '')}")

        # 必备元素
        must_have = layer_2.get("must_have_elements", [])
        if must_have:
            lines.append(f"  必备元素：")
            for elem in must_have:
                slot = elem.get("slot", "")
                desc = elem.get("description", "")
                pos = elem.get("position", "")
                lines.append(f"    - {slot}：{desc}（位置：{pos}）")
        lines.append("")

        # 第3层：可变边界 + 替换结果
        lines.append(f"【第3层 - 替换方案】")
        replaceable = layer_3.get("replaceable_elements", {})
        for field_name, item in replaceable.items():
            original = item.get("original", "")
            chosen = changes.get(field_name) or original  # #14：不传 default，空串/None 回退原值（避免空自定义值被误判为"已替换"丢元素/进负向）
            if chosen != original:
                lines.append(f"  {field_name}：{original} → {chosen}（已替换）")
            else:
                lines.append(f"  {field_name}：{original}（保持原始）")

        # 绝不能改的
        must_not = layer_3.get("must_not_change", [])
        if must_not:
            lines.append(f"  🚫 绝不能改：{', '.join(must_not)}")
        lines.append("")

        # 第4层：产品适配
        lines.append(f"【第4层 - 产品适配（{target_product}）】")
        lines.append(f"  画布比例：{adaptation.get('canvas_ratio', '1:1')}")
        lines.append(f"  适配说明：{adaptation.get('adaptation_notes', '')}")
        simplify = adaptation.get("simplify", [])
        if simplify:
            lines.append(f"  需简化：{', '.join(simplify)}")
        enhance = adaptation.get("enhance", [])
        if enhance:
            lines.append(f"  可增强：{', '.join(enhance)}")

        # 自有图库参考（如果有推荐图片）
        if library_recommendations:
            lines.append("")
            lines.append("【参考自有图】")
            for ref in library_recommendations:
                desc = ref.get("description", "")
                themes = ref.get("themes", [])
                styles = ref.get("styles", [])
                image_id = ref.get("image_id", "")
                ref_parts = []
                if themes:
                    ref_parts.append(f"主题: {'/'.join(themes)}")
                if styles:
                    ref_parts.append(f"风格: {'/'.join(styles)}")
                if desc:
                    ref_parts.append(desc)
                ref_text = "，".join(ref_parts)
                lines.append(f"  - {image_id}：{ref_text}")

        return "\n".join(lines)

    def _build_image_prompts(
        self,
        rule_card: dict,
        layer_0: dict,
        layer_2: dict,
        layer_3: dict,
        changes: dict,
        recommended: dict,
        adaptation: dict,
        target_product: str,
        library_recommendations: Optional[List[dict]] = None,
    ) -> tuple:
        """组装英文生图提示词（正向 + 负向）

        #4：正向提示词按语义分段（Composition/Style/MUST include/Personalization/
        Requirements），换行分隔，而非过去逗号拼一整行——分段结构对模型更易解析重点，
        且顺带修复两个信息点：target_product 之前从未进入过英文提示词；
        must_have_elements 的 position（元素该放画面哪个位置）之前被读入又被丢弃未使用。
        信息来源、_append_english 防中文泄漏机制、负向提示词逻辑均不变，只改这一层的
        输出格式。

        参数:
            rule_card: 完整规则卡字典（供 _get_pod_hints 提取真实定制文案）
            layer_0: 第0层核心卖点
            layer_2: 第2层视觉结构
            layer_3: 第3层可变边界
            changes: 替换方案
            recommended: AI 推荐结果（含 style_description 等辅助描述）
            adaptation: 产品适配规则
            target_product: 目标产品类型（如 "毛毯"、"T恤"），进 Composition 段开头
            library_recommendations: 可选，自有图库推荐的参考图列表

        返回:
            (positive_prompt, negative_prompt) 二元组
        """
        # ---- 分段收集：每段各自独立的 parts 列表，最后各自 join 再用换行拼接 ----
        composition_parts = []  # type: List[str]
        style_parts = []        # type: List[str]
        must_include = []       # type: List[str]  # "元素描述 (位置)" 或纯描述
        personalization_line = ""  # type: str
        requirements_parts = []  # type: List[str]

        # 1. 从第2层取构图描述和风格
        style = layer_2.get("style", "")
        color_mood = layer_2.get("color_mood", "")
        layout = layer_2.get("layout_formula", "")

        # 如果 AI 推荐提供了英文描述，优先使用
        ai_style = recommended.get("style_description", "")
        ai_color = recommended.get("color_description", "")
        ai_layout = recommended.get("layout_description", "")

        # 提取英文部分（词表格式为 "中文/English"）。#1b：layout 优先取 _en 平行字段（VLM 英文输出），
        # style/color_mood 是词表格式 _extract_english 可取英文，无需 _en。
        style_en = ai_style if ai_style else self._extract_english(style)
        color_en = ai_color if ai_color else self._extract_english(color_mood)
        layout_en = layer_2.get("layout_formula_en") or ai_layout or layout

        # 2. Composition 段：构图 + 核心卖点（核心卖点是"为什么这样设计"的意图说明，
        # 归在构图段末尾比单独成段更连贯）
        self._append_english(composition_parts, layout_en, "layout_formula")
        core = layer_0.get("core_selling_point", "")
        core_en = layer_0.get("core_selling_point_en") or self._extract_english(core)
        self._append_english(composition_parts, core_en, "core_selling_point")

        # 3. Style 段：风格 + 色彩 + 图库参考风格/元素
        self._append_english(style_parts, style_en, "style")
        if color_en and not self._contains_cjk(color_en):
            style_parts.append(f"{color_en} color palette")
        elif color_en:
            logging.warning("#1: color_mood 含中文，丢弃: %s", color_en[:50])

        if library_recommendations:
            ref_elements = []
            for ref in library_recommendations:
                # 提取参考图的风格英文部分（#1：图库打标是中文，_extract_english 对无 / 的中文原样返回，CJK 丢弃）
                for s in ref.get("styles", []):
                    s_en = self._extract_english(s)
                    if s_en and not self._contains_cjk(s_en) and s_en not in ref_elements:
                        ref_elements.append(s_en)
                    elif s_en and self._contains_cjk(s_en):
                        logging.warning("#1: ref style 含中文，丢弃: %s", s_en[:50])
                # 提取参考图的关键元素
                for elem in ref.get("elements", []):
                    e_en = self._extract_english(elem)
                    if e_en and not self._contains_cjk(e_en) and e_en not in ref_elements:
                        ref_elements.append(e_en)
                    elif e_en and self._contains_cjk(e_en):
                        logging.warning("#1: ref element 含中文，丢弃: %s", e_en[:50])
            if ref_elements:
                style_parts.append("reference style: " + ", ".join(ref_elements[:5]))

        # 4. MUST include 元素清单：从选中的替换方案取具体元素描述（不带 position——
        # ReplaceableItem 模型本身没有这个字段，只有 MustHaveElement 有）
        replaceable = layer_3.get("replaceable_elements", {})
        for field_name, item in replaceable.items():
            # #15：跳过文字槽位--其文案由 _get_pod_hints 统一处理（经 _sanitize 成英文），
            # 这里再 append 会重复，且 _extract_english 对中文文案无效会原样拼入（中文泄漏）。
            # 用 _parse_is_text_slot 解析防字符串 "false" 被误判为真。
            if isinstance(item, dict) and self._parse_is_text_slot(item.get("is_text_slot", False)):
                continue
            original = item.get("original", "")
            original_en = item.get("original_en") or ""
            chosen = changes.get(field_name) or original  # #14：不传 default，空串/None 回退原值（避免空自定义值被误判为"已替换"丢元素/进负向）
            # #1b：chosen 的英文--保持原始用 original_en；替换值先 _extract_english，
            # 对中文替代值无效时尝试 alternatives_en 索引映射；最终含中文则由 _append_english 丢弃
            if chosen == original and original_en:
                chosen_en = original_en
            else:
                chosen_en = self._extract_english(chosen)
                if chosen_en == chosen and chosen != original:
                    alts = item.get("alternatives", [])
                    alts_en = item.get("alternatives_en") or []
                    if alts_en and chosen in alts:
                        idx = alts.index(chosen)
                        if idx < len(alts_en):
                            chosen_en = alts_en[idx]
            temp = []  # type: List[str]
            self._append_english(temp, chosen_en, f"replaceable.{field_name}")
            must_include.extend(temp)

        # 5. MUST include 元素清单：必备元素（#4：新增 position，之前读入未使用）
        must_have = layer_2.get("must_have_elements", [])
        for elem in must_have:
            # #15：跳过文字槽位--其文案由 _get_pod_hints 统一处理（经 _sanitize 成英文），
            # 这里再 append 会重复（文字槽位同时存在于 must_have 和 replaceable 两层）。
            if isinstance(elem, dict) and self._parse_is_text_slot(elem.get("is_text_slot", False)):
                continue
            desc = elem.get("description", "")
            desc_en = elem.get("description_en") or self._extract_english(desc)
            temp = []  # type: List[str]
            self._append_english(temp, desc_en, "must_have.description")
            # position 字段模型上是纯中文（无 _en 平行字段，见 models/rule_card.py），
            # 不能假设它是英文——_extract_english 对词表格式"中文/English"能取到英文，
            # 纯中文（VLM 直接输出"中心偏上"这类值）无 / 会原样返回，必须再过 CJK 检测丢弃，
            # 否则英文提示词会混入中文（违反 R1 图无中文约束）
            position_raw = elem.get("position", "") if isinstance(elem, dict) else ""
            position_en = self._extract_english(position_raw)
            if position_en and self._contains_cjk(position_en):
                logging.warning("#1: must_have.position 含中文，丢弃: %s", position_en[:30])
                position_en = ""
            for d in temp:
                must_include.append(f"{d} ({position_en})" if position_en else d)

        # #6：不再拼 canvas_ratio 到英文提示词（原因同 _build_image_prompts 处注释：
        # 规则卡画布比例可能与用户实选生图尺寸矛盾，以实选为准，比例约束改由
        # image_gen.py submit 时前置）

        # 6. Personalization 段：POD 定制要素——从规则卡提取竞品图上的实际文案作示例。
        # _get_pod_hints 返回 [文字定制句, "clean printable design", "high resolution..."]，
        # 前者归 Personalization，后两条质量要求归 Requirements（不再和其他质量词混在一起）
        pod_customization_hints = self._get_pod_hints(rule_card)
        if pod_customization_hints:
            personalization_line = pod_customization_hints[0]
            requirements_parts.extend(pod_customization_hints[1:])

        # 7. Requirements 段：通用质量词
        # R1：正向引导"只画英文文字"——比负向排除更可靠。OpenAI 模式下负向会被
        # 合并进正向（Do not include: ...），对弱模型有"粉红大象"效应，正向引导是主保障。
        requirements_parts.extend(["english text only", "high quality", "detailed", "professional design"])

        # ---- 组装分段模板 ----
        product_en = self._extract_product_name_en(target_product)
        lines = [f"Create a {product_en} print-on-demand design."]
        if composition_parts:
            lines.append("Composition: " + ", ".join(composition_parts) + ".")
        if style_parts:
            lines.append("Style: " + ", ".join(style_parts) + ".")
        if must_include:
            lines.append("The design MUST include: " + "; ".join(must_include) + ".")
        if personalization_line:
            lines.append("Personalization: " + personalization_line + ".")
        if requirements_parts:
            lines.append("Requirements: " + ", ".join(requirements_parts) + ".")

        positive_prompt = "\n".join(lines)

        # ---- 负向提示词（不变） ----
        negative_parts = list(COMMON_NEGATIVE_PROMPTS)

        # 从 must_not_change 推导排除项
        must_not = layer_3.get("must_not_change", [])
        # must_not_change 列表本身不应出现在 negative 中（它是要保留的），
        # 但其"反面"应该被排除——即原始元素被替换掉的部分
        for field_name, item in replaceable.items():
            original = item.get("original", "")
            chosen = changes.get(field_name) or original  # #14：不传 default，空串/None 回退原值（避免空自定义值被误判为"已替换"丢元素/进负向）
            if chosen != original:
                # 被替换掉的原始元素加入 negative
                original_en = self._extract_english(original)
                if original_en:
                    negative_parts.append(original_en)

        # AI 推荐的排除元素
        ai_negatives = recommended.get("negative_elements", [])
        for neg in ai_negatives:
            neg_en = self._extract_english(neg)
            if neg_en and neg_en not in negative_parts:
                negative_parts.append(neg_en)

        # POD 印刷质量排除项
        for neg in POD_NEGATIVE_ADDITIONS:
            if neg not in negative_parts:
                negative_parts.append(neg)

        negative_prompt = ", ".join(negative_parts)

        return positive_prompt, negative_prompt

    def _build_change_summary(self, layer_3: dict, changes: dict, locked_core: str) -> dict:
        """生成改款说明

        参数:
            layer_3: 第3层可变边界
            changes: 替换方案
            locked_core: 锁定的核心卖点

        返回:
            改款说明字典
        """
        kept = []      # 保留的内容
        changed = []   # 改动的内容

        # 核心卖点始终保留
        kept.append(f"核心卖点：{locked_core}")

        # 绝不能改的元素
        must_not = layer_3.get("must_not_change", [])
        for item in must_not:
            kept.append(f"不可变元素：{item}")

        # 逐个维度检查
        replaceable = layer_3.get("replaceable_elements", {})
        for field_name, item in replaceable.items():
            original = item.get("original", "")
            chosen = changes.get(field_name) or original  # #14：不传 default，空串/None 回退原值（避免空自定义值被误判为"已替换"丢元素/进负向）
            if chosen == original:
                kept.append(f"{field_name}：{original}（保持原始）")
            else:
                changed.append(f"{field_name}：{original} → {chosen}")

        return {
            "kept": kept,
            "changed": changed,
        }

    def _extract_english(self, text: str) -> str:
        """从 "中文/English" 格式的文本中提取英文部分（委托给共享的 vocab_utils）"""
        return extract_english_part(text)

    def _contains_cjk(self, text: str) -> bool:
        """判断 text 是否含 CJK（中日韩）汉字字符。

        只检测中文汉字区间，不波及拉丁扩展字符（如 café/José/Mötley 的重音字母
        é/ñ/ü 仍是合法的非英文文案，应保留）。覆盖：CJK 统一汉字(4E00-9FFF)、
        扩展A(3400-4DBF)、兼容(F900-FAFF)、扩展B(20000-2FA1F)。
        """
        for c in text:
            cp = ord(c)
            if (0x4E00 <= cp <= 0x9FFF or 0x3400 <= cp <= 0x4DBF
                    or 0xF900 <= cp <= 0xFAFF or 0x20000 <= cp <= 0x2FA1F):
                return True
        return False

    def _extract_product_name_en(self, target_product: str) -> str:
        """#4：从 target_product 提取英文产品名，供英文提示词首句使用。

        target_product 的真实格式是空格分隔的"英文名 中文名"（如 "T-Shirt T恤"、
        "Mug 马克杯"），不是词表的"中文/English"斜杠格式，_extract_english 处理
        不了（无 / 会原样返回整串，导致英文提示词里混入中文）。按空格切分后只保留
        不含 CJK 的词——这些产品名英文部分本身不含空格，多词英文名（如未来可能出现
        "Beach Towel"）会被这个简单分词拆开，属已知局限，全部找不到时兜底返回原值
        （极端情况总比空字符串强，宁可保留可能含中文的产品名也不让提示词第一句缺失产品类型）。
        """
        if not target_product:
            return ""
        candidates = [w for w in target_product.split() if w and not self._contains_cjk(w)]
        if candidates:
            return " ".join(candidates)
        logging.warning("#4: target_product 提取不到英文部分，原样使用: %s", target_product[:30])
        return target_product

    def _append_english(self, parts: list, text: str, field_name: str,
                        allow_cjk_fallback: bool = False) -> None:
        """#1：拼接英文片段到正向提示词，堵中文泄漏。

        text 应已是 _en 优先后的值（调用方先尝试 *_en 字段，缺失再回退中文）。
        含 CJK 时：
        - allow_cjk_fallback=True（版本A layout/adaptation_notes 等关键构图/适配信息）：
          保留并 warning（#1b 根因阶段新规则卡应有 _en，此处仅兜底旧数据，不丢信息）。
        - allow_cjk_fallback=False：丢弃并 warning（避免中文元素描述进英文生图提示词，
          诱发支持文字渲染的模型画出中文，与 R1 图无中文矛盾）。
        空值直接跳过。
        """
        if not text or not text.strip():
            return
        if self._contains_cjk(text):
            if allow_cjk_fallback:
                logging.warning("#1: 字段 %s 含中文且无 _en，临时保留: %s", field_name, text[:50])
                parts.append(text)
            else:
                logging.warning("#1: 字段 %s 含中文，丢弃不入英文提示词: %s", field_name, text[:50])
        else:
            parts.append(text)

    # ==================== 编辑指令式提示词（image_prompt_edit）====================
    # 配合竞品原图一起发给生图 API 的 /v1/images/edits 接口：Spike 验证过带图 + 编辑
    # 指令（只说"改哪里"，不重新描述整个设计）比纯文本"完整描述"式提示词更精确、更短。
    # 与 image_prompt_positive 并存，两者互不影响，供后续"附带竞品原图生图"功能选用。

    def _edit_lang_value(self, raw: str, en: Optional[str] = None) -> str:
        """编辑指令提示词的取值策略：优先英文，取不到则放行原始值（可能含中文）。

        与 _append_english 的策略刚好相反——编辑指令提示词会连同竞品原图一起发给
        生图模型，模型能"看到"图内容，中文值在这里只是用来定位"图里的哪个东西"，
        不是要求模型画出中文字，因此不丢弃、不报 warning，也不做 NAME/2026 占位替换。
        """
        if en and not self._contains_cjk(en):
            return en
        extracted = self._extract_english(raw)
        if extracted and not self._contains_cjk(extracted):
            return extracted
        return raw

    def _edit_value_for_original(self, item) -> str:
        """取可替换维度 original 的编辑指令用值（语言策略见 _edit_lang_value）。"""
        if not isinstance(item, dict):
            return self._edit_lang_value(str(item or ""))
        return self._edit_lang_value(item.get("original", ""), item.get("original_en"))

    def _edit_value_for_chosen(self, item, chosen: str) -> str:
        """取可替换维度 chosen（替换后的值）的编辑指令用值。

        chosen 等于 original 时复用 original_en；不等时尝试 alternatives_en 索引映射
        （与 _build_image_prompts 的 chosen_en 推导逻辑一致），取不到再走通用兜底。
        """
        if not isinstance(item, dict):
            return self._edit_lang_value(chosen)
        original = item.get("original", "")
        if chosen == original:
            return self._edit_lang_value(original, item.get("original_en"))
        alts = item.get("alternatives", [])
        alts_en = item.get("alternatives_en") or []
        if alts_en and chosen in alts:
            idx = alts.index(chosen)
            if idx < len(alts_en):
                return self._edit_lang_value(chosen, alts_en[idx])
        return self._edit_lang_value(chosen)

    def _build_edit_prompt(self, target_product: str, modifications: List[str], requirements_note: str = "") -> str:
        """组装"编辑指令"式生图提示词。

        假设生图 API 会拿到竞品原图作为输入，只需说明"在这张图基础上做哪些修改"，
        其余保持不变，不必像 image_prompt_positive 那样从头描述整个设计。

        参数:
            target_product: 目标产品类型（如 "毛毯"、"T恤"）
            modifications: 修改指令列表，每项已是完整的一条指令（如
                           "Replace Dachshund with French Bulldog."）；为空列表时
                           用"无元素改动，忠实还原原图"的兜底句
            requirements_note: 预留参数，供后续批次插入额外定制项文本，本次不使用
        """
        lines = [
            f"Using the attached image as the base design, recreate it as a {target_product} "
            "print design with ONLY these modifications:"
        ]
        if modifications:
            for i, mod in enumerate(modifications, 1):
                lines.append(f"{i}. {mod}")
        else:
            lines.append("1. No element changes; faithfully recreate the base design.")
        lines.append(
            "Keep everything else — composition, style, layout and all other elements — "
            "identical to the reference image."
        )
        lines.append(
            "Requirements: all visible text in the image must be English only; "
            "each text appears exactly once; clean printable design."
        )
        return "\n".join(lines)

    def _sanitize_text_slot_value(self, dim_name: str, original: str) -> str:
        """R1：确保文字槽位的示例文案不含中文，避免正向写中文与负向排除中文矛盾。

        生成的图不能出现中文（R1），但 _get_pod_hints 会把竞品图上识别到的真实
        文案作为示例写进正向提示词。若该文案含中文汉字（如"妈妈花园"），正向
        要求画中文会与负向排除中文打架，此时按槽位类型用英文占位符替代。
        纯英文/数字/ASCII 符号（如 "Mom's Garden"、2026）以及带重音的拉丁文
        （如 café/José，非 CJK）原样返回。

        注意：不使用 _extract_english（它按"中文/English"词表格式 split，对自由
        文案会误判——纯中文"妈妈花园"无 / 会被原样返回，达不到过滤目的）。
        判定用 _contains_cjk（只查 CJK 汉字），而非 ord>=128（会误伤拉丁重音）。
        """
        if not self._contains_cjk(original):
            return original
        dim_lower = dim_name.lower()
        if "日期" in dim_lower or "date" in dim_lower:
            return "2026"
        return "NAME"


# ==================== 元素拆分图（三期阶段四） ====================

def _parse_is_text_slot_value(raw) -> bool:
    """解析 is_text_slot 字段为布尔值（模块级版本，供 extract_element_list 用）。

    与 PromptGenerator._parse_is_text_slot 同一套判定：LLM 常返回字符串
    "true"/"false" 而非布尔，`bool("false") == True` 会误判，故字符串按内容判断。
    """
    if isinstance(raw, str):
        return raw.strip().lower() == "true"
    return bool(raw)


def _element_value_for_prompt(raw: str, en: Optional[str] = None) -> str:
    """取元素描述的抠取指令用值：优先英文，取不到则**放行原始中文**。

    与 _append_english（英文生图提示词，含中文就丢弃）的策略刚好相反，
    与批次四 _edit_lang_value 一致——抠取指令会连同竞品原图一起发给生图模型，
    中文只是用来定位"图里的哪个东西"，不是要求模型画出中文字，所以不丢弃。
    （CLAUDE.md 铁律 §2-10）
    """
    if en and isinstance(en, str) and en.strip():
        return en.strip()
    return (raw or "").strip()


# 抽象属性类维度名关键词——这类维度描述的是"整体怎么画"（风格/配色/氛围），
# 不是画面里可以单独抠出来的物件。实测把"柔和水彩""粉白绿棕（女孩感）""通用"
# 送进抠取指令，模型只能凭空编一张图，纯属白烧钱，所以在清单阶段就排除。
_ABSTRACT_DIMENSION_KEYWORDS = (
    "色彩", "配色", "颜色", "色调", "风格", "画风", "氛围", "情绪", "场景切换",
    "构图", "排版", "布局", "比例", "质感", "色系",
    "color", "palette", "style", "mood", "atmosphere", "layout", "composition",
)


# 文字位判断的关键词兜底——与 _get_pod_hints 的 text_keywords 同一份清单。
# 旧规则卡（VLM 分析阶段还没有 is_text_slot 字段）里所有元素的 is_text_slot 都缺失，
# 只靠该字段会把"名字/日期"这类文字位当成普通图案元素（排序不对、默认勾选不对）。
_TEXT_SLOT_KEYWORDS = ("标题", "文案", "名字", "名称", "短句", "日期",
                       "title", "text", "name", "slogan", "date")

# 纯色底/空白底的描述特征——这类"背景"抠出来就是一张纯色图，没有素材价值。
# 注意只能按**值**判断，不能按维度名判断："背景光效='Top underwater sun rays'"
# 这种名字里带"背景"但值是真实可抠元素（光束）的维度必须保留。
_PLAIN_BACKGROUND_VALUE_KEYWORDS = (
    "纯白", "纯色", "干净底", "空白", "留白", "单色",
    "plain white", "solid color", "solid white", "blank", "clean background",
    "plain background", "white background",
)


def _looks_like_text_slot(name: str, value: str, explicit) -> bool:
    """判断是否文字槽位：显式 is_text_slot 字段优先，缺失时按关键词兜底。

    与 _get_pod_hints 同款策略（新卡走字段、旧卡走关键词），保证同一张规则卡
    在"生图提示词的文字位处理"和"元素拆分清单"两处的判断一致。
    """
    if explicit is not None:
        return _parse_is_text_slot_value(explicit)
    blob = f"{name} {value}".lower()
    return any(k in blob for k in _TEXT_SLOT_KEYWORDS)


def _is_abstract_dimension(name: str, value: str) -> bool:
    """判断一个维度是否属于"抽象属性"（不可抠取）。

    只看维度名（name_cn）——它是 VLM 给的维度标签，比自由文本的值更稳定。
    值为空或极短的无意义占位（如"通用"）也排除。

    ⚠️ **实体名词优先于抽象关键词**（2026-08-18）：抽象关键词表里的"风格"
    是修饰词，但维度名 `边框花卉风格` 指的是画面里实际存在的花卉边框——
    实测 RULE-0067 因此把这个**带 4 个候选变体的维度整个丢掉**，界面上只剩下
    第2层那个没有候选的 `花卉边框装饰区`（用户反馈"元素变体素材和可变维度不同"）。
    所以维度名里出现实体名词（花卉/宠物/爪印…，见 _ENTITY_NOUNS）时不判抽象，
    真正的抽象维度（`整体色彩风格`、`排版布局`）不含实体词，不受影响。
    """
    low = (name or "").lower()
    if any(k in low for k in _ABSTRACT_DIMENSION_KEYWORDS):
        # 名字里有具体实体 → 抽象词只是修饰，这个维度是可抠的
        if not any(noun in (name or "") for noun in _ENTITY_NOUNS):
            return True
    # 纯色/空白底：抠出来就是一张纯色图，没有素材价值。按值判断而非按名判断，
    # 避免误伤"背景光效='水下阳光光束'"这类名字带"背景"但确实可抠的元素
    val_low = (value or "").lower()
    if any(k in val_low for k in _PLAIN_BACKGROUND_VALUE_KEYWORDS):
        return True
    # 值是"通用/无/默认"这类占位，抠不出东西
    return (value or "").strip() in ("通用", "无", "默认", "N/A", "none")


# 词级重叠去重的停用词（英文描述里的虚词/修饰词，不参与语义比较）
_DEDUP_STOPWORDS = {
    "a", "an", "the", "and", "or", "of", "in", "on", "at", "with", "as", "from",
    "to", "is", "are", "its", "it", "that", "this", "for", "by", "into",
    "around", "above", "below", "tones", "effect", "element", "elements",
}


def _semantic_words(text: str) -> set:
    """把描述切成用于比较的实词集合（小写、去停用词、粗糙去复数）。"""
    import re
    result = set()
    for w in re.findall(r"[a-zA-Z]+", (text or "").lower()):
        if w in _DEDUP_STOPWORDS or len(w) <= 2:
            continue
        # 粗糙去复数：reefs→reef、schools→school（长度>3 才削，避免 "sea"→"se"）
        result.add(w[:-1] if w.endswith("s") and len(w) > 3 else w)
    return result


def _cn_name_overlaps(name: str, existing_names: List[str]) -> bool:
    """中文维度名判重：第2层与第3层描述同一个位置时，**英文措辞可能毫无重叠**，
    词级判重挡不住，但中文维度名往往共享核心词。

    实测案例：第3层 `宠物类型='Golden retriever'` 与第2层
    `主体宠物肖像区='A front-facing half-body portrait of a single pet...'`
    是画面同一个位置，英文实词交集为空（品种名 vs 构图描述），
    但中文名都含"宠物"。同理 `爪印符号` 与 `爪印符号区`。

    判定分两级：
    1. 去掉结构性后缀/修饰词后，一方核心名是另一方的子串 → 同一位置。
    2. **共享"实体名词"**（2026-08-18 补强）：子串判定挡不住"修饰词位置不同"的
       情况——实测 RULE-0067 第3层 `边框花卉风格` 与第2层 `花卉边框装饰区`
       剥完后是 `花卉风格` vs `花卉装饰`，都含"花卉"却互不为子串，导致第2层那项
       漏判、在界面上多出一个"只有 1 个候选"的重复维度（用户实测反馈）。
       所以再比一次**实体词**：从名字里切出已知实体名词（花卉/宠物/爪印…），
       两边命中同一个实体词即视为同一元素。
    """
    def core(n: str) -> str:
        out = (n or "").strip()
        # ⚠️ 顺序关键：**长词必须排在其短后缀之前**。若 "型" 先于 "造型" 被剥掉，
        # "尾巴造型" 会变成 "尾巴造"，与 "人鱼尾巴" 失去子串关系（实测踩过）。
        for suffix in (
            "区域", "位置", "类型", "造型", "样式", "风格", "装饰", "图案",
            "主体", "符号", "边框",
            "区", "位", "层", "框", "型",
        ):
            out = out.replace(suffix, "")
        return out

    c = core(name)
    for other in existing_names:
        o = core(other)
        # 一级：子串关系（核心名太短如"花"容易误伤，需 >=2 字）
        if len(c) >= 2 and len(o) >= 2 and (c in o or o in c):
            return True
        # 二级：共享实体名词（挡"花卉风格" vs "花卉装饰"这类修饰词位置不同的情况）
        if _shared_entity_nouns(name, other):
            return True
        # 三级：共享"角色词"（2026-08-18）——第2层的泛化槽位名与第3层的具体维度名
        # 常常只共享一个角色词：`主体角色` vs `主体恐龙形象`、`中心主体角色` vs
        # `中心运动员形象`、`蝴蝶点缀` vs `点缀昆虫`、`边框装饰区` vs `边框装饰图案`。
        # 这类漏判会在界面上多出一个"只有 1 个候选"的重复维度。
        # 收紧条件防误伤（`海龟前景角色` vs `前景植物装饰` 是不同东西）：
        # 必须共享 >=2 个角色词，或共享 1 个角色词且两个核心名去掉角色词后有一方为空
        # （= 该名字除了角色词没有别的信息，只能是泛化槽位）。
        if _shared_role_words(name, other):
            return True
    return False


# 角色词：描述"这个元素在画面里扮演什么角色/以什么方式出现"的词，
# 本身不指向具体实体（实体词见 _ENTITY_NOUNS）。用于三级判重。
_ROLE_WORDS = (
    "主体", "中心", "角色", "形象", "装饰", "点缀", "边框", "背景",
    "前景", "环绕", "满版", "图标", "元素", "图案", "组合",
)


def _shared_role_words(a: str, b: str) -> bool:
    """两个维度名是否因共享"角色词"而指向同一元素（见 _cn_name_overlaps 三级判定）。"""
    a, b = (a or ""), (b or "")
    shared = [w for w in _ROLE_WORDS if w in a and w in b]
    if not shared:
        return False
    if len(shared) >= 2:
        return True
    # 只共享 1 个角色词：要求有一方"除了角色词就没有别的信息"（泛化槽位）
    def strip_roles(n: str) -> str:
        out = n
        for w in _ROLE_WORDS:
            out = out.replace(w, "")
        return out.strip("/、 ").strip()
    return not strip_roles(a) or not strip_roles(b)


# 实体名词表：用于中文名判重的二级判定。
# 只收"画面里真实存在的东西"（能被抠出来的实体），不收结构性/抽象词
# （区、位、风格、装饰这些已在 core() 里剥掉）。两个维度名命中同一个实体词，
# 说明它们指的是画面同一个东西，只是修饰角度不同。
#
# 同义组（2026-08-18）：有些实体在两层里用**上位词/下位词**记录，字面无重叠——
# 实测 `点缀昆虫='紫色蝴蝶'`（第3层）与 `蝴蝶点缀`（第2层）指同一群蝴蝶，
# 但"昆虫"与"蝴蝶"字面不同、英文 `butterflies`/`butterfly` 又因粗糙去复数
# 对不上，三道防线全漏。所以把这类同义/上下位词编成一组，组内任意两词视为命中。
_ENTITY_SYNONYM_GROUPS = (
    ("昆虫", "蝴蝶", "蜜蜂", "蜻蜓", "萤火虫"),
    ("宠物", "动物", "猫", "狗", "犬"),
    ("花卉", "花环", "花朵", "花草", "玫瑰", "雏菊", "向日葵"),
    ("叶子", "枝叶", "藤蔓", "植物", "树木"),
)

_ENTITY_NOUNS = (
    "花卉", "花环", "花朵", "叶子", "枝叶", "藤蔓",
    "宠物", "照片", "肖像", "头像", "爪印", "骨头", "项圈",
    "翅膀", "光环", "星空", "云朵", "彩虹", "拱门", "光晕",
    "动物", "人物", "背景", "天使", "皇冠", "蝴蝶", "爱心",
)


def _shared_entity_nouns(a: str, b: str) -> bool:
    """两个中文维度名是否命中同一个实体名词（见 _ENTITY_NOUNS 的说明）。

    先比字面相同的实体词，再比同义组（上位词/下位词，如"昆虫"与"蝴蝶"）。
    """
    a, b = (a or ""), (b or "")
    for noun in _ENTITY_NOUNS:
        if noun in a and noun in b:
            return True
    for group in _ENTITY_SYNONYM_GROUPS:
        if any(w in a for w in group) and any(w in b for w in group):
            return True
    return False


def _is_semantic_duplicate(candidate: str, existing: List[str], threshold: float = 0.7) -> bool:
    """词级重叠判重：候选描述与任一已收集描述的实词重叠率 >= threshold 即视为同一元素。

    为什么需要这道防线：同一个元素在第2/3层常被描述成不同措辞，子串匹配挡不住——
    实测 `尾巴造型='Glowing blue-green scaled tail'`（第3层）与
    `人鱼尾巴='A long scaled mermaid tail in blue-green tones...'`（第2层）
    没有子串包含关系，但显然是同一条尾巴。重叠率按**较短一方**计算
    （第2层描述通常长得多，按长的算会永远达不到阈值）。

    实测阈值 0.7 能把 4 组真重复（重叠率 100%）与 2 组不同元素
    （40% / 0%，如"鱼群+水母+海龟"整组 vs 单独的"左下角海龟"）分开。
    """
    cand = _semantic_words(candidate)
    if not cand:
        return False
    for other in existing:
        ow = _semantic_words(other)
        if not ow:
            continue
        short, long_ = (cand, ow) if len(cand) <= len(ow) else (ow, cand)
        if len(short & long_) / len(short) >= threshold:
            return True
    return False


def extract_element_list(rule_card: dict) -> List[dict]:
    """从规则卡提取"可拆分元素"清单（三期阶段四）。

    数据来自两层，且这两层**经常记录同一个元素**（第3层记 `犬种名称='Dachshund'`、
    第2层记 `主题文字区='大号手写体主题文字，当前为"Dachshund"'`），所以沿用
    `_get_pod_hints` 已验证过的两道去重防线，否则同一元素会被抠两次、白烧两次钱。

    参数:
        rule_card: 规则卡字典

    返回:
        List[dict]，每项含 element_key / name_cn / value_cn / value_for_prompt /
        position / is_text_slot / extraction_prompt。非文字位在前，文字位排最后。
    """
    layer_2 = rule_card.get("layer_2_visual", {}) or {}
    layer_3 = rule_card.get("layer_3_variable", {}) or {}
    replaceable = layer_3.get("replaceable_elements", {}) or {}
    must_have = layer_2.get("must_have_elements", []) or []

    items = []  # type: List[dict]

    # ── 1. 第3层可替换元素 ──
    for dim, item in replaceable.items():
        if not isinstance(item, dict):
            continue
        value_cn = (item.get("original") or "").strip()
        value_for_prompt = _element_value_for_prompt(value_cn, item.get("original_en"))
        if not value_for_prompt:
            continue
        # 抽象属性（风格/配色/氛围）抠不出实体，直接排除，别浪费调用
        if _is_abstract_dimension(dim, value_cn):
            continue
        items.append({
            "element_key": f"L3::{dim}",
            "name_cn": dim,
            "value_cn": value_cn,
            "value_for_prompt": value_for_prompt,
            "position": "",
            "is_text_slot": _looks_like_text_slot(dim, value_cn, item.get("is_text_slot")),
            "_raw": item,   # 原始层数据，_build_element_variants 要读 alternatives
        })

    # ── 2. 第2层必备元素（去重防线①：语义去重）──
    collected_names = {i["name_cn"] for i in items}
    collected_values = {i["value_cn"] for i in items if i["value_cn"]} | \
                       {i["value_for_prompt"] for i in items if i["value_for_prompt"]}
    for el in must_have:
        if not isinstance(el, dict):
            continue
        slot = (el.get("slot") or "").strip()
        desc = (el.get("description") or "").strip()
        # 防线①-a：槽位名与第3层维度同名 → 同一元素
        if slot and slot in collected_names:
            continue
        # 防线①-b：描述里包含任一已收集的元素值 → 同一元素的两次记录
        #（第2层描述常写成"…，当前为'xxx'"，xxx 正是第3层的 original）
        if desc and any(v and v in desc for v in collected_values):
            continue
        value_for_prompt = _element_value_for_prompt(desc, el.get("description_en"))
        if not value_for_prompt:
            continue
        if _is_abstract_dimension(slot, desc):
            continue
        # 防线①-c：词级重叠判重——措辞不同但说的是同一元素（如"尾巴造型"vs"人鱼尾巴"），
        # 子串匹配挡不住，必须比实词重叠率
        if _is_semantic_duplicate(value_for_prompt, [i["value_for_prompt"] for i in items]):
            continue
        # 防线①-d：中文维度名判重——第2层的"主体宠物肖像区"与第3层的"宠物类型"
        # 是同一个位置，但英文措辞（构图描述 vs 品种名）实词交集为空，①-c 挡不住。
        # 这类漏判的后果比多抠一张更严重：第2层项没有 alternatives，会在界面上
        # 多出一个"只有 1 个候选"的重复维度，干扰用户勾选。
        if _cn_name_overlaps(slot, [i["name_cn"] for i in items]):
            continue
        items.append({
            "element_key": f"L2::{slot or value_for_prompt[:20]}",
            "name_cn": slot or desc[:20],
            "value_cn": desc,
            "value_for_prompt": value_for_prompt,
            "position": (el.get("position") or "").strip(),
            "is_text_slot": _looks_like_text_slot(slot, desc, el.get("is_text_slot")),
            "_raw": el,     # 第2层元素没有 alternatives，variants 只会有原始项
        })

    # ── 3. 去重防线②：全列表按 value_for_prompt 保序去重 ──
    seen = set()
    deduped = []  # type: List[dict]
    for i in items:
        key = i["value_for_prompt"]
        if key in seen:
            continue
        seen.add(key)
        deduped.append(i)

    # ── 4. 只保留图形元素，剔除全部文字类（2026-08-17 用户确认的口径）──
    # 用户要的是"图中的构建元素"——猫/花卉/彩虹/云朵/边框/图标这些看得见的图形。
    # 文字类（名字 Luna、年份 2011-2026、纪念文案，以及"名字文字区"这类描述位）
    # 抠出来只是一段字，没有素材价值，且抠字极易糊，所以直接不进清单。
    # 仍然保留 is_text_slot 字段的解析（上面 _looks_like_text_slot），因为它就是这里
    # 的过滤依据——旧规则卡没有该字段，全靠关键词兜底才能认出文字位。
    deduped = [i for i in deduped if not i["is_text_slot"]]

    # ── 5. 生成抠取指令 ──
    # 模板需要两个填充：目标元素 + **要擦掉的其余元素点名清单**。
    # 为什么要点名：只写 "Erase every other element" 时模型不敢删主体——实测抠
    # "彩虹拱门"时花卉/文字/云朵都擦干净了、猫却完整留着（用户实测反馈）。
    # 排除清单要用**全部**元素（含被上面过滤掉的文字位），因为文字也得擦；
    # 所以这里从 all_names 里排掉当前目标，而不是从 deduped 里排。
    all_labels = []
    for dim, item in replaceable.items():
        if isinstance(item, dict):
            label = _element_value_for_prompt(item.get("original", ""), item.get("original_en"))
            if label:
                all_labels.append(label)
    for el in must_have:
        if isinstance(el, dict):
            label = _element_value_for_prompt(
                el.get("description", ""), el.get("description_en")
            )
            if label:
                all_labels.append(label)

    for i in deduped:
        # 目标元素也用短标签：完整长句会在模板里重复三次（keep ONLY / must stay /
        # must contain），冗长反而稀释指令强度
        target = _shorten_label(i["value_for_prompt"], max_words=10)
        # 排掉目标自己，以及与目标高度重叠的表述（同一元素的另一种措辞——
        # 复用词级重叠判重，否则会出现"擦掉 X"与"保留 X"自相矛盾的指令）
        others = []
        seen_o = set()
        for label in all_labels:
            if label == target or label in seen_o:
                continue
            if _is_semantic_duplicate(label, [target]):
                continue
            seen_o.add(label)
            others.append(_shorten_label(label))
        # 兜底：万一算不出其余元素（单元素规则卡），退回泛化表述
        others_text = "; ".join(others) if others else "every other object and decoration"
        i["extraction_prompt"] = ELEMENT_EXTRACTION_PROMPT_TEMPLATE.format(
            element=target, others=others_text
        )
        # 2026-08-17 用户澄清：真正要的是"这个维度下拉框里的**每个候选变体**都出一张"，
        # 所以每个元素带一份 variants 清单——第 0 项是原始值（走擦除指令，图里本来就有），
        # 其余是 alternatives（走替换指令，图里没有需要换出来）。
        i["variants"] = _build_element_variants(i, others_text)

    return deduped


def _build_element_variants(item: dict, others_text: str) -> List[dict]:
    """为一个元素构造"候选变体"清单：原始值 + 各 alternatives，每项自带生成指令。

    参数:
        item: extract_element_list 收集到的元素条目（需含 _raw 原始层数据）
        others_text: 该元素对应的"要擦掉的其余元素"点名清单（与擦除指令共用）

    返回:
        List[dict]，每项 {variant_key, label_cn, label_for_prompt, is_original, prompt}
        —— 原始项 is_original=True 用擦除指令，其余用替换指令。
    """
    raw = item.get("_raw") or {}
    target = item["value_for_prompt"]
    # element_role：告诉模型"要换的是画面里的哪个角色位"，用元素的短标签
    element_role = _shorten_label(target, max_words=8)
    # pose_clause：姿态/构图约束。只有当规则卡对该元素有**成句的形态描述**时才加——
    # 第3层的 value_cn 常常就是个短标签（"金毛犬"），拿它当姿态说明毫无信息量，
    # 反而占位、还可能把中文标签重复一遍。所以要求：有英文描述、且明显长于标签。
    desc_en = raw.get("description_en") or ""
    pose_clause = ""
    if isinstance(desc_en, str) and len(desc_en.split()) >= 4:
        pose = _shorten_label(desc_en, max_words=14)
        if pose and pose.lower() != element_role.lower():
            pose_clause = f" (keep the same pose and composition: {pose})"

    variants = [{
        "variant_key": f"{item['element_key']}::original",
        "label_cn": item.get("value_cn") or target,
        "label_for_prompt": target,
        "is_original": True,
        "prompt": item["extraction_prompt"],
    }]

    alts = raw.get("alternatives") or []
    alts_en = raw.get("alternatives_en") or []
    for idx, alt in enumerate(alts):
        if not isinstance(alt, str) or not alt.strip():
            continue
        alt_cn = alt.strip()
        # 英文优先（索引对齐 alternatives_en），取不到放行中文
        alt_en = ""
        if idx < len(alts_en) and isinstance(alts_en[idx], str):
            alt_en = alts_en[idx].strip()
        label_for_prompt = alt_en or alt_cn
        variants.append({
            "variant_key": f"{item['element_key']}::alt{idx}",
            "label_cn": alt_cn,
            "label_for_prompt": label_for_prompt,
            "is_original": False,
            "prompt": ELEMENT_VARIANT_PROMPT_TEMPLATE.format(
                element_role=element_role,
                variant=label_for_prompt,
                pose_clause=pose_clause,
                others=others_text,
            ),
        })
    return variants


def _shorten_label(label: str, max_words: int = 8) -> str:
    """把长描述截短成"点名用"的短语。

    第2层的描述常是整句（"A semicircular rainbow behind the pet's head, creating a
    sense of protection and embrace."），整句塞进排除清单会让 prompt 冗长且互相干扰；
    取前几个词足够让模型认出是哪个元素。按逗号先断句，再限词数。
    """
    text = (label or "").strip().rstrip(".")
    if "," in text:
        text = text.split(",")[0].strip()
    words = text.split()
    if len(words) > max_words:
        text = " ".join(words[:max_words])
    return text

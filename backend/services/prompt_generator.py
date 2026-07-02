"""
提示词生成服务
核心功能：基于规则卡 + 用户选择的替换方案 + 目标产品，生成提示词。
支持三个版本：
- 版本 B：AI 推荐风格版（随机/AI 推荐改款方向）
- 版本 C 模板：生成可交互的下拉框选项结构
- 版本 C 生成：根据用户选择组装最终提示词
"""

import json
from typing import List, Optional

from prompts.prompt_generation import get_recommendation_prompt
from services.ai_response_utils import extract_json_from_ai_response
from services.vocab_utils import extract_english_part


# 通用负向提示词（生图时需要排除的内容）
# 注意：不排除 text/letters/words，因为 POD 产品需要 AI 画上示例文字
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
    ) -> dict:
        """版本 B：AI 推荐风格版

        如果有 ai_client，调用 AI 推荐最佳改款方向；
        否则使用"随机推荐"模式（从 alternatives 中选第一个替代方案）。

        参数:
            rule_card: 规则卡字典（RuleCard.model_dump() 的结果）
            target_product: 目标产品类型（如 "毛毯"、"抱枕"）
            library_recommendations: 可选，自有图库推荐的参考图列表

        返回:
            包含锁定核心、推荐改动、提示词等的完整结果字典
        """
        # 提取核心数据
        layer_0 = rule_card.get("layer_0_core", {})
        layer_2 = rule_card.get("layer_2_visual", {})
        layer_3 = rule_card.get("layer_3_variable", {})
        layer_4 = rule_card.get("layer_4_product", {})

        locked_core = layer_0.get("core_selling_point", "")

        # 根据是否有 AI 客户端，选择推荐方式
        if self.ai_client:
            # AI 推荐模式
            recommended = await self._ai_recommend(rule_card, target_product)
        else:
            # 随机推荐模式：从 alternatives 取第一个
            recommended = self._random_recommend(layer_3, target_product)

        recommended_changes = recommended.get("recommended_changes", {})
        reason = recommended.get("reason", "随机选取替代方案")

        # 获取产品适配规则
        adaptation = self._get_adaptation(layer_4, target_product)

        # 组装中文结构化提示词
        structured_prompt_cn = self._build_structured_prompt_cn(
            layer_0, layer_2, layer_3, recommended_changes, adaptation, target_product,
            library_recommendations=library_recommendations,
        )

        # 组装英文生图提示词
        image_prompt_positive, image_prompt_negative = self._build_image_prompts(
            rule_card, layer_0, layer_2, layer_3, recommended_changes, recommended, adaptation,
            library_recommendations=library_recommendations,
        )

        # 生成改款说明
        change_summary = self._build_change_summary(layer_3, recommended_changes, locked_core)

        return {
            "locked_core": locked_core,
            "recommended_changes": recommended_changes,
            "reason": reason,
            "structured_prompt_cn": structured_prompt_cn,
            "image_prompt_positive": image_prompt_positive,
            "image_prompt_negative": image_prompt_negative,
            "change_summary": change_summary,
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
            for s in (img.get('styles') or []):
                eng = self._extract_english(s)
                if eng and eng not in ref_visual_style:
                    ref_visual_style.append(eng)
            for c in (img.get('color_moods') or []):
                eng = self._extract_english(c)
                if eng and eng not in ref_color_palette:
                    ref_color_palette.append(eng)
            layout = img.get('layout_type', '')
            if layout:
                eng = self._extract_english(layout)
                if eng and eng not in ref_composition:
                    ref_composition.append(eng)
            for e in (img.get('elements') or []):
                if e and e not in ref_elements:
                    ref_elements.append(e)

        # 3. 获取产品适配规则
        adaptation = self._get_adaptation(layer4, target_product)

        # 4. 构建英文正向提示词——结构化融合参考图特征
        prompt_parts = []  # type: List[str]

        # 核心构图（从规则卡）
        layout_formula = layer2.get("layout_formula", "")
        if layout_formula:
            prompt_parts.append(layout_formula)

        # 参考图风格融合
        if ref_visual_style:
            prompt_parts.append("{} style".format(', '.join(ref_visual_style)))
        else:
            fallback_style = self._extract_english(layer2.get("style", ""))
            if fallback_style:
                prompt_parts.append(fallback_style)

        # 参考图色彩融合
        if ref_color_palette:
            prompt_parts.append("{} color palette".format(', '.join(ref_color_palette)))
        else:
            fallback_color = self._extract_english(layer2.get("color_mood", ""))
            if fallback_color:
                prompt_parts.append(fallback_color)

        # 参考图构图融合
        if ref_composition:
            prompt_parts.append("composition: {}".format(', '.join(ref_composition)))

        # 参考图元素（作为参考提示，不是必须画的）
        if ref_elements:
            prompt_parts.append(
                "design elements reference: {}".format(', '.join(ref_elements[:5]))
            )

        # 产品适配
        ratio = adaptation.get("canvas_ratio", "")
        adapt_notes = adaptation.get("adaptation_notes", "")
        if ratio:
            prompt_parts.append("aspect ratio {}".format(ratio))
        if adapt_notes:
            prompt_parts.append(adapt_notes)

        # POD 定制要素
        pod_hints = self._get_pod_hints(rule_card)
        prompt_parts.extend(pod_hints)

        # 通用质量
        prompt_parts.extend(["high quality", "detailed", "professional design"])

        positive = ", ".join([p for p in prompt_parts if p])

        # 5. 构建负向提示词
        negative_parts = list(COMMON_NEGATIVE_PROMPTS)
        # POD 印刷质量排除项
        pod_negative = [
            "watermark", "signature", "low resolution",
            "blurry edges", "unprintable artifacts",
        ]
        for neg in pod_negative:
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

        return {
            "locked_core": locked_core,
            "structured_prompt_cn": structured_cn,
            "image_prompt_positive": positive,
            "image_prompt_negative": negative,
            "change_summary": change_summary,
            "reference_images_used": [
                img.get('image_id', '') for img in reference_images
            ],
        }

    # ==================== 版本 C：自定义模板版 ====================

    def generate_version_c_template(self, rule_card: dict) -> dict:
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
            library_recommendations=library_recommendations,
        )

        # 生成改款说明
        change_summary = self._build_change_summary(layer_3, recommended_changes, locked_core)

        return {
            "locked_core": locked_core,
            "recommended_changes": recommended_changes,
            "reason": "用户自定义选择",
            "structured_prompt_cn": structured_prompt_cn,
            "image_prompt_positive": image_prompt_positive,
            "image_prompt_negative": image_prompt_negative,
            "change_summary": change_summary,
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
                        extracted_texts[dim_name] = original

            # 从 must_have_elements 里标记了 is_text_slot=True 的项取描述
            for elem in must_have:
                if not isinstance(elem, dict) or not elem.get("is_text_slot"):
                    continue
                slot = elem.get("slot", "")
                desc = elem.get("description", "")
                if slot in extracted_texts:
                    continue
                # 如果 desc 是具体英文文案（包含英文字母且不太长），直接用
                has_english = any(c.isalpha() and ord(c) < 128 for c in desc)
                if has_english and len(desc) < 80:
                    extracted_texts[slot] = desc
                elif "名字" in slot.lower() or "name" in slot.lower():
                    extracted_texts[slot] = "NAME"
                elif "日期" in slot.lower() or "date" in slot.lower():
                    extracted_texts[slot] = "2026"
                elif desc:
                    extracted_texts[slot] = desc[:50] if len(desc) < 50 else "NAME"
        else:
            # ── 兜底路径：关键词字符串匹配（兼容没有 is_text_slot 字段的旧规则卡）──
            text_keywords = ['标题', '文案', '名字', '名称', '短句', '日期',
                             'title', 'text', 'name', 'slogan', 'date']

            # 从可替换元素中提取（这里的 original 是竞品图上的真实文案）
            for dim_name, item in replaceable.items():
                if any(kw in dim_name.lower() for kw in text_keywords):
                    original = item.get("original", "") if isinstance(item, dict) else str(item)
                    if original and len(original) < 100:  # 排除过长的描述
                        extracted_texts[dim_name] = original

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
                        # 如果 desc 是具体英文文案（包含英文字母且不太长），直接用
                        has_english = any(c.isalpha() and ord(c) < 128 for c in desc)
                        if has_english and len(desc) < 80:
                            extracted_texts[slot] = desc
                        elif "名字" in slot_lower or "name" in slot_lower:
                            extracted_texts[slot] = "NAME"
                        elif "日期" in slot_lower or "date" in slot_lower:
                            extracted_texts[slot] = "2026"

        # ── 生成 POD 定制提示词（这部分逻辑不变） ──
        hints = []  # type: List[str]

        if extracted_texts:
            # 有具体文字，用识别到的真实文案作示例
            text_parts = []
            for slot, text in extracted_texts.items():
                text_parts.append(f"'{text}'")
            hints.append(
                f"include personalized text elements in the design: {', '.join(text_parts)}, "
                "positioned naturally as part of the layout for print-on-demand customization"
            )
        else:
            # 没有识别到具体文字，通用提示
            hints.append(
                "design should be suitable for print-on-demand personalization, "
                "include sample text 'NAME' in the design, positioned naturally as part of the layout"
            )

        # 通用 POD 质量要求
        hints.extend([
            "clean printable design",
            "high resolution suitable for fabric/product printing",
            "no watermark no signature",
        ])

        return hints

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

        try:
            # 调用 AI（纯文本请求，不需要图片）
            response = await self.ai_client.text_request(system_prompt, user_prompt)
            result = extract_json_from_ai_response(response)

            # 校验返回结构
            if "recommended_changes" in result:
                return result
            else:
                # AI 返回格式异常，降级为随机推荐
                layer_3 = rule_card.get("layer_3_variable", {})
                fallback = self._random_recommend(layer_3, target_product)
                fallback["reason"] = f"AI 返回格式异常，已降级为随机推荐。原始响应：{response[:200]}"
                return fallback
        except Exception as e:
            # AI 调用失败，降级为随机推荐
            layer_3 = rule_card.get("layer_3_variable", {})
            fallback = self._random_recommend(layer_3, target_product)
            fallback["reason"] = f"AI 调用失败（{str(e)}），已降级为随机推荐"
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
            chosen = changes.get(field_name, original)
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
        library_recommendations: Optional[List[dict]] = None,
    ) -> tuple:
        """组装英文生图提示词（正向 + 负向）

        参数:
            rule_card: 完整规则卡字典（供 _get_pod_hints 提取真实定制文案）
            layer_0: 第0层核心卖点
            layer_2: 第2层视觉结构
            layer_3: 第3层可变边界
            changes: 替换方案
            recommended: AI 推荐结果（含 style_description 等辅助描述）
            adaptation: 产品适配规则
            library_recommendations: 可选，自有图库推荐的参考图列表

        返回:
            (positive_prompt, negative_prompt) 二元组
        """
        positive_parts = []

        # 1. 从第2层取构图描述和风格
        style = layer_2.get("style", "")
        color_mood = layer_2.get("color_mood", "")
        layout = layer_2.get("layout_formula", "")

        # 如果 AI 推荐提供了英文描述，优先使用
        ai_style = recommended.get("style_description", "")
        ai_color = recommended.get("color_description", "")
        ai_layout = recommended.get("layout_description", "")

        # 提取英文部分（词表格式为 "中文/English"）
        style_en = ai_style if ai_style else self._extract_english(style)
        color_en = ai_color if ai_color else self._extract_english(color_mood)
        layout_en = ai_layout if ai_layout else layout

        # 2. 构图和风格
        if layout_en:
            positive_parts.append(layout_en)
        if style_en:
            positive_parts.append(style_en)
        if color_en:
            positive_parts.append(f"{color_en} color palette")

        # 3. 核心卖点描述
        core = layer_0.get("core_selling_point", "")
        core_en = self._extract_english(core)
        if core_en:
            positive_parts.append(core_en)

        # 4. 从选中的替换方案取具体元素描述
        replaceable = layer_3.get("replaceable_elements", {})
        for field_name, item in replaceable.items():
            original = item.get("original", "")
            chosen = changes.get(field_name, original)
            chosen_en = self._extract_english(chosen)
            if chosen_en:
                positive_parts.append(chosen_en)

        # 5. 必备元素
        must_have = layer_2.get("must_have_elements", [])
        for elem in must_have:
            desc = elem.get("description", "")
            desc_en = self._extract_english(desc)
            if desc_en:
                positive_parts.append(desc_en)

        # 6. 产品适配：画布比例
        canvas_ratio = adaptation.get("canvas_ratio", "")
        if canvas_ratio:
            positive_parts.append(f"aspect ratio {canvas_ratio}")

        # 7. 自有图库参考：加入参考图的风格和元素描述
        if library_recommendations:
            ref_elements = []
            for ref in library_recommendations:
                # 提取参考图的风格英文部分
                for s in ref.get("styles", []):
                    style_en = self._extract_english(s)
                    if style_en and style_en not in ref_elements:
                        ref_elements.append(style_en)
                # 提取参考图的关键元素
                for elem in ref.get("elements", []):
                    elem_en = self._extract_english(elem)
                    if elem_en and elem_en not in ref_elements:
                        ref_elements.append(elem_en)
            if ref_elements:
                positive_parts.append("reference style: " + ", ".join(ref_elements[:5]))

        # 8. 通用质量词
        positive_parts.extend(["high quality", "detailed", "professional design"])

        # 9. POD 定制要素——从规则卡提取竞品图上的实际文案作示例
        pod_customization_hints = self._get_pod_hints(rule_card)
        positive_parts.extend(pod_customization_hints)

        positive_prompt = ", ".join(positive_parts)

        # ---- 负向提示词 ----
        negative_parts = list(COMMON_NEGATIVE_PROMPTS)

        # 从 must_not_change 推导排除项
        must_not = layer_3.get("must_not_change", [])
        # must_not_change 列表本身不应出现在 negative 中（它是要保留的），
        # 但其"反面"应该被排除——即原始元素被替换掉的部分
        for field_name, item in replaceable.items():
            original = item.get("original", "")
            chosen = changes.get(field_name, original)
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
        pod_negative_additions = [
            "watermark", "signature", "low resolution",
            "blurry edges", "unprintable artifacts",
        ]
        for neg in pod_negative_additions:
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
            chosen = changes.get(field_name, original)
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

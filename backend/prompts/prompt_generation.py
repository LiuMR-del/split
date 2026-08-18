"""
提示词生成相关的 prompt 模板
- 用于调用 AI 推荐改款方向
"""


def get_recommendation_prompt(
    rule_card_json: str,
    target_product: str,
    num_directions: int = 1,
) -> str:
    """生成让 AI 推荐改款方向的系统提示词

    参数:
        rule_card_json: 规则卡的 JSON 字符串
        target_product: 目标产品类型（如 "毛毯"、"抱枕" 等）
        num_directions: 推荐几套方案。1（默认）= 原有单套路径，文本与改造前**完全一致**
                        （零回归）；>1 走多方案分支，要求各套之间明显差异化。

    返回:
        完整的系统提示词字符串
    """
    if num_directions > 1:
        return _get_multi_recommendation_prompt(
            rule_card_json, target_product, num_directions
        )
    return f"""你是一个资深的电商产品设计顾问，专精 POD（按需印刷）产品的图案改款。

基于以下规则卡，为"{target_product}"产品推荐一个改款方向。

规则卡内容：
{rule_card_json}

要求：
1. 核心卖点（第0层）绝对不能改动，它是这个图案卖得好的根本原因
2. 只从第3层"可替换元素"中选择替换方案，不要凭空发明新元素
3. 应用第4层中对应产品的适配规则（画布比例、简化/增强项）
4. 给出推荐理由，解释为什么这个改款方向能保持卖点的同时带来差异化
5. 生成的风格描述、色彩描述、构图描述要足够具体，可以直接用于 AI 生图
6. 判断这张图（规则卡对应的竞品图）有哪些可定制项，优先从"名字/姓名、年龄/生日/日期、团队/队伍、家族/姓氏"这几类出发（POD 最常见的定制项），其他次之，总数控制在 5 项以内。每项给出名称、位置（必须与图中该元素的实际设计位置适搭，如名字在顶部居中、日期在底部）、描述、是否文字位、以及可直接拼入生图提示词的英文片段

请严格按以下 JSON 格式输出：
{{
    "recommended_changes": {{
        "维度名1": "选择的替代方案",
        "维度名2": "选择的替代方案"
    }},
    "reason": "推荐理由（一段话，解释改款思路）",
    "style_description": "改款后的整体风格描述（英文，用于生图提示词）",
    "color_description": "改款后的色彩方案描述（英文，用于生图提示词）",
    "layout_description": "构图描述（英文，用于生图提示词）",
    "negative_elements": ["需要排除的元素1", "需要排除的元素2"],
    "customization_slots": [
        {{
            "slot_name": "[可定制项名称-中文，如：姓名/日期/标题文字/装饰图案位]",
            "position": "[该定制项在画面中的位置-中文，如：顶部居中/底部]",
            "description": "[该定制项的描述-中文]",
            "is_text_slot": "[布尔值：true 或 false，true=文字定制位，false=图案元素定制位]",
            "prompt_fragment": "[英文片段：描述该定制项、可直接拼入正向生图提示词，必须用英文]"
        }}
    ]
}}
"""


def _get_multi_recommendation_prompt(
    rule_card_json: str,
    target_product: str,
    num_directions: int,
) -> str:
    """三期阶段三：一次调用推荐多套**差异化**改款方案的系统提示词。

    与单套版的差别只有两点：① 要求输出 num_directions 套且彼此明显差异化；
    ② customization_slots 与具体方案无关，在顶层只输出一份（不在每套里重复）。
    其余 6 条要求逐条保留，保证单套/多套产出的字段语义一致。

    ⚠️ JSON 输出示例里所有可变字段一律用方括号占位符描述"填什么、怎么判断"，
    绝不给看起来像正确答案的具体值（CLAUDE.md 铁律：示例具体值会被 AI 模式匹配抄写）。
    """
    return f"""你是一个资深的电商产品设计顾问，专精 POD（按需印刷）产品的图案改款。

基于以下规则卡，为"{target_product}"产品推荐 {num_directions} 套**彼此明显不同**的改款方向。

规则卡内容：
{rule_card_json}

要求：
1. 核心卖点（第0层）绝对不能改动，它是这个图案卖得好的根本原因
2. 只从第3层"可替换元素"中选择替换方案，不要凭空发明新元素
3. 应用第4层中对应产品的适配规则（画布比例、简化/增强项）
4. 每套方案都要给出推荐理由，解释为什么这个方向能保持卖点的同时带来差异化
5. 每套方案的风格描述、色彩描述、构图描述都要足够具体，可以直接用于 AI 生图
6. 判断这张图（规则卡对应的竞品图）有哪些可定制项，优先从"名字/姓名、年龄/生日/日期、团队/队伍、家族/姓氏"这几类出发（POD 最常见的定制项），其他次之，总数控制在 5 项以内。每项给出名称、位置（必须与图中该元素的实际设计位置适搭，如名字在顶部居中、日期在底部）、描述、是否文字位、以及可直接拼入生图提示词的英文片段
7. **{num_directions} 套方案之间必须明显差异化**：体现在选择了不同的替换元素组合、走不同的风格/色彩/氛围路线。不允许多套方案只是在同一个维度上换近义词（例如都改"配色"却只是深蓝换浅蓝），也不允许多套方案的 recommended_changes 高度雷同。每套方案应有自己的主攻方向。
8. customization_slots 描述的是这张图本身适合哪些定制项，**与选择哪套改款方案无关**，所以只在 JSON 顶层输出一份，不要在每套方案里重复

请严格按以下 JSON 格式输出（recommendations 数组必须有 {num_directions} 个元素）：
{{
    "recommendations": [
        {{
            "recommended_changes": {{
                "[第3层里的某个可替换维度名]": "[从该维度 alternatives 里选择的替代方案]",
                "[第3层里的另一个可替换维度名]": "[从该维度 alternatives 里选择的替代方案]"
            }},
            "reason": "[这套方案的推荐理由-中文，说明它的主攻方向以及与其他几套的差异化思路]",
            "style_description": "[这套方案改款后的整体风格描述，必须用英文，用于生图提示词]",
            "color_description": "[这套方案改款后的色彩方案描述，必须用英文，用于生图提示词]",
            "layout_description": "[这套方案的构图描述，必须用英文，用于生图提示词]",
            "negative_elements": ["[这套方案需要排除的元素]"]
        }}
    ],
    "customization_slots": [
        {{
            "slot_name": "[可定制项名称-中文，如：姓名/日期/标题文字/装饰图案位]",
            "position": "[该定制项在画面中的位置-中文，如：顶部居中/底部]",
            "description": "[该定制项的描述-中文]",
            "is_text_slot": "[布尔值：true 或 false，true=文字定制位，false=图案元素定制位]",
            "prompt_fragment": "[英文片段：描述该定制项、可直接拼入正向生图提示词，必须用英文]"
        }}
    ]
}}
"""


def get_customization_analysis_prompt(rule_card_json: str) -> str:
    """生成让 AI 判断可定制项的系统提示词（版本A/C 用，不推荐改款，只判断定制项）。

    AI 基于规则卡（VLM 分析竞品图得出的结构化数据）判断这张图适合哪些可定制项，
    而非一股脑全加--只判断真正适配的，位置与图中现有设计适搭。
    """
    return f"""你是一个 POD（按需印刷）定制产品设计专家。

基于以下规则卡（VLM 分析竞品图得出的结构化数据），判断这张图适合添加哪些可定制项。

规则卡内容：
{rule_card_json}

要求：
1. 可定制项是买家可以自定义的内容（如名字、年龄/生日、团队、家族/姓氏等文字，或某些图案元素位）
2. 优先从"名字/姓名、年龄/生日/日期、团队/队伍、家族/姓氏"这几类出发（POD 最常见）
3. 只判断真正适配这张图设计的定制项，不要一股脑全加--位置必须与图中现有设计适搭（如名字放顶部居中、日期放底部）
4. 每项给出名称、位置、描述、是否文字位、英文片段
5. 总数控制在 5 项以内

请严格按以下 JSON 格式输出：
{{
    "customization_slots": [
        {{
            "slot_name": "[可定制项名称-中文]",
            "position": "[位置-中文，与图设计适搭]",
            "description": "[描述-中文]",
            "is_text_slot": "[布尔值：true 或 false]",
            "prompt_fragment": "[英文片段，可直接拼入生图提示词]"
        }}
    ]
}}
"""


def get_option_translation_prompt(terms_json: str) -> str:
    """生成让 AI 批量翻译英文词条的系统提示词（版本C 下拉框选项用）。

    这些词条是 VLM 分析竞品图时对某个可替换维度自由生成的英文值（如犬种名称、
    装饰图案组合），不是受控词表里的固定选项，没有现成的中英对照表可查，只能
    临时调 AI 翻译。翻译结果只用于前端下拉框选项旁边的小字提示，不进最终生图
    提示词，翻译错一两个词不影响生成结果，容错空间大。
    """
    return f"""你是一个翻译助手，负责把一批英文词条翻译成简体中文。

待翻译词条（JSON 数组）：
{terms_json}

要求：
1. 逐条翻译，保持原数组顺序，输出数组长度必须与输入一致
2. 每条只给最常用、最简短的中文翻译（如"Dachshund"翻译成"腊肠犬"，不要写成长句解释）
3. 词条如果是专有名词/品牌名等无法直译的，保留原词或给出通用译法，不要空着

请严格按以下 JSON 格式输出，不要添加 markdown 代码块标记或其他说明文字：
{{
    "translations": ["[第1条词条的中文翻译]", "[第2条词条的中文翻译]"]
}}
"""



# ==================== 元素拆分图（三期阶段四） ====================

# 元素抠取指令模板（2026-08-17 第二版：原位擦除式）。
#
# 这不是给 VLM 的分析 prompt，而是**给生图模型 + 竞品原图**的编辑式指令
# （走 /v1/images/edits，参考图就是竞品原图），所以 {element} 允许中文——
# 中文只是给模型定位"图里的哪个东西"，不是要求它画出中文字（同批次四
# _edit_lang_value 的语言策略，CLAUDE.md 铁律 §2-10）。
#
# ⚠️ 第一版写的是 "Place it alone, centered, on a plain pure white background"，
# **主动要求了重新居中**，导致抠出来的元素位置/比例与原图完全不对（用户实测反馈）。
# 第二版核心改动：把任务从"提取并放置"改写成"**擦掉其他所有东西**"
# （erase-everything-else, NOT a re-draw），并显式锁定位置/尺寸/画布比例。
# 实测（RULE-0026 彩虹拱门）：输出 1086×1448 = 原图尺寸，元素落在
# x 0.07~0.92 / y 0.27~0.60，与原图彩虹实际位置（x 0.06~0.94 / y 0.32~0.56）吻合。
#
# 各段的由来（每段都是实测出来的，删任何一段都会退化，改前请重跑 Spike）：
# 1. 原位擦除 + 锁定位置：见上，第一版最大的错。
# 2. 白底而非透明底：**透明底与"保持原位置"实测不可兼得**——要求保持原画布时
#    上游忽略 background=transparent 返回原尺寸 RGB 白底（size 取 1024x1024 和
#    1024x1536 都一样，已排除 size 是变量）。所以这里出白底，落盘时再用
#    services/image_alpha_utils.white_to_transparent() 转成真透明（实测白边残留 0%）。
# 3. 风格锁定：只写 "Reproduce it exactly as it appears" 时海龟/珊瑚被画成照片级
#    写实、丢手绘笔触——该句对"画什么"约束够、对"怎么画"不足。
# 4. 消除 mockup 干扰：竞品图常是装裱画布/实物摆拍的 mockup（带画框、画布纹理），
#    模型会当实物语境更偏写实；告知"这是平面 2D 印刷图案"后再降一档。
# 5. **显式点名要擦掉的元素（{others}）**：只写 "Erase every other element" 时模型
#    不敢删主体——实测抠"彩虹拱门"，花卉/文字/云朵都擦干净了，**猫却完整留着**
#    （用户实测反馈）。因为主体在画面里太显著，泛化的"其他元素"不足以让模型动它。
#    改成从规则卡列出其余元素名逐个点名 + 明说"如果主体在清单里就必须擦掉"后解决。
#    清单由 extract_element_list 在生成 extraction_prompt 时按"同卡其余元素"填充。
# 6. **画布比例锚定"印刷图案区域"而不是"整张图"**（2026-08-18）：竞品图常是实物
#    摆拍——RULE-0063 是 2000×2000 方形照片，拍的却是户外灯笼，真正的印刷图案是
#    面板上约 1:2.2 的窄竖条，四周全是灯具外壳和草地虚化背景。旧措辞
#    "same aspect ratio and framing as the provided image" 会让模型对齐**整张照片**，
#    且与后端按 `artwork_orientation` 校正后的竖版画布请求**直接矛盾**（一句要方、
#    一句要竖，模型只能二选一）。改为显式锚定 "the printed artwork area ... not the
#    whole photograph"，与第 4 段的"忽略画框/实物语境"同向加强。
#    两个模板都改，配套后端 routers/prompts.py 的 `_apply_orientation`。
ELEMENT_EXTRACTION_PROMPT_TEMPLATE = (
    "From the provided image, keep ONLY {element} and delete everything else. "
    "This is an erase-everything-else task, NOT a re-draw task: "
    "{element} must stay at EXACTLY the same position, same size, same scale and same "
    "orientation as in the provided image — do not move it, do not resize it, "
    "do not re-center it, do not crop it. "
    "Keep the output canvas the same aspect ratio and framing as the printed artwork area "
    "of the provided image (if the image is a product photo, this is the artwork panel only, "
    "not the whole photograph). "
    "You MUST erase these — {others} — plus all text, all lettering, all numbers and the "
    "original background. Erasing the main subject is REQUIRED if it is listed above: "
    "the output must contain {element} and nothing else. "
    "Leave every erased area plain pure white. "
    "Preserve the exact same artistic style as the original — hand-painted illustration look, "
    "same brush strokes, flat shading and colors. Do NOT render it photorealistic or 3D. "
    "The provided image is a flat 2D printed artwork; treat it as digital illustration, "
    "ignore any frame, canvas texture, or physical product context."
)


# 元素**变体**替换指令模板（2026-08-17 用户澄清后新增）。
#
# 与 ELEMENT_EXTRACTION_PROMPT_TEMPLATE 的区别：那个是"把原图里已有的元素抠出来"，
# 这个是"把该位置的元素**换成规则卡里的某个候选变体**再抠出来"——变体（如把金毛犬
# 换成猫咪）在原图里并不存在，所以任务从"擦除"变成"替换 + 擦除其余"。
#
# 用途：一个可变维度（如"宠物类型"）下有 original + alternatives 共 N 个候选，
# 逐个生成 N 张同位置、同姿态、同风格的透明底素材，用户拿去叠换即得 N 个变体设计。
#
# 关键约束及其由来（实测 RULE-0063 把金毛犬换成猫咪）：
# 1. `REPLACE ... with {variant}` + 明确"必须占据完全相同的位置/尺寸/取景/姿态"——
#    只说"换成猫"模型会重新构图，姿态和位置都跟原来对不上，一组变体之间就不通用了。
# 2. 保留姿态描述（{pose}，来自规则卡对该元素的描述）：实测输出的猫保持了
#    "正面半身像 + 微笑张嘴"，与原图金毛一致，叠换时才不突兀。
# 3. 风格锁定改为"与原图中该元素的渲染风格一致"（而非泛化的手绘插画）——
#    变体要和原设计里其他元素放在一起，风格必须对齐原元素而不是对齐某种画风。
# 4. 排除清单 {others} 同擦除模板：只写"擦掉其他"模型不敢删主体（实测踩过）。
# 5. 出白底，落盘时由 image_alpha_utils.white_to_transparent() 转透明
#    （透明底与保持位置在 API 侧不可兼得，见擦除模板的注释）。
ELEMENT_VARIANT_PROMPT_TEMPLATE = (
    "From the provided image, keep ONLY the {element_role}, but REPLACE it with {variant}. "
    "The replacement must occupy EXACTLY the same position, same size, same scale and same "
    "framing as the original {element_role} in the provided image{pose_clause} — "
    "do not move it, do not resize it, do not re-center it. "
    "Keep the output canvas the same aspect ratio and framing as the printed artwork area "
    "of the provided image (if the image is a product photo, this is the artwork panel only, "
    "not the whole photograph). "
    "You MUST erase these — {others} — plus all text, all lettering, all numbers and the "
    "original background. Erasing them is REQUIRED: "
    "the output must contain only {variant} and nothing else. "
    "Leave every erased area plain pure white. "
    "Match the rendering style of the original {element_role} in the provided image — "
    "same rendering technique, same lighting, same level of detail. "
    "The provided image may be a photo of a printed product; treat the printed artwork as a "
    "flat 2D design and ignore any frame, product hardware, canvas texture or photographic "
    "background around it."
)

"""
提示词生成路由
- POST /api/prompts/generate-b      → 版本B：AI推荐风格版
- GET  /api/prompts/template-c/{id}  → 版本C：获取下拉框选项模板
- POST /api/prompts/generate-c       → 版本C：根据用户选择生成提示词
- GET  /api/prompts/elements/{id}    → 元素拆分：可拆分元素清单 + 抠取指令（三期阶段四）
"""

import logging
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from services.rule_store import get_rule
from services.prompt_generator import PromptGenerator, extract_element_list
from services.ai_client import load_ai_client_from_config
from services.image_library_store import get_image

router = APIRouter()

# 竞品原图目录（元素拆分要读原图尺寸，按原图比例请求生图画布）
RULES_UPLOADS_DIR = Path(__file__).parent.parent / "data" / "uploads"


# ==================== 请求体模型 ====================

class GenerateARequest(BaseModel):
    """版本A生成请求"""
    rule_id: str
    reference_image_ids: List[str]  # 用户选中的参考图 ID 列表
    target_product: str


class GenerateBRequest(BaseModel):
    """版本B生成请求"""
    rule_id: str
    target_product: str
    # 三期阶段三：推荐几套差异化方案。默认 1 = 与改造前完全一致的单套形状；
    # >1 时响应 data 变为 {"directions": [...], "num_directions": N}
    num_directions: int = Field(default=1, ge=1, le=4, description="推荐方案数 1-4")


class GenerateCRequest(BaseModel):
    """版本C生成请求"""
    rule_id: str
    selections: dict
    target_product: str


# ==================== 路由 ====================

@router.post("/prompts/generate-a")
async def generate_version_a(request: GenerateARequest):
    """版本A：资料库关联版

    接收用户选中的参考图 ID，从图库拉取标签，
    结构化融入提示词（不是前端拼文本）。
    """
    # 1. 读取规则卡
    rule = get_rule(request.rule_id)
    if rule is None:
        raise HTTPException(
            status_code=404,
            detail=f"规则卡 {request.rule_id} 不存在",
        )

    # 2. 从图库读取选中的参考图标签
    reference_images = []  # type: List[dict]
    for img_id in request.reference_image_ids:
        img = get_image(img_id)
        if img:
            reference_images.append(img.model_dump())

    if not reference_images:
        raise HTTPException(
            status_code=400,
            detail="未找到任何有效的参考图，请检查 reference_image_ids",
        )

    # 3. 调用 prompt_generator 的版本 A 方法
    ai_client = load_ai_client_from_config()
    generator = PromptGenerator(ai_client=ai_client)
    try:
        result = await generator.generate_version_a(
            rule_card=rule.model_dump(),
            reference_images=reference_images,
            target_product=request.target_product,
        )
    except Exception as e:
        logging.exception("版本A提示词生成失败")  # 诊断：打印完整异常栈到日志
        raise HTTPException(
            status_code=500,
            detail=f"版本A提示词生成失败：{str(e)}",
        )

    return {"success": True, "data": result}


@router.post("/prompts/generate-b")
async def generate_version_b(request: GenerateBRequest):
    """版本B：AI 推荐风格版

    从规则库读取规则卡，调用 AI（或随机模式）推荐改款方向，
    生成中文结构化提示词和英文生图提示词。
    """
    # 读取规则卡
    rule = get_rule(request.rule_id)
    if rule is None:
        raise HTTPException(
            status_code=404,
            detail=f"规则卡 {request.rule_id} 不存在",
        )

    # 加载 AI 客户端（可能为 None）
    ai_client = load_ai_client_from_config()

    # 生成提示词
    generator = PromptGenerator(ai_client=ai_client)
    try:
        result = await generator.generate_version_b(
            rule_card=rule.model_dump(),
            target_product=request.target_product,
            num_directions=request.num_directions,
        )
    except Exception as e:
        logging.exception("提示词生成失败（generate-b/generate-c）")  # 诊断：打印完整异常栈，靠请求路径区分 b/c
        raise HTTPException(
            status_code=500,
            detail=f"提示词生成失败：{str(e)}",
        )

    return {
        "success": True,
        "data": result,
        "ai_mode": "ai_recommend" if ai_client else "random",
    }


@router.get("/prompts/template-c/{rule_id}")
async def get_template_c(rule_id: str):
    """版本C：获取下拉框选项模板

    从规则卡提取可替换维度，生成前端下拉框选项结构。
    """
    # 读取规则卡
    rule = get_rule(rule_id)
    if rule is None:
        raise HTTPException(
            status_code=404,
            detail=f"规则卡 {rule_id} 不存在",
        )

    # 生成模板。#4b：传 ai_client 供纯英文选项加中文小字翻译；未配置 AI 时
    # generate_version_c_template 内部会跳过翻译，不影响模板本身正常返回
    ai_client = load_ai_client_from_config()
    generator = PromptGenerator(ai_client=ai_client)
    template = await generator.generate_version_c_template(rule_card=rule.model_dump())

    return {
        "success": True,
        "data": template,
    }


@router.post("/prompts/generate-c")
async def generate_version_c(request: GenerateCRequest):
    """版本C：根据用户选择生成提示词

    用户通过下拉框选择替换方案后，组装最终的提示词。
    """
    # 读取规则卡
    rule = get_rule(request.rule_id)
    if rule is None:
        raise HTTPException(
            status_code=404,
            detail=f"规则卡 {request.rule_id} 不存在",
        )

    # 生成提示词（R4：传 ai_client，让版本C 也能 AI 分析可定制项）
    ai_client = load_ai_client_from_config()
    generator = PromptGenerator(ai_client=ai_client)
    try:
        result = await generator.generate_from_selections(
            rule_card=rule.model_dump(),
            selections=request.selections,
            target_product=request.target_product,
        )
    except Exception as e:
        logging.exception("提示词生成失败（generate-b/generate-c）")  # 诊断：打印完整异常栈，靠请求路径区分 b/c
        raise HTTPException(
            status_code=500,
            detail=f"提示词生成失败：{str(e)}",
        )

    return {
        "success": True,
        "data": result,
    }


_VALID_ORIENTATIONS = ("portrait", "landscape", "square")


def _get_artwork_orientation(rule) -> Optional[str]:
    """从规则卡第 2 层取 VLM 判断的图案朝向，非法值一律当作没有。

    只接受 portrait/landscape/square 三档（见 prompts/rule_extraction.py 的字段说明）。
    旧规则卡没有这个字段返回 None，调用方回落到文件比例。
    """
    layer2 = getattr(rule, "layer_2_visual", None)
    value = getattr(layer2, "artwork_orientation", None) if layer2 else None
    if isinstance(value, str):
        value = value.strip().lower()
        if value in _VALID_ORIENTATIONS:
            return value
    return None


def _apply_orientation(width: int, height: int, orientation: Optional[str]):
    """按图案朝向校正画布宽高：只重排长短边，不改变具体数值。

    为什么只重排而不用 VLM 给的精确比例：VLM 估精确比例不可靠，而
    `image_gen_client._get_openai_size` 本来只把宽高映射到 1:1 / 3:2 / 2:3
    三个桶，朝向对了就够了。方图文件 + portrait 时没有短边可用（2000×2000
    重排还是 2000×2000），此时按 2:3 构造竖版画布落进正确的桶。
    """
    if not orientation or width <= 0 or height <= 0:
        return width, height

    long_side, short_side = max(width, height), min(width, height)
    if orientation == "square":
        return long_side, long_side
    if long_side == short_side:
        # 方形文件里的竖/横图案：按 2:3 造出该朝向的画布
        short_side = int(round(long_side * 2 / 3))
    if orientation == "portrait":
        return short_side, long_side
    return long_side, short_side


@router.get("/prompts/elements/{rule_id}")
async def get_extractable_elements(rule_id: str):
    """元素拆分图：返回该规则卡可拆分的元素清单 + 每个元素的抠取指令（三期阶段四）。

    纯同步计算（不调 AI、不调生图），只读规则卡做结构化提取与去重。
    `supports_reference` 与"有没有竞品原图"由前端自行判断（前者查 GET /api/gen/config，
    后者看 ruleCard.source_images），这里不重复返回。
    """
    rule = get_rule(rule_id)
    if rule is None:
        raise HTTPException(status_code=404, detail=f"规则卡 {rule_id} 不存在")

    try:
        elements = extract_element_list(rule.model_dump())
    except Exception as e:
        logging.exception("提取可拆分元素清单失败 rule_id=%s", rule_id)
        raise HTTPException(status_code=500, detail=f"提取元素清单失败：{str(e)}")

    # 2026-08-17：连带返回竞品原图的实际宽高，供前端提交生图时按**原图比例**请求画布。
    # 抠取要求"保持原图位置与比例"，如果还按固定 1024×1024 方图请求，竖版竞品图会被
    # 挤成方图、位置自然对不上（用户实测反馈的问题之一）。取不到时返回 0，前端回落方图。
    source_width, source_height = 0, 0
    src_images = rule.source_images or []
    if src_images:
        try:
            from PIL import Image
            src_path = RULES_UPLOADS_DIR / src_images[0]
            if src_path.exists():
                with Image.open(src_path) as im:
                    source_width, source_height = im.size
        except Exception:
            # 读不到尺寸不影响清单本身可用，前端回落方图
            logging.warning("读取竞品原图尺寸失败 rule_id=%s", rule_id, exc_info=True)

    # 2026-08-18：**文件比例 ≠ 图案比例**。竞品图常是实物摆拍——RULE-0063 是
    # 2000×2000 的方形照片，但拍的是户外灯笼，真正的印刷图案是灯笼面板上约 1:2.2 的
    # 窄竖条，四周全是灯具外壳与草地背景。按文件比例请求方形画布，图案必然被挤扁、
    # 位置全错（用户反馈"元素比例应基于图案而非上传图"）。
    #
    # 所以优先用 VLM 判断的 `artwork_orientation`（第 2 层，只有三档粗分类——精确比例
    # VLM 给不准，且 `_get_openai_size` 本来只有 1:1 / 3:2 / 2:3 三个桶，粗分类够用）
    # 校正朝向：朝向与文件不一致时，把文件的长短边按该朝向重排。旧规则卡没有这个字段
    # 时保持原样返回，行为与改动前一致。
    artwork_orientation = _get_artwork_orientation(rule)
    corrected = _apply_orientation(source_width, source_height, artwork_orientation)
    source_width, source_height = corrected

    return {
        "success": True,
        "data": {
            "elements": elements,
            "total": len(elements),
            "source_width": source_width,
            "source_height": source_height,
            "artwork_orientation": artwork_orientation or "",
        },
    }

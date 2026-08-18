"""
提示词生成路由
- POST /api/prompts/generate-b      → 版本B：AI推荐风格版
- GET  /api/prompts/template-c/{id}  → 版本C：获取下拉框选项模板
- POST /api/prompts/generate-c       → 版本C：根据用户选择生成提示词
- GET  /api/prompts/elements/{id}    → 元素拆分：可拆分元素清单 + 抠取指令（三期阶段四）
"""

import logging
from pathlib import Path
from typing import List

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

    return {
        "success": True,
        "data": {
            "elements": elements,
            "total": len(elements),
            "source_width": source_width,
            "source_height": source_height,
        },
    }

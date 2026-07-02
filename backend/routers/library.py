"""
图片库路由 - 自有图库参考池 CRUD + AI 打标 + 推荐

路由列表:
  POST   /api/library/upload          → 上传图片（可批量）+ 可选自动AI打标
  GET    /api/library                  → 列表查询（分页、按标签筛选）
  GET    /api/library/stats            → 图库统计
  GET    /api/library/{image_id}       → 获取单张图片标签
  PUT    /api/library/{image_id}       → 更新标签（人工校对）
  DELETE /api/library/{image_id}       → 删除图片
  POST   /api/library/{image_id}/tag   → 对已上传的图片执行AI打标
  POST   /api/library/recommend        → 基于规则卡推荐相似图片
"""

import shutil
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, File, UploadFile, Form, HTTPException, Query
from pydantic import BaseModel

from models.image_library import ImageTag
from services.ai_client import load_ai_client_from_config
from services.image_tagger import ImageTagger
from services import image_library_store as store

router = APIRouter(prefix="/library", tags=["图片库"])

# 数据目录
DATA_DIR = Path(__file__).parent.parent / "data"


# ==================== 请求体模型 ====================


class UpdateTagRequest(BaseModel):
    """更新标签请求"""
    themes: Optional[List[str]] = None
    styles: Optional[List[str]] = None
    color_moods: Optional[List[str]] = None
    emotions: Optional[List[str]] = None
    target_audiences: Optional[List[str]] = None
    description: Optional[str] = None
    elements: Optional[List[str]] = None
    layout_type: Optional[str] = None
    manually_reviewed: Optional[bool] = None


class RecommendRequest(BaseModel):
    """推荐请求"""
    rule_id: Optional[str] = None
    rule_card: Optional[dict] = None
    limit: int = 5


# ==================== 辅助函数 ====================


def _generate_thumbnail(image_path: str, thumbnail_path: str) -> bool:
    """
    生成缩略图（200x200），使用 Pillow。
    如果 Pillow 未安装则跳过（不阻断上传）。

    返回:
        是否成功生成缩略图
    """
    try:
        from PIL import Image

        img = Image.open(image_path)

        # 保持宽高比缩放到 200x200 区域内
        img.thumbnail((200, 200), Image.LANCZOS)

        # 如果原图不是 RGB 模式（如 RGBA 的 PNG），转换为 RGB 保存 JPEG
        if img.mode in ("RGBA", "P", "LA"):
            background = Image.new("RGB", img.size, (255, 255, 255))
            if img.mode == "P":
                img = img.convert("RGBA")
            background.paste(img, mask=img.split()[-1] if img.mode == "RGBA" else None)
            img = background
        elif img.mode != "RGB":
            img = img.convert("RGB")

        img.save(thumbnail_path, "JPEG", quality=85)
        return True
    except ImportError:
        # Pillow 未安装，跳过缩略图生成
        return False
    except Exception:
        # 其他错误（格式不支持等），也跳过
        return False


# ==================== 路由 ====================


@router.post("/upload")
async def upload_images(
    files: List[UploadFile] = File(...),
    auto_tag: bool = Form(default=False),
):
    """
    上传图片到参考池。
    支持单张或批量上传。可选自动 AI 打标。
    """
    results = []
    errors = []

    # 如果需要自动打标，先加载 AI 客户端
    ai_client = None
    tagger = None
    if auto_tag:
        ai_client = load_ai_client_from_config()
        if ai_client:
            tagger = ImageTagger(ai_client)

    for file in files:
        try:
            # 验证文件类型
            content_type = file.content_type or ""
            if not content_type.startswith("image/"):
                errors.append({
                    "filename": file.filename,
                    "error": f"不支持的文件类型: {content_type}",
                })
                continue

            # 生成图片 ID
            image_id = store.generate_image_id()

            # 保存原图
            safe_filename = file.filename or "unknown.jpg"
            image_filename = f"{image_id}_{safe_filename}"
            image_path = store.LIBRARY_IMAGES_DIR / image_filename
            store.LIBRARY_IMAGES_DIR.mkdir(parents=True, exist_ok=True)

            with open(image_path, "wb") as f:
                content = await file.read()
                f.write(content)

            # 生成缩略图
            thumb_filename = f"{image_id}_thumb.jpg"
            thumb_path = store.LIBRARY_THUMBNAILS_DIR / thumb_filename
            store.LIBRARY_THUMBNAILS_DIR.mkdir(parents=True, exist_ok=True)
            thumb_success = _generate_thumbnail(str(image_path), str(thumb_path))

            # 构建 ImageTag —— 路径存为相对 URL（对应 main.py 的静态挂载）
            tag = ImageTag(
                image_id=image_id,
                filename=safe_filename,
                file_path=f"/library-images/{image_filename}",
                thumbnail_path=f"/library-thumbnails/{thumb_filename}" if thumb_success else "",
                created_date=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            )

            # 如果需要自动 AI 打标
            if auto_tag and tagger:
                try:
                    ai_tags = await tagger.tag_image(str(image_path))
                    tag.themes = ai_tags.get("themes", [])
                    tag.styles = ai_tags.get("styles", [])
                    tag.color_moods = ai_tags.get("color_moods", [])
                    tag.emotions = ai_tags.get("emotions", [])
                    tag.target_audiences = ai_tags.get("target_audiences", [])
                    tag.description = ai_tags.get("description", "")
                    tag.elements = ai_tags.get("elements", [])
                    tag.layout_type = ai_tags.get("layout_type", "")
                    tag.ai_tagged = True
                except Exception as e:
                    # AI 打标失败不阻断上传，记录错误
                    errors.append({
                        "filename": safe_filename,
                        "image_id": image_id,
                        "error": f"AI打标失败: {str(e)}（图片已上传）",
                    })

            # 保存到存储
            store.save_image(tag)

            results.append({
                "image_id": image_id,
                "filename": safe_filename,
                "file_path": f"/library-images/{image_filename}",
                "thumbnail_path": f"/library-thumbnails/{thumb_filename}" if thumb_success else "",
                "ai_tagged": tag.ai_tagged,
            })

        except Exception as e:
            errors.append({
                "filename": file.filename or "unknown",
                "error": str(e),
            })

    return {
        "success": True,
        "message": f"成功上传 {len(results)} 张图片" + (f"，{len(errors)} 张失败" if errors else ""),
        "data": {
            "uploaded": results,
            "errors": errors,
            "total_uploaded": len(results),
            "total_errors": len(errors),
        },
    }


@router.get("")
async def list_images(
    theme: Optional[str] = Query(None, description="按主题筛选"),
    style: Optional[str] = Query(None, description="按风格筛选"),
    color_mood: Optional[str] = Query(None, description="按色彩情绪筛选"),
    emotion: Optional[str] = Query(None, description="按情绪筛选"),
    layout_type: Optional[str] = Query(None, description="按构图类型筛选"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=100, description="每页数量"),
):
    """列表查询图片库，支持分页和按标签筛选"""
    result = store.list_images(
        theme=theme,
        style=style,
        color_mood=color_mood,
        emotion=emotion,
        layout_type=layout_type,
        page=page,
        page_size=page_size,
    )
    return {"success": True, "data": result}


@router.get("/stats")
async def get_stats():
    """获取图库统计信息"""
    stats = store.get_stats()
    return {"success": True, "data": stats}


@router.get("/{image_id}")
async def get_image(image_id: str):
    """获取单张图片的完整标签信息"""
    tag = store.get_image(image_id)
    if not tag:
        raise HTTPException(status_code=404, detail=f"图片 {image_id} 不存在")

    return {"success": True, "data": tag.model_dump()}


@router.put("/{image_id}")
async def update_image(image_id: str, body: UpdateTagRequest):
    """
    更新图片标签（人工校对）。
    只更新请求中提供的字段，未提供的保持原值。
    """
    # 先读取现有数据
    existing = store.get_image(image_id)
    if not existing:
        raise HTTPException(status_code=404, detail=f"图片 {image_id} 不存在")

    # 只更新提供了的字段
    update_data = body.model_dump(exclude_none=True)

    tag_dict = existing.model_dump()
    tag_dict.update(update_data)

    # 如果有人工修改，标记为已审核
    if update_data:
        tag_dict["manually_reviewed"] = True

    updated_tag = ImageTag(**tag_dict)
    success = store.update_image(image_id, updated_tag)

    if not success:
        raise HTTPException(status_code=500, detail="更新失败")

    return {"success": True, "message": "标签已更新", "data": updated_tag.model_dump()}


@router.delete("/{image_id}")
async def delete_image(image_id: str):
    """删除图片及其所有关联数据"""
    success = store.delete_image(image_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"图片 {image_id} 不存在")

    return {"success": True, "message": f"图片 {image_id} 已删除"}


@router.post("/{image_id}/tag")
async def tag_image(image_id: str):
    """对已上传的图片执行 AI 打标"""
    # 检查图片是否存在
    existing = store.get_image(image_id)
    if not existing:
        raise HTTPException(status_code=404, detail=f"图片 {image_id} 不存在")

    # 加载 AI 客户端
    ai_client = load_ai_client_from_config()
    if not ai_client:
        raise HTTPException(status_code=400, detail="AI 模型未配置，请先在设置中配置 AI 模型")

    # 检查图片文件是否存在（file_path 为相对 URL，需反推磁盘路径）
    fname = existing.file_path.split("/")[-1]
    disk_path = store.LIBRARY_IMAGES_DIR / fname
    if not disk_path.exists():
        raise HTTPException(status_code=400, detail=f"图片文件不存在: {existing.file_path}")

    # 执行 AI 打标
    tagger = ImageTagger(ai_client)
    try:
        ai_tags = await tagger.tag_image(str(disk_path))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI 打标失败: {str(e)}")

    # 更新标签
    existing.themes = ai_tags.get("themes", [])
    existing.styles = ai_tags.get("styles", [])
    existing.color_moods = ai_tags.get("color_moods", [])
    existing.emotions = ai_tags.get("emotions", [])
    existing.target_audiences = ai_tags.get("target_audiences", [])
    existing.description = ai_tags.get("description", "")
    existing.elements = ai_tags.get("elements", [])
    existing.layout_type = ai_tags.get("layout_type", "")
    existing.ai_tagged = True

    store.update_image(image_id, existing)

    return {
        "success": True,
        "message": f"图片 {image_id} AI 打标完成",
        "data": existing.model_dump(),
    }


@router.post("/recommend")
async def recommend_images(body: RecommendRequest):
    """
    基于规则卡推荐相似的自有图片。
    可以传 rule_id（从存储读取规则卡）或直接传 rule_card 字典。
    """
    rule_card = body.rule_card

    # 如果传了 rule_id，从存储中读取
    if body.rule_id and not rule_card:
        from services.rule_store import get_rule
        rule = get_rule(body.rule_id)
        if not rule:
            raise HTTPException(status_code=404, detail=f"规则卡 {body.rule_id} 不存在")
        rule_card = rule.model_dump()

    if not rule_card:
        raise HTTPException(status_code=400, detail="请提供 rule_id 或 rule_card")

    # 执行推荐（返回值已经是字典列表，包含 score 和 match_details）
    recommendations = store.recommend_for_rule(rule_card, limit=body.limit)

    return {
        "success": True,
        "data": {
            "recommendations": recommendations,
            "total": len(recommendations),
        },
    }

"""
图片分析路由
- POST /api/analyze → 上传图片并分析，返回规则卡 + SABC 分级
"""

import json
import time
from pathlib import Path

from fastapi import APIRouter, UploadFile, File, HTTPException

from models.settings import AIModelConfig
from services.ai_client import AIClient
from services.image_analyzer import ImageAnalyzer

router = APIRouter()

# 路径常量
DATA_DIR = Path(__file__).parent.parent / "data"
CONFIG_PATH = DATA_DIR / "config.json"
UPLOADS_DIR = DATA_DIR / "uploads"


def _load_ai_config() -> AIModelConfig:
    """
    加载 AI 配置。
    如果未配置则抛出 HTTPException 400。
    """
    if not CONFIG_PATH.exists():
        raise HTTPException(status_code=400, detail="请先配置 AI 模型")

    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    # 检查必要字段是否填写
    if not data.get("api_key") or not data.get("api_url"):
        raise HTTPException(status_code=400, detail="请先配置 AI 模型")

    return AIModelConfig(**data)


@router.post("/analyze")
async def analyze_image(file: UploadFile = File(...)):
    """
    上传图片并分析。
    1. 保存图片到 data/uploads/（时间戳 + 原文件名）
    2. 加载 AI 配置，创建 AIClient
    3. 调用 ImageAnalyzer.analyze()
    4. 返回分析结果（规则卡 JSON + SABC 分级结果）
    """
    # 校验文件类型（支持常见图片格式）
    allowed_types = {"image/jpeg", "image/png", "image/webp", "image/avif", "image/gif", "image/bmp", "image/tiff"}
    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件类型: {file.content_type}，请上传 JPG/PNG/WebP/AVIF 图片",
        )

    # 保存上传的图片：用时间戳 + 原文件名避免重名
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = int(time.time())
    safe_filename = f"{timestamp}_{file.filename}"
    save_path = UPLOADS_DIR / safe_filename

    content = await file.read()
    save_path.write_bytes(content)

    # 加载 AI 配置
    config = _load_ai_config()
    client = AIClient(config)
    analyzer = ImageAnalyzer(client)

    # 执行分析
    try:
        result = await analyzer.analyze(str(save_path))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"图片分析失败: {str(e)}")

    return {
        "success": True,
        "message": "分析完成",
        "data": {
            "rule_card": result["rule_card"],
            "sabc_raw": result["sabc_raw"],
            "rule_raw": result["rule_raw"],
            "uploaded_image": f"/uploads/{safe_filename}",
        },
    }

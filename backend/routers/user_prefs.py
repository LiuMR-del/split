"""
用户偏好路由（跨规则卡通用的自定义产品名 / 生图尺寸预设）
- GET    /api/prefs                        → 读取全部偏好
- POST   /api/prefs/custom-products        → 新增自定义产品名
- DELETE /api/prefs/custom-products?name=  → 删除自定义产品名
- POST   /api/prefs/custom-sizes           → 新增/更新自定义尺寸预设
- DELETE /api/prefs/custom-sizes?label=    → 删除自定义尺寸预设
- PUT    /api/prefs/last-size              → 记住上次使用的尺寸

响应统一用 {"success": True, "data": ...} 包装格式（新路由约定，前端 unwrapData 解包）。
store 抛 ValueError（入参非法）→ 400；其余未预期异常 → logging.exception + 500。
"""

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from services.user_prefs_store import (
    load_prefs,
    add_custom_product,
    remove_custom_product,
    add_custom_size,
    remove_custom_size,
    set_last_size,
)

router = APIRouter(prefix="/prefs", tags=["用户偏好"])


class CustomProductRequest(BaseModel):
    """新增自定义产品名请求"""
    name: str = Field(description="产品名，如 'Frame 相框'")


class CustomSizeRequest(BaseModel):
    """新增/更新自定义尺寸预设请求"""
    label: str = Field(description="尺寸名称，如 '抱枕 45x45'")
    width: int = Field(description="宽度")
    height: int = Field(description="高度")


class LastSizeRequest(BaseModel):
    """记住上次使用尺寸的请求（preset 允许空串=手动输入模式）"""
    preset: str = Field(default="", description="选中的预设 value，手动输入时为空串")
    width: int = Field(description="宽度")
    height: int = Field(description="高度")


@router.get("")
async def get_prefs():
    """读取全部用户偏好（文件不存在/损坏时返回默认空值，不报错）"""
    try:
        return {"success": True, "data": load_prefs()}
    except Exception as e:
        logging.exception("读取用户偏好失败")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/custom-products")
async def create_custom_product(request: CustomProductRequest):
    """新增一个自定义产品名（去重、最新在前、上限 20 条）"""
    try:
        products = add_custom_product(request.name)
        return {"success": True, "data": {"custom_products": products}}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logging.exception("保存自定义产品名失败")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/custom-products")
async def delete_custom_product(name: str):
    """删除一个自定义产品名（幂等；名称含中文/空格，前端用 query 参数 + encodeURIComponent 传）"""
    try:
        products = remove_custom_product(name)
        return {"success": True, "data": {"custom_products": products}}
    except Exception as e:
        logging.exception("删除自定义产品名失败")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/custom-sizes")
async def create_custom_size(request: CustomSizeRequest):
    """新增/更新一个自定义尺寸预设（按 label 去重，同名视为更新）"""
    try:
        presets = add_custom_size(request.label, request.width, request.height)
        return {"success": True, "data": {"custom_size_presets": presets}}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logging.exception("保存自定义尺寸预设失败")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/custom-sizes")
async def delete_custom_size(label: str):
    """删除一个自定义尺寸预设（幂等）"""
    try:
        presets = remove_custom_size(label)
        return {"success": True, "data": {"custom_size_presets": presets}}
    except Exception as e:
        logging.exception("删除自定义尺寸预设失败")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/last-size")
async def update_last_size(request: LastSizeRequest):
    """记住上次使用的尺寸（下次打开规则卡自动恢复）"""
    try:
        last = set_last_size(request.preset, request.width, request.height)
        return {"success": True, "data": {"last_size": last}}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logging.exception("保存上次使用尺寸失败")
        raise HTTPException(status_code=500, detail=str(e))

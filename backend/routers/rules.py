"""
规则卡 CRUD 路由
- GET    /api/rules            → 列表查询（可选 ?level=S 按等级筛选）
- GET    /api/rules/{rule_id}  → 获取单条规则卡
- POST   /api/rules            → 保存新规则卡
- PUT    /api/rules/{rule_id}  → 更新规则卡
- DELETE /api/rules/{rule_id}  → 删除规则卡
"""

from typing import Optional

from fastapi import APIRouter, HTTPException

from models.rule_card import RuleCard
from services.rule_store import (
    save_rule,
    get_rule,
    list_rules,
    update_rule,
    delete_rule,
)

router = APIRouter()


@router.get("/rules")
async def get_rules(level: Optional[str] = None):
    """
    列表查询规则卡。
    可选参数 level: 按复用等级筛选（S/A/B/C）。
    返回简要信息列表（不含完整 6 层数据）。
    """
    rules = list_rules(level=level)
    return {
        "success": True,
        "data": rules,
        "total": len(rules),
    }


@router.get("/rules/{rule_id}")
async def get_rule_by_id(rule_id: str):
    """获取单条规则卡完整数据"""
    rule = get_rule(rule_id)
    if rule is None:
        raise HTTPException(status_code=404, detail=f"规则卡 {rule_id} 不存在")

    return {
        "success": True,
        "data": rule.model_dump(),
    }


@router.post("/rules")
async def create_rule(rule: RuleCard):
    """
    保存新规则卡。
    请求体为完整的 RuleCard JSON。
    """
    # 检查是否已存在同 ID 的规则
    existing = get_rule(rule.rule_id)
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail=f"规则卡 {rule.rule_id} 已存在，如需更新请使用 PUT 方法",
        )

    save_rule(rule)
    return {
        "success": True,
        "message": f"规则卡 {rule.rule_id} 已保存",
        "data": rule.model_dump(),
    }


@router.put("/rules/{rule_id}")
async def update_rule_by_id(rule_id: str, rule: RuleCard):
    """
    更新规则卡。
    请求体为完整的 RuleCard JSON，rule_id 以 URL 路径为准。
    """
    # 确保请求体的 rule_id 和路径一致
    if rule.rule_id != rule_id:
        raise HTTPException(
            status_code=400,
            detail="请求体中的 rule_id 与 URL 路径不一致",
        )

    success = update_rule(rule_id, rule)
    if not success:
        raise HTTPException(status_code=404, detail=f"规则卡 {rule_id} 不存在")

    return {
        "success": True,
        "message": f"规则卡 {rule_id} 已更新",
        "data": rule.model_dump(),
    }


@router.delete("/rules/{rule_id}")
async def delete_rule_by_id(rule_id: str):
    """删除规则卡"""
    success = delete_rule(rule_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"规则卡 {rule_id} 不存在")

    return {
        "success": True,
        "message": f"规则卡 {rule_id} 已删除",
    }

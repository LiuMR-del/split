"""
规则卡 CRUD 路由
- GET    /api/rules              → 列表查询（可选 ?level=S 按等级筛选）
- GET    /api/rules/{rule_id}    → 获取单条规则卡
- POST   /api/rules              → 保存新规则卡
- PUT    /api/rules/{rule_id}    → 更新规则卡
- DELETE /api/rules/{rule_id}    → 删除规则卡
- POST   /api/rules/batch-delete → 批量删除规则卡（三期追加需求5）
"""

import logging
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from models.rule_card import RuleCard
from services.rule_store import (
    save_rule,
    get_rule,
    generate_rule_id,
    list_rules,
    update_rule,
    delete_rule,
)

router = APIRouter()

# 三期追加需求5：单次批量删除上限。防误传超大列表把请求跑成分钟级
# （每条要删 JSON + SQLite 行 + uploads 里的原图/缩略图）
BATCH_DELETE_MAX = 100


class BatchDeleteRequest(BaseModel):
    """批量删除请求"""
    rule_ids: List[str] = Field(description="要删除的规则卡 ID 列表")


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
    # #25：防双标签页同时分析撞 ID--分析时 image_analyzer 预生成 rule_id 供预览，
    # 保存时若发现已存在（两标签页并发分析未保存导致同 ID），后端重分配新 ID 而非报 409。
    existing = get_rule(rule.rule_id)
    if existing is not None:
        rule.rule_id = generate_rule_id()

    save_rule(rule, thumbnail_path=rule.thumbnail_path)
    return {
        "success": True,
        "message": f"规则卡 {rule.rule_id} 已保存",
        "data": rule.model_dump(),
    }


@router.post("/rules/batch-delete")
async def batch_delete_rules(request: BatchDeleteRequest):
    """
    批量删除规则卡（三期追加需求5）。

    用 POST + 子资源路径而非 `DELETE` 带 body——部分代理/客户端对带 body 的 DELETE
    支持不一致，且这是"批量操作"语义。

    串行逐个复用 `delete_rule()`（删除逻辑的单一事实来源，含"先读 JSON 取
    source_images/thumbnail_path 再删文件"的正确顺序），**单条失败不中断整批**，
    分类返回结果供前端分条反馈。

    不需要加锁：`delete_rule` 里 `unlink(missing_ok=True)` 和 `DELETE WHERE` 都是
    幂等操作，重复删不炸；单进程部署下本请求内串行执行。
    """
    rule_ids = request.rule_ids
    if not rule_ids:
        raise HTTPException(status_code=400, detail="请至少选择一条规则卡")
    if len(rule_ids) > BATCH_DELETE_MAX:
        raise HTTPException(
            status_code=400,
            detail=f"单次最多删除 {BATCH_DELETE_MAX} 条（本次 {len(rule_ids)} 条）",
        )

    deleted = []      # type: List[str]
    not_found = []    # type: List[str]
    failed = []       # type: List[dict]

    for rule_id in rule_ids:
        try:
            if delete_rule(rule_id):
                deleted.append(rule_id)
            else:
                not_found.append(rule_id)
        except Exception as e:
            # 单条失败（磁盘/权限/数据损坏等）不影响其余，记全栈便于排查
            logging.exception("批量删除规则卡 %s 失败", rule_id)
            failed.append({"rule_id": rule_id, "error": str(e)})

    return {
        "success": True,
        "message": f"已删除 {len(deleted)} 条",
        "data": {
            "deleted": deleted,
            "not_found": not_found,
            "failed": failed,
        },
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

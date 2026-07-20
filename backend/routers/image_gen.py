"""
生图 API 路由
- POST /api/gen/config         → 保存生图 API 配置
- GET  /api/gen/config         → 读取生图配置
- POST /api/gen/test           → 测试生图 API 连接
- POST /api/gen/submit         → 提交生图任务
- GET  /api/gen/task/{task_id} → 查询任务状态
- GET  /api/gen/tasks          → 任务列表
- POST /api/gen/download/{task_id} → 下载远端图片到本地
"""

import asyncio
import logging
import json
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException

from models.image_gen import (
    ImageGenConfig,
    ImageGenConfigResponse,
    ImageGenRequest,
    ImageGenTask,
)
from services.image_gen_client import ImageGenClient
from services.image_gen_store import (
    save_task,
    get_task,
    update_task,
    list_tasks,
    delete_task,
    download_images,
    generate_task_id,
    GEN_TASKS_DIR,
)

router = APIRouter(prefix="/gen", tags=["生图"])

# 生图配置文件路径（和 AI 分析配置分开存）
CONFIG_DIR = Path(__file__).parent.parent / "data"
GEN_CONFIG_PATH = CONFIG_DIR / "gen_config.json"


# ==================== 配置管理 ====================


def _mask_api_key(key: str) -> str:
    """将 API Key 脱敏"""
    if not key or len(key) <= 8:
        return "***"
    return f"{key[:3]}...{key[-4:]}"


def _load_gen_config() -> Optional[dict]:
    """从 gen_config.json 读取生图配置"""
    if not GEN_CONFIG_PATH.exists():
        return None
    with open(GEN_CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def _save_gen_config(config: dict) -> None:
    """将生图配置写入 gen_config.json"""
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with open(GEN_CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)


@router.get("/config", response_model=ImageGenConfigResponse)
async def get_gen_config():
    """获取生图 API 配置（API Key 脱敏）"""
    config = _load_gen_config()
    if config is None:
        return ImageGenConfigResponse(
            provider="aireiter",
            api_url="https://aireiter.com",
            api_key_masked="",
            model="nano_banana_pro_advanced",
            api_type="openai",
            is_configured=False,
        )

    return ImageGenConfigResponse(
        provider=config.get("provider", "aireiter"),
        api_url=config.get("api_url", "https://aireiter.com"),
        api_key_masked=_mask_api_key(config.get("api_key", "")),
        model=config.get("model", "nano_banana_pro_advanced"),
        api_type=config.get("api_type", "openai"),
        is_configured=bool(config.get("api_key")),
    )


@router.post("/config", response_model=ImageGenConfigResponse)
async def save_gen_config(config: ImageGenConfig):
    """保存生图 API 配置"""
    _save_gen_config(config.model_dump())

    return ImageGenConfigResponse(
        provider=config.provider,
        api_url=config.api_url,
        api_key_masked=_mask_api_key(config.api_key),
        model=config.model,
        api_type=config.api_type,
        is_configured=bool(config.api_key),
    )


# ==================== 连接测试 ====================


@router.post("/test")
async def test_gen_connection(config: ImageGenConfig):
    """测试生图 API 连接"""
    client = ImageGenClient(config)
    result = await client.test_connection()
    return result


# ==================== 任务提交 ====================


@router.post("/submit")
async def submit_gen_task(request: ImageGenRequest):
    """
    提交生图任务。

    根据 count 提交 1-4 个独立的生图任务，
    每个任务生成独立的 out_task_id。

    返回:
        提交成功的任务列表
    """
    # 加载生图配置
    config_data = _load_gen_config()
    if not config_data or not config_data.get("api_key"):
        raise HTTPException(status_code=400, detail="生图 API 未配置，请先在设置中配置")

    config = ImageGenConfig(**config_data)
    client = ImageGenClient(config)

    # 构建完整提示词（正向 + 负向组合）
    prompt = request.prompt_positive

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    submitted_tasks = []
    errors = []

    async def _submit_one(idx: int):
        """提交单个生图任务。返回 task.model_dump()（成功）或 {"index":idx+1,"error":...}（失败）。
        #8：抽出协程，供 AIReiter 并发 / OpenAI 串行 复用。"""
        task_id = generate_task_id()
        try:
            result = await client.submit_task(
                prompt=prompt,
                width=request.width,
                height=request.height,
                negative_prompt=request.prompt_negative,
            )
            is_sync_completed = result.get("status") == "completed" and result.get("image_urls")
            # #17：OpenAI 同步模式 _openai_generate 恒返 "completed"，无图说明 API 调用成功但未出图
            # （内容策略拒绝/配额耗尽），判 failed，不落僵尸 completed。AIReiter 不受影响。
            is_openai_no_image = (
                config.api_type == "openai"
                and not is_sync_completed
                and result.get("status") == "completed"
            )
            if is_openai_no_image:
                final_status = "failed"
                final_error = "生图 API 未返回图片（可能内容策略拒绝或配额耗尽）"
                final_completed_at = now
            else:
                final_status = "completed" if is_sync_completed else result.get("status", "pending")
                final_error = ""
                final_completed_at = now if is_sync_completed else ""

            task = ImageGenTask(
                task_id=task_id,
                out_task_id=result["out_task_id"],
                rule_id=request.rule_id,
                rule_name=request.rule_name,
                version=request.version,
                status=final_status,
                prompt_positive=request.prompt_positive,
                prompt_negative=request.prompt_negative,
                width=request.width,
                height=request.height,
                image_urls=result.get("image_urls", []) if is_sync_completed else [],
                estimated_credits=result.get("estimated_credits", 0),
                error=final_error,
                created_at=now,
                completed_at=final_completed_at,
            )
            save_task(task)
            return task.model_dump()
        except Exception as e:
            logging.exception("生图任务提交失败 index=%d", idx + 1)
            # #9：清理本次失败的占位文件（generate_task_id 已写占位占号，失败不清理会留垃圾+烧编号）
            try:
                placeholder = GEN_TASKS_DIR / f"{task_id}.json"
                if placeholder.exists():
                    placeholder.unlink()
            except Exception:
                pass
            return {"index": idx + 1, "error": str(e)}

    # #8：按 api_type 分支提交。
    # AIReiter 异步模式 submit 不等出图（只是提交），限流压力小，asyncio.gather 并发总耗时≈单次；
    # OpenAI 同步模式 submit 等出图（30-120s/张），图片 API 限流严（Tier 1 个位数 RPM），
    # 并发会集体触发 429（比串行更糟），保持串行。
    if config.api_type == "aireiter":
        raw_results = await asyncio.gather(
            *[_submit_one(i) for i in range(request.count)],
            return_exceptions=True,
        )
        for r in raw_results:
            if isinstance(r, Exception):
                errors.append({"index": 0, "error": str(r)})  # gather 未预期异常双保险
            elif isinstance(r, dict) and "error" in r:
                errors.append(r)
            else:
                submitted_tasks.append(r)
    else:
        # OpenAI 串行
        for i in range(request.count):
            r = await _submit_one(i)
            if isinstance(r, dict) and "error" in r:
                errors.append(r)
            else:
                submitted_tasks.append(r)

    if not submitted_tasks and errors:
        raise HTTPException(
            status_code=500,
            detail=f"所有任务提交失败: {errors[0]['error']}",
        )

    return {
        "submitted": len(submitted_tasks),
        "tasks": submitted_tasks,
        "errors": errors if errors else None,
    }


# ==================== 任务查询 ====================


@router.get("/task/{task_id}")
async def get_gen_task(task_id: str):
    """
    查询单个生图任务状态。

    如果任务状态是 pending 或 processing，
    会代理查询远端 API 并更新本地状态。
    """
    task = get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail=f"任务 {task_id} 不存在")

    # 如果任务尚未完成，代理查询远端
    if task.status in ("pending", "processing"):
        config_data = _load_gen_config()
        if config_data and config_data.get("api_key"):
            config = ImageGenConfig(**config_data)
            client = ImageGenClient(config)

            try:
                result = await client.query_task(task.out_task_id)
                updates = {"status": result["status"]}

                if result["image_urls"]:
                    updates["image_urls"] = result["image_urls"]

                if result["error"]:
                    updates["error"] = result["error"]

                if result["status"] in ("completed", "failed"):
                    updates["completed_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

                update_task(task_id, updates)

                # 重新读取更新后的任务
                task = get_task(task_id)
            except Exception:
                # 查询远端失败不影响返回本地状态
                pass

    return task.model_dump() if task else {}


@router.get("/tasks")
async def list_gen_tasks(
    rule_id: Optional[str] = None,
    status: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
):
    """
    查询生图任务列表。

    支持按规则ID和状态筛选，分页返回。
    """
    return list_tasks(
        rule_id=rule_id,
        status=status,
        page=page,
        page_size=page_size,
    )


# ==================== 任务删除 ====================


@router.delete("/task/{task_id}")
async def delete_gen_task(task_id: str):
    """
    删除生图任务及其关联的本地图片和 JSON 文件。
    """
    deleted = delete_task(task_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"任务 {task_id} 不存在")

    return {
        "success": True,
        "message": f"任务 {task_id} 已删除",
    }


# ==================== 图片下载 ====================


@router.post("/download/{task_id}")
async def download_gen_images(task_id: str):
    """
    下载远端生成的图片到本地。

    任务必须是已完成状态，且有远端图片 URL。
    下载后图片保存在 data/gen/images/ 目录，
    可通过 /gen-images/ 静态路径访问。
    """
    try:
        downloaded = await download_images(task_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not downloaded:
        raise HTTPException(status_code=400, detail="没有成功下载任何图片")

    # 构建可访问的 URL 路径
    accessible_paths = []
    for path in downloaded:
        filename = Path(path).name
        accessible_paths.append(f"/gen-images/{filename}")

    return {
        "downloaded": len(downloaded),
        "local_paths": downloaded,
        "accessible_paths": accessible_paths,
    }

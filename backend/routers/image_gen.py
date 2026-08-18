"""
生图 API 路由
- POST /api/gen/config         → 保存生图 API 配置
- GET  /api/gen/config         → 读取生图配置
- POST /api/gen/test           → 测试生图 API 连接
- POST /api/gen/submit         → 提交生图任务
- GET  /api/gen/task/{task_id} → 查询任务状态
- GET  /api/gen/tasks          → 任务列表
- POST /api/gen/download/{task_id} → 下载远端图片到本地
- POST /api/gen/download-zip   → 批量打包下载（裸 zip 二进制，非包装格式）
- POST /api/gen/analyze-ref    → 上传参考图，AI 分析提取单一维度特征片段
"""

import asyncio
import base64
import io
import logging
import json
import re
import time
import zipfile
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from models.image_gen import (
    ImageGenConfig,
    ImageGenConfigResponse,
    ImageGenRequest,
    ImageGenTask,
)
from services.image_gen_client import ImageGenClient, REFERENCE_SUPPORT
from services.image_gen_store import (
    save_task,
    get_task,
    update_task,
    list_tasks,
    list_tasks_by_rule_group,
    count_tasks_by_rule,
    find_orphan_task_ids,
    find_task_ids_by_rule,
    delete_task,
    download_images,
    generate_task_id,
    GEN_TASKS_DIR,
)
from services.image_format_utils import prepare_image_for_vlm, UPLOAD_ACCEPTED_MIME_TYPES
from services.image_alpha_utils import white_to_transparent
from services.ai_client import load_ai_client_from_config
from services.ai_response_utils import extract_json_from_ai_response
from services.rule_store import get_rule

router = APIRouter(prefix="/gen", tags=["生图"])

# 数据目录（用于把 URL 相对路径映射回磁盘路径）
DATA_DIR = Path(__file__).parent.parent / "data"

# #7：URL 前缀 -> 磁盘目录白名单。reference_image_paths 是前端传来的字符串，
# 必须严格校验只能来自这几个已知的静态挂载目录，防止路径穿越（如 "../../etc/passwd"）
# 或访问白名单之外的任意文件。
_REFERENCE_PATH_WHITELIST = {
    "/uploads/": DATA_DIR / "uploads",
    "/library-images/": DATA_DIR / "library" / "images",
    "/gen-refs/": DATA_DIR / "gen" / "refs",
}


def _resolve_reference_path(url_path: str) -> Optional[Path]:
    """把前端传来的相对 URL 路径（如 "/uploads/xxx.jpg"）安全映射到磁盘路径。

    #7：白名单前缀匹配 + 文件名单独 basename 化，双重防护路径穿越——
    即使前缀合法，文件名部分也不能带 "/" 或 ".."，只取 basename。
    映射失败（前缀不在白名单/文件不存在）返回 None，调用方应跳过并 warning，
    不应该让一张有问题的参考图挡住整个生图任务。
    """
    for prefix, disk_dir in _REFERENCE_PATH_WHITELIST.items():
        if url_path.startswith(prefix):
            filename = Path(url_path[len(prefix):]).name  # basename 化，防 ".." 穿越
            if not filename:
                return None
            resolved = disk_dir / filename
            if resolved.exists():
                return resolved
            return None
    return None

def _convert_data_uri_to_transparent(url: str) -> str:
    """把白底图的 data URI 转成透明底 data URI（元素拆分专用）。

    只处理 data URI（OpenAI 同步模式返回的形式）；http URL 原样返回——
    远端 URL 要先下载才能改，那条路径（AIReiter 异步）本来就不支持带参考图、
    走不到元素拆分，不为它增加复杂度。

    转换失败/不是 data URI 时**原样返回**，绝不让它阻断生图流程。
    """
    if not url.startswith("data:"):
        return url
    try:
        header, b64data = url.split(",", 1)
        raw = base64.b64decode(b64data)
        converted, stats = white_to_transparent(raw)
        if not stats.get("converted"):
            if stats.get("error"):
                logging.warning("元素拆分转透明失败，保留白底图：%s", stats["error"])
            return url
        logging.info(
            "元素拆分转透明完成：全透明 %.1f%% / 半透明 %.1f%% / 包围盒 %s",
            stats.get("transparent_ratio", 0) * 100,
            stats.get("semi_ratio", 0) * 100,
            stats.get("bbox"),
        )
        return "data:image/png;base64," + base64.b64encode(converted).decode()
    except Exception:
        logging.warning("元素拆分转透明异常，保留白底图", exc_info=True)
        return url


# 生图配置文件路径（和 AI 分析配置分开存）
GEN_CONFIG_PATH = DATA_DIR / "gen_config.json"

# #6：常见比例集合（用户实选宽高化简后若数字仍过大，近似到这些常见值）
_COMMON_RATIOS = [
    (1, 1), (3, 4), (4, 3), (2, 3), (3, 2), (4, 5), (5, 4), (9, 16), (16, 9),
]


def _ratio_text(width: int, height: int) -> str:
    """把宽高转成比例前置句里要用的 "rw:rh" 文本 + 朝向。

    #6：比例约束前置——生图 API 只认 width/height 数字，不会自动理解"这应该是
    3:4 竖版"，前置一句人类可读的比例声明能提升构图遵循度。gcd 化简；化简后
    任一边仍 >50（说明宽高比很怪异，如 3066x4000 化简出的分数很大）时，
    近似到最接近的常见比例，避免前置句写出 "1533:2000" 这种没意义的大数字。
    """
    if width <= 0 or height <= 0:
        return "1:1", "square"

    def _gcd(a: int, b: int) -> int:
        while b:
            a, b = b, a % b
        return a

    d = _gcd(width, height)
    rw, rh = width // d, height // d

    if rw > 50 or rh > 50:
        ratio = width / height
        closest = min(_COMMON_RATIOS, key=lambda c: abs(ratio - c[0] / c[1]))
        rw, rh = closest

    orientation = "square" if rw == rh else ("portrait" if rw < rh else "landscape")
    return f"{rw}:{rh}", orientation


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
    DATA_DIR.mkdir(parents=True, exist_ok=True)
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
            supports_reference=REFERENCE_SUPPORT.get("openai", False),
        )

    api_type = config.get("api_type", "openai")
    return ImageGenConfigResponse(
        provider=config.get("provider", "aireiter"),
        api_url=config.get("api_url", "https://aireiter.com"),
        api_key_masked=_mask_api_key(config.get("api_key", "")),
        model=config.get("model", "nano_banana_pro_advanced"),
        api_type=api_type,
        is_configured=bool(config.get("api_key")),
        supports_reference=REFERENCE_SUPPORT.get(api_type, False),
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
        supports_reference=REFERENCE_SUPPORT.get(config.api_type, False),
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

    # #6：比例约束前置——用户实选的 width/height 才是唯一权威来源，前置一句
    # "Canvas: {比例} {朝向} format" 让生图模型先明确画布形状，减少构图跑偏；
    # 落库的 prompt_positive 存这句拼接后的最终值（任务页可追溯实际发送内容）。
    # 前端提交的 prompt 本身不含这句，天然幂等，重复提交不会累加前置句。
    ratio_text, orientation = _ratio_text(request.width, request.height)
    ratio_prefix = f"[Canvas: {ratio_text} {orientation} format] The entire design must be composed for and fill this {ratio_text} canvas edge to edge. "
    prompt = ratio_prefix + request.prompt_positive

    # #7：解析参考图（附带竞品原图生图）。只有当前配置的模式支持带图时才准备这些图片
    # （REFERENCE_SUPPORT），否则跳过全部图片预处理——AIReiter 模式不支持，白做这些
    # base64 编码/缩放没有意义，还会拖慢一个纯文本任务本该很快的响应。
    reference_images = None
    used_reference = False
    if REFERENCE_SUPPORT.get(config.api_type, False):
        disk_paths = []  # type: list

        if request.attach_rule_image:
            rule = get_rule(request.rule_id)
            if rule and rule.source_images:
                candidate = DATA_DIR / "uploads" / rule.source_images[0]
                if candidate.exists():
                    disk_paths.append(candidate)
                else:
                    logging.warning(
                        "生图参考图跳过：规则 %s 的竞品原图文件不存在 %s",
                        request.rule_id, candidate,
                    )

        for url_path in request.reference_image_paths:
            resolved = _resolve_reference_path(url_path)
            if resolved:
                disk_paths.append(resolved)
            else:
                logging.warning("生图参考图跳过：路径不在白名单或文件不存在 %s", url_path)

        if disk_paths:
            reference_images = []
            for p in disk_paths:
                try:
                    b64, mime = prepare_image_for_vlm(p)
                    reference_images.append({"b64": b64, "mime": mime})
                except Exception:
                    logging.warning("生图参考图跳过：处理失败 %s", p, exc_info=True)
            used_reference = bool(reference_images)

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
                reference_images=reference_images,
                # 2026-08-18：元素拆分要上游返回**不透明整图**，由本地抠。
                # 不传这个参数时上游会自己抠，但抠得有碎洞（实测最高 4.68%）且
                # 信息已丢失无法本地补救，见 image_gen_client._openai_generate 注释。
                force_opaque=(request.version == "E"),
            )
            is_sync_completed = result.get("status") == "completed" and result.get("image_urls")

            # 2026-08-17（元素拆分图）：白底 → 真透明底。
            # **只对 version='E'（元素拆分）做**——普通 POD 设计图的白底是设计的一部分，
            # 绝不能被扒掉。抠取指令必须出白底（透明底与"保持原位置"不可兼得，见
            # ELEMENT_EXTRACTION_PROMPT_TEMPLATE 的注释），所以在这里补转换。
            if request.version == "E" and is_sync_completed:
                result["image_urls"] = [
                    _convert_data_uri_to_transparent(u) for u in result["image_urls"]
                ]
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
                prompt_positive=prompt,
                prompt_negative=request.prompt_negative,
                width=request.width,
                height=request.height,
                image_urls=result.get("image_urls", []) if is_sync_completed else [],
                estimated_credits=result.get("estimated_credits", 0),
                error=final_error,
                created_at=now,
                completed_at=final_completed_at,
                used_reference=used_reference,
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
            # 既有 bug 修复：判断"是否失败"不能用 "error" in r——_submit_one 成功时返回
            # task.model_dump()，这个 dict 恒有 error 字段（成功时是空字符串 ""），
            # 原判断只查 key 存不存在，导致每次成功任务都被误判成失败、前端收到假 500
            # （图其实生成好了、任务记录也落盘了）。失败分支返回的 dict 才有 task_id 缺失
            # 这个本质区别，用它判断更直接，不用记"model_dump 恒带 error 空串"这种隐藏细节。
            elif isinstance(r, dict) and "task_id" not in r:
                errors.append(r)
            else:
                submitted_tasks.append(r)
    else:
        # OpenAI 串行
        for i in range(request.count):
            r = await _submit_one(i)
            if isinstance(r, dict) and "task_id" not in r:
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


@router.post("/tasks/delete-by-rule")
async def delete_tasks_by_rule(payload: dict):
    """删除某个规则分组下的**全部**生图任务（2026-08-18 用户反馈"怎么按组清理"）。

    此前只能展开分组逐条删（每条一次确认），一个 24 条的元素变体组要点 48 次。
    用 **POST + 子资源路径**而非带 body 的 DELETE（部分代理对带 body 的 DELETE
    支持不一致，且这是"批量操作"语义，同 rules 的 batch-delete 约定）。
    body: {"rule_id": "RULE-0070"}——空字符串表示"未关联规则"那一组。
    串行复用 `delete_task`（含清理本地图片），单条失败不中断整批。
    """
    if not isinstance(payload, dict) or "rule_id" not in payload:
        raise HTTPException(status_code=400, detail="缺少 rule_id 字段")
    rule_id = payload.get("rule_id") or ""
    task_ids = find_task_ids_by_rule(rule_id)
    if not task_ids:
        return {"deleted": [], "failed": [], "deleted_count": 0}
    deleted, failed = [], []
    for tid in task_ids:
        try:
            if delete_task(tid):
                deleted.append(tid)
            else:
                failed.append({"task_id": tid, "error": "记录不存在"})
        except Exception as e:
            logging.exception("按规则删除生图任务失败 task_id=%s", tid)
            failed.append({"task_id": tid, "error": str(e)})
    return {"deleted": deleted, "failed": failed, "deleted_count": len(deleted)}


@router.get("/tasks/orphans")
async def list_orphan_tasks():
    """统计"所属规则卡已删除"的孤儿任务（清理入口用，只统计不删）。"""
    ids = find_orphan_task_ids()
    return {"count": len(ids), "task_ids": ids}


@router.post("/tasks/cleanup-orphans")
async def cleanup_orphan_tasks():
    """删除全部孤儿任务（规则卡已删的历史记录 + 其本地图片）。

    2026-08-18 用户反馈"没做废弃数据清理机制"。规则卡删除时不级联删生图任务
    （历史设计），这些记录点进去 404 还白占磁盘（实测 640MB 里 55 条属于已删规则）。
    **串行复用已有的 delete_task**（删除逻辑单一事实来源，含清理本地图片文件），
    单条失败不中断整批，与 rules 批量删除同款三分类响应。
    """
    ids = find_orphan_task_ids()
    deleted, failed = [], []
    for tid in ids:
        try:
            if delete_task(tid):
                deleted.append(tid)
            else:
                failed.append({"task_id": tid, "error": "记录不存在"})
        except Exception as e:
            logging.exception("清理孤儿生图任务失败 task_id=%s", tid)
            failed.append({"task_id": tid, "error": str(e)})
    return {"deleted": deleted, "failed": failed, "deleted_count": len(deleted)}


@router.get("/tasks/group-counts")
async def get_task_group_counts():
    """按规则分组的任务真实总条数（前端分组徽标用，与分页无关）。

    2026-08-18：徽标按"已加载任务"计数会在加载更多之前少算（用户反馈），
    这里返回 SQLite 聚合的全量计数。裸数据格式（gen 路由既有约定）。
    """
    return {"counts": count_tasks_by_rule()}


@router.get("/tasks")
async def list_gen_tasks(
    rule_id: Optional[str] = None,
    status: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
    group_by_rule: bool = False,
):
    """
    查询生图任务列表。

    支持按规则ID和状态筛选，分页返回。

    group_by_rule=True 时**分页单位是规则组**（page_size 表示组数），本页各组的
    任务全量返回——生图任务页用这个模式：按任务分页时一次元素变体生成（20+ 条）
    就吃满一页，点"加载更多"只多冒出一个组，很难用（2026-08-18 用户反馈）。
    rule_id 指定单规则时不分组（本来就只有一组）。
    """
    if group_by_rule and not rule_id:
        return list_tasks_by_rule_group(page=page, page_size=page_size, status=status)
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


# 单次打包上限：每张图 1~2MB，20 张约 20~40MB，再多会让响应体过大且等待过久
_MAX_ZIP_TASKS = 20


class DownloadZipRequest(BaseModel):
    """批量打包下载请求（三期阶段四）"""
    task_ids: List[str] = Field(description="要打包的任务 ID 列表")


@router.post("/download-zip")
async def download_gen_images_zip(request: DownloadZipRequest):
    """把多个任务的图片打成一个 zip 返回（三期阶段四：元素拆分图批量下载）。

    ⚠️ **这个端点返回裸 zip 二进制，不走 {"success":..., "data":...} 包装格式**
    ——下载类端点的既定例外（同 GET 静态文件）。前端**不能用 apiPost**
    （它会 `response.json()` 直接崩），必须用原生 fetch 取 `res.blob()`。

    幂等：已下载过的任务复用 task.local_images，不重复拉取远端。
    单个任务失败（不存在/未完成/下载失败）跳过不中断，最终一张都没有才报 400。
    """
    task_ids = request.task_ids
    if not task_ids:
        raise HTTPException(status_code=400, detail="请至少选择一个任务")
    if len(task_ids) > _MAX_ZIP_TASKS:
        raise HTTPException(
            status_code=400,
            detail=f"单次最多打包 {_MAX_ZIP_TASKS} 个任务（本次 {len(task_ids)} 个）",
        )

    collected = []  # type: List[tuple]
    for tid in task_ids:
        task = get_task(tid)
        if task is None:
            logging.warning("打包下载跳过：任务 %s 不存在", tid)
            continue
        paths = list(task.local_images or [])
        if not paths:
            # 还没下载过 → 现在下载（download_images 已支持 data URI 落盘）
            try:
                paths = await download_images(tid)
            except Exception:
                logging.warning("打包下载跳过：任务 %s 下载失败", tid, exc_info=True)
                continue
        for p in paths:
            fp = Path(p)
            if fp.exists():
                collected.append((tid, fp))

    if not collected:
        raise HTTPException(status_code=400, detail="没有可下载的图片")

    # ZIP_STORED（不压缩）：图片本身已是压缩格式，再压几乎不减体积却明显更慢
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as zf:
        for tid, fp in collected:
            # zip 内文件名带 task_id 前缀，防不同任务的同名文件互相覆盖
            zf.write(str(fp), arcname=f"{tid}_{fp.name}")
    buf.seek(0)

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename=split_elements_{stamp}.zip"},
    )


# ==================== 参考图分析 ====================

# 参考图上传大小上限：20MB（与本项目其他上传入口量级一致）
_MAX_REF_FILE_SIZE = 20 * 1024 * 1024

# 落盘目录直接复用上面已声明的白名单映射，避免同一路径在文件里出现两次
GEN_REFS_DIR = _REFERENCE_PATH_WHITELIST["/gen-refs/"]

# 只提取 purpose 指定的单一维度特征，其余维度一律忽略——
# 输出示例全部用方括号占位符描述"填什么、怎么判断"，不给具体值，
# 防止 VLM 把示例当标准答案抄写（本项目历史教训，见 rule_extraction 等 prompt）。
_REF_ANALYSIS_SYSTEM_PROMPT = """你是一位专业的视觉设计分析师。用户会上传一张参考图，并说明这张图用于参考的具体维度（purpose，例如"配色参考""构图参考""光影参考"等），你的任务是**只分析用户指定的这一个维度**，完全忽略图片中与该维度无关的其他所有方面。

## 核心规则
1. 严格按 purpose 圈定的维度分析，其余一律不提：
   - purpose 提到"配色/颜色/色调"类 → 只描述颜色（主色、辅助色、色彩关系、明暗对比），绝对不能提图中主体是什么、构图如何排布
   - purpose 提到"构图/布局/排版"类 → 只描述元素的空间排列、疏密关系、视觉重心、留白，绝对不能提具体颜色或内容物细节
   - purpose 提到其他维度（如光影、材质、字体、氛围、笔触等）→ 同样只聚焦这一个维度，忽略其余
   - purpose 表述模糊时按最贴近的理解处理，但依然只输出与该维度直接相关的内容
2. fragment_en 会脱离这张图片、被单独拼接进另一张完全不同图片的生图提示词里使用，因此：
   - 必须是具体的、可独立理解的描述（写出观察到的实际特征，如具体的颜色关系、具体的布局结构），不能写指代性的话（不能出现类似"这张图里的""如图所示""this image"这类表述），因为读到这段文字时已经看不到这张参考图
   - 只用英文
3. description_cn 是给用户看的一句话中文说明，帮助用户确认这个分析结果是否符合自己想要参考的内容

## 输出格式
请严格输出以下 JSON 格式，不要添加 markdown 代码块标记或其他说明文字：
{
  "fragment_en": "[按 purpose 指定的维度，用英文具体描述图片中实际观察到的特征，需可直接拼进生图提示词；内容必须来自对图片的真实观察，且只覆盖 purpose 对应的这一个维度，不涉及其他方面]",
  "description_cn": "[用一句中文说明分析出的具体内容，让用户能一眼判断是否符合预期]"
}
"""


@router.post("/analyze-ref")
async def analyze_reference_image(file: UploadFile = File(...), purpose: str = Form(...)):
    """
    上传一张生图参考图（如"配色参考""构图参考"），AI 只分析 purpose 指定的这一个维度，
    提取一段可直接拼进生图提示词的英文片段。

    落盘目录 data/gen/refs/，可通过 /gen-refs/ 静态路径访问（挂载见 main.py）。
    """
    # 校验文件类型：上传白名单唯一事实来源见 image_format_utils.UPLOAD_ACCEPTED_MIME_TYPES
    if file.content_type not in UPLOAD_ACCEPTED_MIME_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件类型: {file.content_type}，请上传 JPG/PNG/WebP/AVIF/GIF/BMP/TIFF 图片",
        )

    content = await file.read()
    if len(content) > _MAX_REF_FILE_SIZE:
        raise HTTPException(status_code=400, detail="文件过大，参考图不能超过 20MB")

    # 保存参考图：时间戳 + 清洗后的文件名。Path(...).name 只取 basename，
    # 丢弃客户端文件名里可能带的目录分隔符/".."，防路径穿越。
    GEN_REFS_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = int(time.time())
    safe_filename = f"{timestamp}_{Path(file.filename or 'upload.jpg').name}"
    save_path = GEN_REFS_DIR / safe_filename
    save_path.write_bytes(content)

    # 加载 AI 客户端（本项目统一加载方式），未配置时明确提示原因而非裸 500
    ai_client = load_ai_client_from_config()
    if not ai_client:
        raise HTTPException(status_code=400, detail="请先配置 AI 模型")

    # purpose 限长 + 去控制字符，防异常输入拖累 prompt（与 image_analyzer._append_hint 的 hint 处理一致）
    safe_purpose = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", (purpose or "").strip())[:200]

    try:
        image_base64, media_type = prepare_image_for_vlm(save_path)
        user_prompt = (
            f"用户上传了这张图片，说明其用途/参考维度是：「{safe_purpose}」。\n"
            "请只分析这一个维度对应的图片特征，忽略图片中其他所有方面"
            "（例如维度是颜色就不要提主体形象或构图，维度是构图就不要提颜色）。\n"
            "严格按 system prompt 中的 JSON 格式输出。"
        )
        response = await ai_client.analyze_image(
            image_base64=image_base64,
            system_prompt=_REF_ANALYSIS_SYSTEM_PROMPT,
            user_prompt=user_prompt,
            media_type=media_type,
            temperature=0,
        )
    except Exception as e:
        logging.exception("参考图 AI 分析失败")
        raise HTTPException(status_code=500, detail=f"参考图分析失败: {str(e)}")

    parsed = extract_json_from_ai_response(response)
    if "parse_error" in parsed:
        logging.warning("参考图分析 JSON 解析失败，返回空片段: %s", parsed.get("parse_error"))

    return {
        "success": True,
        "data": {
            "fragment": parsed.get("fragment_en", ""),
            "description_cn": parsed.get("description_cn", ""),
            "ref_path": f"/gen-refs/{safe_filename}",
        },
    }

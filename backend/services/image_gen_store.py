"""
生图任务存储服务 - SQLite 索引 + JSON 文件存储

模式与 rule_store.py / image_library_store.py 保持一致：
- 完整任务数据以 JSON 文件存储在 data/gen/tasks/ 目录
- SQLite 存储索引信息，用于快速查询和筛选
- 下载到本地的图片存储在 data/gen/images/
"""

import base64
import json
import sqlite3
import threading
from pathlib import Path
from typing import Optional, List

from services.file_utils import atomic_write_json

import httpx

from models.image_gen import ImageGenTask

# 数据目录
DATA_DIR = Path(__file__).parent.parent / "data"
GEN_DIR = DATA_DIR / "gen"
GEN_TASKS_DIR = GEN_DIR / "tasks"
GEN_IMAGES_DIR = GEN_DIR / "images"
DB_PATH = DATA_DIR / "rules.db"  # 复用已有的 SQLite 数据库文件

# 生成任务 ID 时用的进程内锁：
# generate_task_id() 原本是"读当前最大编号 -> 算下一个"两步分离，
# 如果两个请求在第一个请求写入数据库之前都执行了"读"，会算出同一个编号，
# 导致后写入的任务把先写入的覆盖掉（版本B和版本C几乎同时点生成时复现过）。
# 用锁把"生成编号"和"用占位文件占住这个编号"合并成一步，杜绝这个竞态。
_task_id_lock = threading.Lock()


def _get_connection() -> sqlite3.Connection:
    """获取 SQLite 连接"""
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_image_gen_db():
    """初始化生图任务的 SQLite 表和目录结构"""
    # 创建必要的目录
    GEN_DIR.mkdir(parents=True, exist_ok=True)
    GEN_TASKS_DIR.mkdir(parents=True, exist_ok=True)
    GEN_IMAGES_DIR.mkdir(parents=True, exist_ok=True)

    conn = _get_connection()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS image_gen_tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id TEXT UNIQUE NOT NULL,
            out_task_id TEXT NOT NULL,
            rule_id TEXT NOT NULL,
            rule_name TEXT DEFAULT '',
            version TEXT DEFAULT '',
            status TEXT NOT NULL DEFAULT 'pending',
            prompt_positive TEXT DEFAULT '',
            prompt_negative TEXT DEFAULT '',
            width INTEGER DEFAULT 1024,
            height INTEGER DEFAULT 1024,
            image_urls TEXT DEFAULT '[]',
            local_images TEXT DEFAULT '[]',
            error TEXT DEFAULT '',
            estimated_credits REAL DEFAULT 0,
            created_at TEXT NOT NULL,
            completed_at TEXT DEFAULT '',
            json_path TEXT NOT NULL
        )
    """)
    # 兼容已有数据库：旧表可能没有 rule_name/version/used_reference 列，用 ALTER TABLE 补上
    existing_cols = {row["name"] for row in conn.execute("PRAGMA table_info(image_gen_tasks)").fetchall()}
    if "rule_name" not in existing_cols:
        conn.execute("ALTER TABLE image_gen_tasks ADD COLUMN rule_name TEXT DEFAULT ''")
    if "version" not in existing_cols:
        conn.execute("ALTER TABLE image_gen_tasks ADD COLUMN version TEXT DEFAULT ''")
    if "used_reference" not in existing_cols:
        # #7：INTEGER 存布尔（SQLite 惯例），0=False/1=True
        conn.execute("ALTER TABLE image_gen_tasks ADD COLUMN used_reference INTEGER DEFAULT 0")
    # 创建索引加速查询
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_gen_tasks_rule_id
        ON image_gen_tasks(rule_id)
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_gen_tasks_status
        ON image_gen_tasks(status)
    """)
    conn.commit()
    conn.close()


def save_task(task: ImageGenTask) -> None:
    """
    保存生图任务：
    1. 将完整数据写入 data/gen/tasks/{task_id}.json
    2. 将索引信息写入 SQLite
    """
    GEN_TASKS_DIR.mkdir(parents=True, exist_ok=True)

    # 保存 JSON 文件（原子写，防进程中断截断）
    json_path = GEN_TASKS_DIR / f"{task.task_id}.json"
    atomic_write_json(json_path, task.model_dump())

    # 写入 SQLite 索引
    conn = _get_connection()
    conn.execute("""
        INSERT OR REPLACE INTO image_gen_tasks
        (task_id, out_task_id, rule_id, rule_name, version, status, prompt_positive, prompt_negative,
         width, height, image_urls, local_images, error, estimated_credits,
         created_at, completed_at, used_reference, json_path)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        task.task_id,
        task.out_task_id,
        task.rule_id,
        task.rule_name,
        task.version,
        task.status,
        task.prompt_positive,
        task.prompt_negative,
        task.width,
        task.height,
        json.dumps(task.image_urls, ensure_ascii=False),
        json.dumps(task.local_images, ensure_ascii=False),
        task.error,
        task.estimated_credits,
        task.created_at,
        task.completed_at,
        1 if task.used_reference else 0,
        str(json_path),
    ))
    conn.commit()
    conn.close()


def get_task(task_id: str) -> Optional[ImageGenTask]:
    """读取单个生图任务

    如果该 task_id 目前还只是 generate_task_id() 创建的占位文件
    （真正的任务数据还没被 save_task() 写入），返回 None，
    调用方应视为"任务不存在/尚未就绪"，不要当成一个空任务处理。
    """
    json_path = GEN_TASKS_DIR / f"{task_id}.json"
    if not json_path.exists():
        return None

    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    if data.get("_placeholder"):
        return None

    return ImageGenTask(**data)


def update_task(task_id: str, updates: dict) -> bool:
    """
    更新生图任务的指定字段。

    参数:
        task_id: 任务ID
        updates: 要更新的字段字典，例如 {"status": "completed", "image_urls": [...]}

    返回:
        是否更新成功
    """
    task = get_task(task_id)
    if task is None:
        return False

    # 更新字段
    task_dict = task.model_dump()
    task_dict.update(updates)
    updated_task = ImageGenTask(**task_dict)

    # 重新保存
    save_task(updated_task)
    return True


def list_tasks(
    rule_id: Optional[str] = None,
    status: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
) -> dict:
    """
    列表查询生图任务，支持分页和筛选。

    参数:
        rule_id: 按关联规则筛选
        status: 按状态筛选
        page: 页码（从1开始）
        page_size: 每页数量

    返回:
        包含 items, total, page, page_size, total_pages 的字典
    """
    conn = _get_connection()

    # 构建查询条件
    conditions = []
    params = []  # type: List

    if rule_id:
        conditions.append("rule_id = ?")
        params.append(rule_id)
    if status:
        conditions.append("status = ?")
        params.append(status)

    where_clause = ""
    if conditions:
        where_clause = "WHERE " + " AND ".join(conditions)

    # 查询总数
    count_sql = f"SELECT COUNT(*) as total FROM image_gen_tasks {where_clause}"
    total = conn.execute(count_sql, params).fetchone()["total"]

    # 分页查询
    offset = (page - 1) * page_size
    query_sql = f"""
        SELECT task_id, out_task_id, rule_id, rule_name, version, status,
               prompt_positive, prompt_negative, width, height,
               image_urls, local_images, error, estimated_credits,
               created_at, completed_at, used_reference
        FROM image_gen_tasks
        {where_clause}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
    """
    query_params = params + [page_size, offset]
    rows = conn.execute(query_sql, query_params).fetchall()
    conn.close()

    # 组装结果
    items = []
    for row in rows:
        items.append({
            "task_id": row["task_id"],
            "out_task_id": row["out_task_id"],
            "rule_id": row["rule_id"],
            "rule_name": row["rule_name"] or "",
            "version": row["version"] or "",
            "status": row["status"],
            "prompt_positive": row["prompt_positive"],
            "prompt_negative": row["prompt_negative"],
            "width": row["width"],
            "height": row["height"],
            "image_urls": json.loads(row["image_urls"]),
            "local_images": json.loads(row["local_images"]),
            "error": row["error"],
            "estimated_credits": row["estimated_credits"],
            "created_at": row["created_at"],
            "completed_at": row["completed_at"],
            "used_reference": bool(row["used_reference"]),
        })

    total_pages = (total + page_size - 1) // page_size if page_size > 0 else 0

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
    }


def delete_task(task_id: str) -> bool:
    """
    删除生图任务及其相关文件。

    参数:
        task_id: 任务ID

    返回:
        是否删除成功
    """
    # 先读取任务信息，用于清理本地图片
    task = get_task(task_id)

    # 删除 JSON 文件
    json_path = GEN_TASKS_DIR / f"{task_id}.json"
    if json_path.exists():
        json_path.unlink()

    # 删除 SQLite 索引
    conn = _get_connection()
    cursor = conn.execute("DELETE FROM image_gen_tasks WHERE task_id = ?", (task_id,))
    deleted = cursor.rowcount > 0
    conn.commit()
    conn.close()

    # 删除已下载的本地图片
    if task and task.local_images:
        for img_path in task.local_images:
            p = Path(img_path)
            if p.exists():
                p.unlink()

    return deleted


async def download_images(task_id: str) -> List[str]:
    """
    下载远端图片到本地 data/gen/images/ 目录。

    参数:
        task_id: 任务ID

    返回:
        下载成功的本地图片路径列表

    异常:
        Exception: 任务不存在或未完成时抛出
    """
    task = get_task(task_id)
    if task is None:
        raise Exception(f"任务 {task_id} 不存在")

    if task.status != "completed":
        raise Exception(f"任务 {task_id} 尚未完成（当前状态: {task.status}）")

    if not task.image_urls:
        raise Exception(f"任务 {task_id} 没有可下载的图片")

    GEN_IMAGES_DIR.mkdir(parents=True, exist_ok=True)

    downloaded = []
    async with httpx.AsyncClient(timeout=60.0) as client:
        for idx, url in enumerate(task.image_urls):
            try:
                if url.startswith("data:"):
                    # data URI（OpenAI b64_json 模式）：httpx 不支持 data scheme，
                    # 必然抛异常被下面的 except 吞掉、返回空列表。这里直接 base64
                    # 解码落盘，绕开 httpx。格式：data:[<mediatype>][;base64],<data>
                    header, b64data = url.split(",", 1)
                    # 从 "data:image/png;base64" 提取 MIME "image/png"
                    mime = header.split(":")[1].split(";")[0] if ":" in header else ""
                    if "png" in mime:
                        ext = ".png"
                    elif "webp" in mime:
                        ext = ".webp"
                    elif "gif" in mime:
                        ext = ".gif"
                    else:
                        ext = ".jpg"
                    content = base64.b64decode(b64data)
                else:
                    resp = await client.get(url)
                    if resp.status_code != 200:
                        continue

                    # 根据 Content-Type 判断扩展名
                    content_type = resp.headers.get("content-type", "")
                    if "png" in content_type:
                        ext = ".png"
                    elif "webp" in content_type:
                        ext = ".webp"
                    else:
                        ext = ".jpg"
                    content = resp.content

                # 保存到本地
                filename = f"{task_id}_{idx}{ext}"
                filepath = GEN_IMAGES_DIR / filename
                with open(filepath, "wb") as f:
                    f.write(content)

                downloaded.append(str(filepath))
            except Exception:
                # 单张下载失败不影响其他图片
                continue

    # 更新任务的本地图片路径
    if downloaded:
        update_task(task_id, {"local_images": downloaded})

    return downloaded


def generate_task_id() -> str:
    """
    生成下一个任务 ID（GEN-0001 递增格式），并立刻创建占位 JSON 文件占住这个编号。

    "读取最大编号"和"占用编号"合并在同一把锁内完成：
    没有这把锁的话，两个几乎同时到达的请求都可能在对方写入数据库/占位文件之前
    读到同一个"当前最大编号"，从而算出同一个 task_id，后完成的一次会直接覆盖
    先完成的那次结果（版本B和版本C同时点"生成图片"时复现过）。

    占位文件内容是 {"task_id": ..., "_placeholder": true}，
    调用方（submit_gen_task）随后会用 save_task() 写入真正的任务数据覆盖占位内容；
    get_task() 对占位文件返回 None，避免调用方读到半成品数据。
    """
    with _task_id_lock:
        conn = _get_connection()

        # 查询当前最大 task_id（数据库里的 + 占位文件里的，取较大值）
        row = conn.execute(
            "SELECT task_id FROM image_gen_tasks ORDER BY id DESC LIMIT 1"
        ).fetchone()

        max_num = 0
        if row:
            try:
                max_num = int(row["task_id"].split("-")[1])
            except (IndexError, ValueError):
                pass

        # 数据库为空或解析失败时，也检查目录中已有的 JSON 文件（含占位文件）
        GEN_TASKS_DIR.mkdir(parents=True, exist_ok=True)
        for f in GEN_TASKS_DIR.glob("GEN-*.json"):
            try:
                num = int(f.stem.split("-")[1])
                max_num = max(max_num, num)
            except (IndexError, ValueError):
                continue

        conn.close()

        next_id = f"GEN-{max_num + 1:04d}"

        # 立刻创建占位文件，占住这个编号 —— 锁释放后，
        # 下一个并发请求的 glob 扫描会看到这个文件，不会再算出同一个编号
        placeholder_path = GEN_TASKS_DIR / f"{next_id}.json"
        with open(placeholder_path, "w", encoding="utf-8") as f:
            json.dump({"task_id": next_id, "_placeholder": True}, f)

        return next_id

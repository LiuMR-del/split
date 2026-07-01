"""
生图任务存储服务 - SQLite 索引 + JSON 文件存储

模式与 rule_store.py / image_library_store.py 保持一致：
- 完整任务数据以 JSON 文件存储在 data/gen/tasks/ 目录
- SQLite 存储索引信息，用于快速查询和筛选
- 下载到本地的图片存储在 data/gen/images/
"""

import json
import sqlite3
from pathlib import Path
from typing import Optional, List

import httpx

from models.image_gen import ImageGenTask

# 数据目录
DATA_DIR = Path(__file__).parent.parent / "data"
GEN_DIR = DATA_DIR / "gen"
GEN_TASKS_DIR = GEN_DIR / "tasks"
GEN_IMAGES_DIR = GEN_DIR / "images"
DB_PATH = DATA_DIR / "rules.db"  # 复用已有的 SQLite 数据库文件


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

    # 保存 JSON 文件
    json_path = GEN_TASKS_DIR / f"{task.task_id}.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(task.model_dump(), f, ensure_ascii=False, indent=2)

    # 写入 SQLite 索引
    conn = _get_connection()
    conn.execute("""
        INSERT OR REPLACE INTO image_gen_tasks
        (task_id, out_task_id, rule_id, status, prompt_positive, prompt_negative,
         width, height, image_urls, local_images, error, estimated_credits,
         created_at, completed_at, json_path)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        task.task_id,
        task.out_task_id,
        task.rule_id,
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
        str(json_path),
    ))
    conn.commit()
    conn.close()


def get_task(task_id: str) -> Optional[ImageGenTask]:
    """读取单个生图任务"""
    json_path = GEN_TASKS_DIR / f"{task_id}.json"
    if not json_path.exists():
        return None

    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)
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
        SELECT task_id, out_task_id, rule_id, status,
               prompt_positive, prompt_negative, width, height,
               image_urls, local_images, error, estimated_credits,
               created_at, completed_at
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

                # 保存到本地
                filename = f"{task_id}_{idx}{ext}"
                filepath = GEN_IMAGES_DIR / filename
                with open(filepath, "wb") as f:
                    f.write(resp.content)

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
    生成下一个任务 ID（GEN-0001 递增格式）。
    查询 SQLite 获取当前最大编号。
    """
    conn = _get_connection()

    # 查询当前最大 task_id
    row = conn.execute(
        "SELECT task_id FROM image_gen_tasks ORDER BY id DESC LIMIT 1"
    ).fetchone()
    conn.close()

    if row:
        current_id = row["task_id"]
        try:
            num = int(current_id.split("-")[1])
            return f"GEN-{num + 1:04d}"
        except (IndexError, ValueError):
            pass

    # 如果数据库为空或解析失败，检查目录中的 JSON 文件
    existing = list(GEN_TASKS_DIR.glob("GEN-*.json"))
    if existing:
        nums = []
        for f in existing:
            try:
                num = int(f.stem.split("-")[1])
                nums.append(num)
            except (IndexError, ValueError):
                continue
        if nums:
            return f"GEN-{max(nums) + 1:04d}"

    return "GEN-0001"

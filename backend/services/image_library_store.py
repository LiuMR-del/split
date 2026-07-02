"""
图片库存储服务 - SQLite 索引 + JSON 文件存储

模式与 rule_store.py 保持一致：
- 完整数据以 JSON 文件存储在 data/library/ 目录
- SQLite 存储索引信息，用于快速查询和筛选
- 图片存储在 data/library/images/
- 缩略图存储在 data/library/thumbnails/
"""

import json
import sqlite3
from pathlib import Path
from typing import List, Optional, Dict

from models.image_library import ImageTag
from services.vocab_utils import extract_chinese_part

# 数据目录
DATA_DIR = Path(__file__).parent.parent / "data"
LIBRARY_DIR = DATA_DIR / "library"
LIBRARY_JSON_DIR = LIBRARY_DIR
LIBRARY_IMAGES_DIR = LIBRARY_DIR / "images"
LIBRARY_THUMBNAILS_DIR = LIBRARY_DIR / "thumbnails"
DB_PATH = DATA_DIR / "rules.db"  # 复用已有的 SQLite 数据库文件


def _get_connection() -> sqlite3.Connection:
    """获取 SQLite 连接"""
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_image_library_db():
    """初始化图片库的 SQLite 表和目录结构"""
    # 创建必要的目录
    LIBRARY_DIR.mkdir(parents=True, exist_ok=True)
    LIBRARY_IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    LIBRARY_THUMBNAILS_DIR.mkdir(parents=True, exist_ok=True)

    conn = _get_connection()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS image_library (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            image_id TEXT UNIQUE NOT NULL,
            filename TEXT NOT NULL,
            file_path TEXT NOT NULL,
            thumbnail_path TEXT DEFAULT '',
            themes TEXT DEFAULT '[]',
            styles TEXT DEFAULT '[]',
            color_moods TEXT DEFAULT '[]',
            emotions TEXT DEFAULT '[]',
            target_audiences TEXT DEFAULT '[]',
            description TEXT DEFAULT '',
            elements TEXT DEFAULT '[]',
            layout_type TEXT DEFAULT '',
            created_date TEXT NOT NULL,
            ai_tagged INTEGER DEFAULT 0,
            manually_reviewed INTEGER DEFAULT 0,
            json_path TEXT NOT NULL
        )
    """)

    # 兼容已有数据：如果表已存在但缺少 layout_type 列，用 ALTER TABLE 加上
    try:
        conn.execute("SELECT layout_type FROM image_library LIMIT 1")
    except Exception:
        conn.execute("ALTER TABLE image_library ADD COLUMN layout_type TEXT DEFAULT ''")

    conn.commit()
    conn.close()


def save_image(tag: ImageTag) -> None:
    """
    保存图片标签：
    1. 将完整数据写入 data/library/{image_id}.json
    2. 将索引信息写入 SQLite
    """
    LIBRARY_DIR.mkdir(parents=True, exist_ok=True)

    # 保存 JSON 文件
    json_path = LIBRARY_JSON_DIR / f"{tag.image_id}.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(tag.model_dump(), f, ensure_ascii=False, indent=2)

    # 写入 SQLite 索引
    conn = _get_connection()
    conn.execute("""
        INSERT OR REPLACE INTO image_library
        (image_id, filename, file_path, thumbnail_path,
         themes, styles, color_moods, emotions, target_audiences,
         description, elements, layout_type,
         created_date, ai_tagged, manually_reviewed, json_path)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        tag.image_id,
        tag.filename,
        tag.file_path,
        tag.thumbnail_path,
        json.dumps(tag.themes, ensure_ascii=False),
        json.dumps(tag.styles, ensure_ascii=False),
        json.dumps(tag.color_moods, ensure_ascii=False),
        json.dumps(tag.emotions, ensure_ascii=False),
        json.dumps(tag.target_audiences, ensure_ascii=False),
        tag.description,
        json.dumps(tag.elements, ensure_ascii=False),
        tag.layout_type,
        tag.created_date,
        1 if tag.ai_tagged else 0,
        1 if tag.manually_reviewed else 0,
        str(json_path),
    ))
    conn.commit()
    conn.close()


def get_image(image_id: str) -> Optional[ImageTag]:
    """读取单张图片的标签数据"""
    json_path = LIBRARY_JSON_DIR / f"{image_id}.json"
    if not json_path.exists():
        return None

    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return ImageTag(**data)


def list_images(
    theme: Optional[str] = None,
    style: Optional[str] = None,
    color_mood: Optional[str] = None,
    emotion: Optional[str] = None,
    layout_type: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
) -> dict:
    """
    列表查询图片库，支持分页和按标签筛选。

    参数:
        theme: 按主题筛选（模糊匹配）
        style: 按风格筛选（模糊匹配）
        color_mood: 按色彩情绪筛选（模糊匹配）
        emotion: 按情绪筛选（模糊匹配）
        layout_type: 按构图类型筛选（模糊匹配）
        page: 页码（从1开始）
        page_size: 每页数量

    返回:
        包含 items, total, page, page_size, total_pages 的字典
    """
    conn = _get_connection()

    # 构建查询条件
    conditions = []
    params = []

    if theme:
        conditions.append("themes LIKE ?")
        params.append(f"%{theme}%")
    if style:
        conditions.append("styles LIKE ?")
        params.append(f"%{style}%")
    if color_mood:
        conditions.append("color_moods LIKE ?")
        params.append(f"%{color_mood}%")
    if emotion:
        conditions.append("emotions LIKE ?")
        params.append(f"%{emotion}%")
    if layout_type:
        conditions.append("layout_type LIKE ?")
        params.append(f"%{layout_type}%")

    where_clause = ""
    if conditions:
        where_clause = "WHERE " + " AND ".join(conditions)

    # 查询总数
    count_sql = f"SELECT COUNT(*) as total FROM image_library {where_clause}"
    total = conn.execute(count_sql, params).fetchone()["total"]

    # 分页查询
    offset = (page - 1) * page_size
    query_sql = f"""
        SELECT image_id, filename, file_path, thumbnail_path,
               themes, styles, color_moods, emotions, target_audiences,
               description, elements, layout_type,
               created_date, ai_tagged, manually_reviewed
        FROM image_library
        {where_clause}
        ORDER BY created_date DESC
        LIMIT ? OFFSET ?
    """
    query_params = params + [page_size, offset]
    rows = conn.execute(query_sql, query_params).fetchall()
    conn.close()

    # 组装结果
    items = []
    for row in rows:
        items.append({
            "image_id": row["image_id"],
            "filename": row["filename"],
            "file_path": row["file_path"],
            "thumbnail_path": row["thumbnail_path"],
            "themes": json.loads(row["themes"]),
            "styles": json.loads(row["styles"]),
            "color_moods": json.loads(row["color_moods"]),
            "emotions": json.loads(row["emotions"]),
            "target_audiences": json.loads(row["target_audiences"]),
            "description": row["description"],
            "elements": json.loads(row["elements"]),
            "layout_type": row["layout_type"] or "",
            "created_date": row["created_date"],
            "ai_tagged": bool(row["ai_tagged"]),
            "manually_reviewed": bool(row["manually_reviewed"]),
        })

    total_pages = (total + page_size - 1) // page_size if page_size > 0 else 0

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
    }


def update_image(image_id: str, tag: ImageTag) -> bool:
    """更新图片标签，返回是否成功"""
    json_path = LIBRARY_JSON_DIR / f"{image_id}.json"
    if not json_path.exists():
        return False

    # 更新 JSON 文件
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(tag.model_dump(), f, ensure_ascii=False, indent=2)

    # 更新 SQLite 索引
    conn = _get_connection()
    conn.execute("""
        UPDATE image_library
        SET filename = ?, file_path = ?, thumbnail_path = ?,
            themes = ?, styles = ?, color_moods = ?, emotions = ?,
            target_audiences = ?, description = ?, elements = ?,
            layout_type = ?,
            ai_tagged = ?, manually_reviewed = ?
        WHERE image_id = ?
    """, (
        tag.filename,
        tag.file_path,
        tag.thumbnail_path,
        json.dumps(tag.themes, ensure_ascii=False),
        json.dumps(tag.styles, ensure_ascii=False),
        json.dumps(tag.color_moods, ensure_ascii=False),
        json.dumps(tag.emotions, ensure_ascii=False),
        json.dumps(tag.target_audiences, ensure_ascii=False),
        tag.description,
        json.dumps(tag.elements, ensure_ascii=False),
        tag.layout_type,
        1 if tag.ai_tagged else 0,
        1 if tag.manually_reviewed else 0,
        image_id,
    ))
    conn.commit()
    conn.close()
    return True


def delete_image(image_id: str) -> bool:
    """
    删除图片及其所有相关数据：
    - JSON 标签文件
    - SQLite 索引记录
    - 原图和缩略图文件（根据相对 URL 路径反推文件系统路径）
    """
    json_path = LIBRARY_JSON_DIR / f"{image_id}.json"

    # 先读取图片信息，用于后续清理文件
    image_info = get_image(image_id)

    # 删除 JSON 文件
    if json_path.exists():
        json_path.unlink()

    # 删除 SQLite 索引
    conn = _get_connection()
    cursor = conn.execute("DELETE FROM image_library WHERE image_id = ?", (image_id,))
    deleted = cursor.rowcount > 0
    conn.commit()
    conn.close()

    # 删除图片文件和缩略图
    # file_path 格式为 /library-images/xxx，对应磁盘 data/library/images/xxx
    # thumbnail_path 格式为 /library-thumbnails/xxx，对应磁盘 data/library/thumbnails/xxx
    if image_info:
        if image_info.file_path:
            fname = image_info.file_path.split("/")[-1]
            image_file = LIBRARY_IMAGES_DIR / fname
            if image_file.exists():
                image_file.unlink()
        if image_info.thumbnail_path:
            tname = image_info.thumbnail_path.split("/")[-1]
            thumb_file = LIBRARY_THUMBNAILS_DIR / tname
            if thumb_file.exists():
                thumb_file.unlink()

    return deleted


def search_images(query: dict) -> List[ImageTag]:
    """
    多条件搜索图片（主题+风格+色彩+情绪的交集）。

    参数:
        query: 搜索条件字典，可包含：
            - themes: List[str] - 主题关键词
            - styles: List[str] - 风格标签
            - color_moods: List[str] - 色彩情绪
            - emotions: List[str] - 情绪标签
            - target_audiences: List[str] - 目标人群
            - keyword: str - 关键词（在描述和元素中搜索）

    返回:
        匹配的 ImageTag 列表
    """
    conn = _get_connection()

    conditions = []
    params = []

    # 按各维度筛选（JSON 字符串中的模糊匹配）
    themes = query.get("themes", [])
    for t in themes:
        conditions.append("themes LIKE ?")
        params.append(f"%{t}%")

    styles = query.get("styles", [])
    for s in styles:
        conditions.append("styles LIKE ?")
        params.append(f"%{s}%")

    color_moods = query.get("color_moods", [])
    for c in color_moods:
        conditions.append("color_moods LIKE ?")
        params.append(f"%{c}%")

    emotions = query.get("emotions", [])
    for e in emotions:
        conditions.append("emotions LIKE ?")
        params.append(f"%{e}%")

    target_audiences = query.get("target_audiences", [])
    for ta in target_audiences:
        conditions.append("target_audiences LIKE ?")
        params.append(f"%{ta}%")

    keyword = query.get("keyword", "")
    if keyword:
        conditions.append("(description LIKE ? OR elements LIKE ?)")
        params.extend([f"%{keyword}%", f"%{keyword}%"])

    layout_type = query.get("layout_type", "")
    if layout_type:
        conditions.append("layout_type LIKE ?")
        params.append(f"%{layout_type}%")

    where_clause = ""
    if conditions:
        where_clause = "WHERE " + " AND ".join(conditions)

    sql = f"SELECT image_id FROM image_library {where_clause} ORDER BY created_date DESC"
    rows = conn.execute(sql, params).fetchall()
    conn.close()

    # 从 JSON 文件读取完整数据
    results = []
    for row in rows:
        tag = get_image(row["image_id"])
        if tag:
            results.append(tag)

    return results


def recommend_for_rule(rule_card: dict, limit: int = 5) -> list:
    """基于规则卡推荐参考图——以核心卖点为锚点，分维度加权排序

    两轮匹配算法：
    - 第 1 轮：从核心卖点 / 锁定规则提取关键词，过滤出"核心相关"的候选集
    - 第 2 轮：在候选集内按 style / color_mood / layout / theme / emotion
              五个维度分别评分并加权汇总，按总分降序返回

    如果核心候选不够 limit 张，用非核心候选按分数补足。

    参数:
        rule_card: 规则卡字典（RuleCard.model_dump() 的结果）
        limit: 返回的最大数量

    返回:
        按综合得分降序排列的字典列表，每项包含图片数据、score、match_details、match_reason
    """
    # 获取图库中所有图片
    conn = _get_connection()
    rows = conn.execute(
        "SELECT image_id, filename, file_path, thumbnail_path, "
        "themes, styles, color_moods, emotions, target_audiences, "
        "description, elements, layout_type, "
        "created_date, ai_tagged, manually_reviewed "
        "FROM image_library"
    ).fetchall()
    conn.close()

    if not rows:
        return []

    # 第 1 轮：核心卖点过滤
    core_keywords = _extract_core_keywords(rule_card)
    core_candidates = []
    fallback_candidates = []

    for row in rows:
        # 将 SQLite 行转为普通 dict 供后续计算
        image_data = {
            "image_id": row["image_id"],
            "filename": row["filename"],
            "file_path": row["file_path"],
            "thumbnail_path": row["thumbnail_path"],
            "themes": json.loads(row["themes"]),
            "styles": json.loads(row["styles"]),
            "color_moods": json.loads(row["color_moods"]),
            "emotions": json.loads(row["emotions"]),
            "target_audiences": json.loads(row["target_audiences"]),
            "description": row["description"],
            "elements": json.loads(row["elements"]),
            "layout_type": row["layout_type"] or "",
            "created_date": row["created_date"],
            "ai_tagged": bool(row["ai_tagged"]),
            "manually_reviewed": bool(row["manually_reviewed"]),
        }

        # 核心卖点匹配
        is_match, matched_kws = _image_matches_core(image_data, core_keywords)

        # 第 2 轮：分维度加权相似度
        similarity = _weighted_similarity(rule_card, image_data)

        entry = {
            **image_data,
            "score": similarity["total_score"],
            "match_details": similarity["dimension_scores"],
            "core_matched": is_match,
            "core_keywords_matched": matched_kws,
            "match_reason": _build_match_reason_v2(
                similarity["dimension_scores"], matched_kws
            ),
        }

        if is_match:
            core_candidates.append(entry)
        else:
            fallback_candidates.append(entry)

    # 核心候选按分数排序
    core_candidates.sort(key=lambda x: x["score"], reverse=True)

    # 如果核心候选不够 limit，用 fallback 补充
    result = core_candidates[:limit]
    if len(result) < limit:
        fallback_candidates.sort(key=lambda x: x["score"], reverse=True)
        result.extend(fallback_candidates[:limit - len(result)])

    return result


def get_stats() -> dict:
    """
    获取图库统计信息。

    返回:
        包含总数、各标签分布等统计数据的字典
    """
    conn = _get_connection()

    # 总数
    total = conn.execute("SELECT COUNT(*) as total FROM image_library").fetchone()["total"]

    # AI打标数
    ai_tagged = conn.execute(
        "SELECT COUNT(*) as cnt FROM image_library WHERE ai_tagged = 1"
    ).fetchone()["cnt"]

    # 人工审核数
    reviewed = conn.execute(
        "SELECT COUNT(*) as cnt FROM image_library WHERE manually_reviewed = 1"
    ).fetchone()["cnt"]

    # 获取所有记录用于标签统计
    rows = conn.execute(
        "SELECT themes, styles, color_moods, emotions, layout_type FROM image_library"
    ).fetchall()
    conn.close()

    # 统计各标签的分布
    theme_counts = {}  # type: Dict[str, int]
    style_counts = {}  # type: Dict[str, int]
    color_mood_counts = {}  # type: Dict[str, int]
    emotion_counts = {}  # type: Dict[str, int]
    layout_type_counts = {}  # type: Dict[str, int]

    for row in rows:
        for t in json.loads(row["themes"]):
            theme_counts[t] = theme_counts.get(t, 0) + 1
        for s in json.loads(row["styles"]):
            style_counts[s] = style_counts.get(s, 0) + 1
        for c in json.loads(row["color_moods"]):
            color_mood_counts[c] = color_mood_counts.get(c, 0) + 1
        for e in json.loads(row["emotions"]):
            emotion_counts[e] = emotion_counts.get(e, 0) + 1
        lt = row["layout_type"] or ""
        if lt:
            layout_type_counts[lt] = layout_type_counts.get(lt, 0) + 1

    # 按数量降序排列
    def sort_counts(d):
        return sorted(d.items(), key=lambda x: x[1], reverse=True)

    return {
        "total": total,
        "ai_tagged": ai_tagged,
        "manually_reviewed": reviewed,
        "untagged": total - ai_tagged,
        "theme_distribution": sort_counts(theme_counts),
        "style_distribution": sort_counts(style_counts),
        "color_mood_distribution": sort_counts(color_mood_counts),
        "emotion_distribution": sort_counts(emotion_counts),
        "layout_type_distribution": sort_counts(layout_type_counts),
    }


def generate_image_id() -> str:
    """
    生成下一个图片 ID（IMG-0001 递增格式）。
    查询 SQLite 获取当前最大编号。
    """
    conn = _get_connection()

    # 查询当前最大 image_id
    row = conn.execute(
        "SELECT image_id FROM image_library ORDER BY id DESC LIMIT 1"
    ).fetchone()
    conn.close()

    if row:
        # 从 IMG-0001 格式中提取数字
        current_id = row["image_id"]
        try:
            num = int(current_id.split("-")[1])
            return f"IMG-{num + 1:04d}"
        except (IndexError, ValueError):
            pass

    # 如果数据库为空或解析失败，也检查目录中的 JSON 文件
    existing = list(LIBRARY_JSON_DIR.glob("IMG-*.json"))
    if existing:
        nums = []
        for f in existing:
            try:
                num = int(f.stem.split("-")[1])
                nums.append(num)
            except (IndexError, ValueError):
                continue
        if nums:
            return f"IMG-{max(nums) + 1:04d}"

    return "IMG-0001"


# ==================== 内部辅助方法 ====================


def _extract_core_keywords(rule_card: dict) -> list:
    """从规则卡的核心卖点和锁定规则中提取关键词

    按标点和空格拆分，过滤停用词和过短的片段。

    参数:
        rule_card: 规则卡字典

    返回:
        关键词列表
    """
    import re

    core = rule_card.get("layer_0_core", {})
    text = "{} {}".format(
        core.get("core_selling_point", ""),
        core.get("lock_rule", ""),
    )

    # 拆分成词（中文按标点拆，英文按空格拆）
    segments = re.split(r'[，。、；！？\s+/\-,\.!?]+', text)

    # 过滤太短的和常见停用词
    stop_words = {
        '的', '和', '与', '是', '在', '不', '了', '可', '要', '这', '那', '有', '为', '都',
        '让', '把', '被', '从', '到', '能', '会', '将', 'the', 'and', 'or', 'is', 'a', 'an',
        '必须', '保留', '绝对', '不能', '核心', '卖点',
    }
    keywords = [
        s.strip() for s in segments
        if len(s.strip()) >= 2 and s.strip() not in stop_words
    ]
    return keywords


def _image_matches_core(image_data: dict, core_keywords: list) -> tuple:
    """检查图片是否与核心卖点相关

    在图片的 themes / elements / description 中搜索核心关键词（部分匹配）。

    参数:
        image_data: 图片数据字典
        core_keywords: 核心关键词列表

    返回:
        (是否匹配, 匹配到的关键词列表)
    """
    searchable_text = ' '.join([
        ' '.join(image_data.get('themes', [])),
        ' '.join(image_data.get('elements', [])),
        image_data.get('description', ''),
    ]).lower()

    matched = [kw for kw in core_keywords if kw.lower() in searchable_text]
    return (len(matched) > 0, matched)


def _weighted_similarity(rule_card: dict, image_data: dict) -> dict:
    """分维度计算加权相似度

    五个维度：style(0.35) / color_mood(0.20) / layout(0.20) / theme(0.15) / emotion(0.10)

    参数:
        rule_card: 规则卡字典
        image_data: 图片数据字典

    返回:
        包含 total_score 和 dimension_scores 的字典
    """
    weights = {
        'style': 0.35,
        'color_mood': 0.20,
        'layout': 0.20,
        'theme': 0.15,
        'emotion': 0.10,
    }

    scores = {}

    # 风格匹配（精确匹配，取中文部分比较）
    rule_style = _extract_chinese(
        rule_card.get('layer_2_visual', {}).get('style', '')
    )
    img_styles = [_extract_chinese(s) for s in image_data.get('styles', [])]
    scores['style'] = 1.0 if rule_style and rule_style in img_styles else 0.0

    # 色彩匹配（精确匹配）
    rule_color = _extract_chinese(
        rule_card.get('layer_2_visual', {}).get('color_mood', '')
    )
    img_colors = [_extract_chinese(c) for c in image_data.get('color_moods', [])]
    scores['color_mood'] = 1.0 if rule_color and rule_color in img_colors else 0.0

    # 构图匹配（包含关系，因为描述可能不完全一样）
    rule_layout = _extract_chinese(
        rule_card.get('layer_2_visual', {}).get('layout_formula', '')
    )
    img_layout = _extract_chinese(image_data.get('layout_type', ''))
    if rule_layout and img_layout:
        scores['layout'] = 1.0 if (
            img_layout in rule_layout or rule_layout in img_layout
        ) else 0.0
    else:
        scores['layout'] = 0.0

    # 主题/元素匹配（Jaccard）
    rule_themes = set()
    for elem in rule_card.get('layer_2_visual', {}).get('must_have_elements', []):
        if isinstance(elem, dict):
            slot = elem.get('slot', '').lower()
            desc = elem.get('description', '').lower()
            if slot:
                rule_themes.add(slot)
            if desc:
                rule_themes.add(desc)
    img_themes = set(t.lower() for t in image_data.get('themes', []))
    img_elements = set(e.lower() for e in image_data.get('elements', []))
    img_all = img_themes | img_elements
    if rule_themes and img_all:
        intersection = len(rule_themes & img_all)
        union = len(rule_themes | img_all)
        scores['theme'] = intersection / union if union > 0 else 0.0
    else:
        scores['theme'] = 0.0

    # 情绪匹配（Jaccard）
    rule_emotions = set(
        _extract_chinese(e)
        for e in rule_card.get('layer_1_commercial', {}).get('core_emotion', [])
    )
    rule_emotions.discard('')
    img_emotions = set(
        _extract_chinese(e) for e in image_data.get('emotions', [])
    )
    img_emotions.discard('')
    if rule_emotions and img_emotions:
        intersection = len(rule_emotions & img_emotions)
        union = len(rule_emotions | img_emotions)
        scores['emotion'] = intersection / union if union > 0 else 0.0
    else:
        scores['emotion'] = 0.0

    # 加权总分
    total = sum(scores[k] * weights[k] for k in weights)

    return {
        'total_score': round(total, 4),
        'dimension_scores': {k: round(scores[k], 2) for k in scores},
    }


def _build_match_reason_v2(dimension_scores: dict, core_keywords: list) -> str:
    """生成可读的匹配原因（v2 版本，支持核心关键词信息）

    参数:
        dimension_scores: 各维度分数
        core_keywords: 匹配到的核心关键词列表

    返回:
        匹配原因描述字符串
    """
    reasons = []
    if core_keywords:
        reasons.append("核心相关：{}".format(', '.join(core_keywords[:3])))
    dim_names = {
        'style': '风格',
        'color_mood': '色彩',
        'layout': '构图',
        'theme': '主题',
        'emotion': '情绪',
    }
    matched_dims = [dim_names[k] for k, v in dimension_scores.items() if v > 0]
    if matched_dims:
        reasons.append("{}匹配".format('、'.join(matched_dims)))
    return '；'.join(reasons) if reasons else '弱匹配'


def _extract_chinese(text: str) -> str:
    """从 '中文/English' 格式提取中文部分（委托给共享的 vocab_utils）"""
    return extract_chinese_part(text)

"""
用户偏好存储服务 - 单 JSON 文件（无 SQLite 索引、无递增 ID）

存"跨规则卡通用"的两类偏好：
- custom_products：用户在 A/B/C 版本"✏️ 自定义"手填过的目标产品名
- custom_size_presets / last_size：生图区手动输入过的尺寸预设、上次用的尺寸

与 rule_store / image_library_store / image_gen_store 的双写模式不同，这里数据量
极小（各 20 条上限）且不需要筛选排序，所以只用一个 JSON 文件，不建 SQLite 索引。
也没有递增 ID，因此不需要占位文件机制——进程内锁 + 原子写足够。

⚠️ 单进程部署约束：_LOCK 是进程内锁，依赖 uvicorn 单 worker 单进程（见 CLAUDE.md）。

容错原则（与前端 lib/localStorage.ts 的防御精神一致）：读取侧做 shape 校验，
损坏字段静默丢弃不抛错——偏好是"锦上添花"的数据，任何情况下都不能让接口 500 或
阻断生成/生图主流程。
"""

import copy
import json
import threading
from pathlib import Path
from typing import Optional, List

from services.file_utils import atomic_write_json

# 数据文件路径
DATA_DIR = Path(__file__).parent.parent / "data"
PREFS_PATH = DATA_DIR / "user_prefs.json"

# 写操作的进程内锁：load -> 修改 -> 原子写 是 read-then-write，
# 不加锁时两个并发请求（比如用户同屏在两个版本各点一次生成）会互相覆盖丢失更新。
_LOCK = threading.Lock()

# 默认空偏好（读取失败/文件不存在时返回它的深拷贝，不能直接返回，防调用方改到常量）
DEFAULT_PREFS = {
    "custom_products": [],
    "custom_size_presets": [],
    "last_size": None,
}

# 各列表的条数上限（超出挤掉最旧的）
MAX_PRODUCTS = 20
MAX_SIZE_PRESETS = 20
# 单条长度上限
MAX_PRODUCT_LEN = 100
MAX_LABEL_LEN = 50
# 尺寸取值范围
MIN_DIMENSION = 1
MAX_DIMENSION = 10000


def _coerce_dimension(value) -> Optional[int]:
    """把 width/height 转成合法 int，非法返回 None。

    JSON 里可能是 float（比如手工编辑写成 1024.0），取 int；
    bool 是 int 的子类但显然不是尺寸，明确排除。
    """
    if isinstance(value, bool):
        return None
    if not isinstance(value, (int, float)):
        return None
    num = int(value)
    if num < MIN_DIMENSION or num > MAX_DIMENSION:
        return None
    return num


def _sanitize_products(raw) -> List[str]:
    """校验 custom_products：只保留非空字符串，去重保序。"""
    if not isinstance(raw, list):
        return []
    result: List[str] = []
    seen = set()
    for item in raw:
        if not isinstance(item, str):
            continue
        name = item.strip()
        if not name or name in seen:
            continue
        seen.add(name)
        result.append(name)
    return result[:MAX_PRODUCTS]


def _sanitize_size_presets(raw) -> List[dict]:
    """校验 custom_size_presets：只保留 {label:非空str, width:int, height:int}，按 label 去重保序。"""
    if not isinstance(raw, list):
        return []
    result: List[dict] = []
    seen = set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        label = item.get("label")
        if not isinstance(label, str):
            continue
        label = label.strip()
        if not label or label in seen:
            continue
        width = _coerce_dimension(item.get("width"))
        height = _coerce_dimension(item.get("height"))
        if width is None or height is None:
            continue
        seen.add(label)
        result.append({"label": label, "width": width, "height": height})
    return result[:MAX_SIZE_PRESETS]


def _sanitize_last_size(raw) -> Optional[dict]:
    """校验 last_size：不满足 {preset:str, width:int, height:int} 则置 None。

    preset 允许空串（表示手动输入模式，没选任何预设）。
    """
    if not isinstance(raw, dict):
        return None
    preset = raw.get("preset")
    if not isinstance(preset, str):
        return None
    width = _coerce_dimension(raw.get("width"))
    height = _coerce_dimension(raw.get("height"))
    if width is None or height is None:
        return None
    return {"preset": preset, "width": width, "height": height}


def load_prefs() -> dict:
    """读取用户偏好。

    文件不存在 / JSON 损坏 / 顶层不是 dict → 返回默认空偏好（不抛错）。
    每个字段独立做 shape 校验，某个字段损坏只丢弃该字段，其余照常返回。
    """
    if not PREFS_PATH.exists():
        return copy.deepcopy(DEFAULT_PREFS)
    try:
        with open(PREFS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        # JSON 损坏（进程被杀截断/手工误编辑）→ 当作空偏好，下次写入会重建成合法文件
        return copy.deepcopy(DEFAULT_PREFS)
    if not isinstance(data, dict):
        return copy.deepcopy(DEFAULT_PREFS)
    return {
        "custom_products": _sanitize_products(data.get("custom_products")),
        "custom_size_presets": _sanitize_size_presets(data.get("custom_size_presets")),
        "last_size": _sanitize_last_size(data.get("last_size")),
    }


def _save_prefs(prefs: dict) -> None:
    """原子写偏好文件（调用方必须已持有 _LOCK）。"""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    atomic_write_json(PREFS_PATH, prefs)


def add_custom_product(name: str) -> List[str]:
    """新增一个自定义产品名（去重、最新在前、截断 MAX_PRODUCTS）。返回更新后的列表。

    name 为空或超长抛 ValueError（路由转 400）。
    已存在时先移除再插头部，实现"最近用过的排前面"。
    """
    cleaned = (name or "").strip()
    if not cleaned:
        raise ValueError("产品名不能为空")
    if len(cleaned) > MAX_PRODUCT_LEN:
        raise ValueError(f"产品名过长（最多 {MAX_PRODUCT_LEN} 字符）")

    with _LOCK:
        prefs = load_prefs()
        products = [p for p in prefs["custom_products"] if p != cleaned]
        products.insert(0, cleaned)
        prefs["custom_products"] = products[:MAX_PRODUCTS]
        _save_prefs(prefs)
        return prefs["custom_products"]


def remove_custom_product(name: str) -> List[str]:
    """删除一个自定义产品名（幂等：不存在也不报错）。返回更新后的列表。"""
    cleaned = (name or "").strip()
    with _LOCK:
        prefs = load_prefs()
        prefs["custom_products"] = [p for p in prefs["custom_products"] if p != cleaned]
        _save_prefs(prefs)
        return prefs["custom_products"]


def add_custom_size(label: str, width: int, height: int) -> List[dict]:
    """新增/更新一个自定义尺寸预设（按 label 去重，同名视为更新）。返回更新后的列表。

    label 为空/超长、width/height 越界抛 ValueError（路由转 400）。
    """
    cleaned = (label or "").strip()
    if not cleaned:
        raise ValueError("尺寸名称不能为空")
    if len(cleaned) > MAX_LABEL_LEN:
        raise ValueError(f"尺寸名称过长（最多 {MAX_LABEL_LEN} 字符）")
    w = _coerce_dimension(width)
    h = _coerce_dimension(height)
    if w is None or h is None:
        raise ValueError(f"宽高必须是 {MIN_DIMENSION}~{MAX_DIMENSION} 之间的数字")

    with _LOCK:
        prefs = load_prefs()
        presets = [p for p in prefs["custom_size_presets"] if p["label"] != cleaned]
        presets.insert(0, {"label": cleaned, "width": w, "height": h})
        prefs["custom_size_presets"] = presets[:MAX_SIZE_PRESETS]
        _save_prefs(prefs)
        return prefs["custom_size_presets"]


def remove_custom_size(label: str) -> List[dict]:
    """删除一个自定义尺寸预设（幂等）。返回更新后的列表。"""
    cleaned = (label or "").strip()
    with _LOCK:
        prefs = load_prefs()
        prefs["custom_size_presets"] = [
            p for p in prefs["custom_size_presets"] if p["label"] != cleaned
        ]
        _save_prefs(prefs)
        return prefs["custom_size_presets"]


def set_last_size(preset: str, width: int, height: int) -> dict:
    """记住"上次使用的尺寸"。返回写入后的 last_size。

    preset 允许空串（手动输入模式）；width/height 越界抛 ValueError。
    """
    w = _coerce_dimension(width)
    h = _coerce_dimension(height)
    if w is None or h is None:
        raise ValueError(f"宽高必须是 {MIN_DIMENSION}~{MAX_DIMENSION} 之间的数字")

    last = {"preset": (preset or "").strip(), "width": w, "height": h}
    with _LOCK:
        prefs = load_prefs()
        prefs["last_size"] = last
        _save_prefs(prefs)
        return last

"""
受控词表路由
- GET /api/vocabularies → 返回所有受控词表数据
"""

import json
from pathlib import Path
from fastapi import APIRouter

router = APIRouter()

# 词表文件目录
VOCAB_DIR = Path(__file__).parent.parent / "vocabularies"

# 词表文件名到 key 的映射
VOCAB_FILES = [
    "target_audience",
    "use_scenario",
    "core_emotion",
    "style",
    "color_mood",
    "selling_point_type",
    "layout_type",
    # 2026-08-18：产品类型词表（AI 品类识别的受控清单，见 prompts/rule_extraction.py）。
    # 注入分析 prompt 前会转成 `English 中文` 格式，这里按词表原始格式（中文/English）返回
    "product_type",
]


def _load_all_vocabularies() -> dict:
    """加载所有受控词表 JSON 文件"""
    result = {}
    for name in VOCAB_FILES:
        file_path = VOCAB_DIR / f"{name}.json"
        if file_path.exists():
            with open(file_path, "r", encoding="utf-8") as f:
                result[name] = json.load(f)
        else:
            result[name] = []
    return result


@router.get("/vocabularies")
async def get_vocabularies():
    """获取所有受控词表"""
    return _load_all_vocabularies()

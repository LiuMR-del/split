"""
规则卡存储服务 - SQLite 索引 + JSON 文件存储
"""

import json
import sqlite3
from pathlib import Path
from typing import List, Optional

from models.rule_card import RuleCard

# 数据目录
DATA_DIR = Path(__file__).parent.parent / "data"
RULES_DIR = DATA_DIR / "rules"
DB_PATH = DATA_DIR / "rules.db"


def _get_connection() -> sqlite3.Connection:
    """获取 SQLite 连接"""
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """初始化 SQLite 数据库，创建 rules 索引表"""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    RULES_DIR.mkdir(parents=True, exist_ok=True)

    conn = _get_connection()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS rules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            rule_id TEXT UNIQUE NOT NULL,
            rule_name TEXT NOT NULL,
            reuse_level TEXT NOT NULL,
            created_date TEXT NOT NULL,
            thumbnail_path TEXT DEFAULT '',
            core_selling_point TEXT DEFAULT '',
            json_path TEXT NOT NULL
        )
    """)
    conn.commit()
    conn.close()


def save_rule(rule: RuleCard, thumbnail_path: str = "") -> None:
    """
    保存规则卡：
    1. 将完整 JSON 写入 data/rules/{rule_id}.json
    2. 将索引信息写入 SQLite
    """
    RULES_DIR.mkdir(parents=True, exist_ok=True)

    # 保存 JSON 文件
    json_path = RULES_DIR / f"{rule.rule_id}.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(rule.model_dump(), f, ensure_ascii=False, indent=2)

    # 写入 SQLite 索引
    conn = _get_connection()
    conn.execute("""
        INSERT OR REPLACE INTO rules
        (rule_id, rule_name, reuse_level, created_date, thumbnail_path, core_selling_point, json_path)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (
        rule.rule_id,
        rule.rule_name,
        rule.reuse_level,
        rule.created_date,
        thumbnail_path,
        rule.layer_0_core.core_selling_point,
        str(json_path),
    ))
    conn.commit()
    conn.close()


def get_rule(rule_id: str) -> Optional[RuleCard]:
    """读取单条规则卡"""
    json_path = RULES_DIR / f"{rule_id}.json"
    if not json_path.exists():
        return None

    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return RuleCard(**data)


def list_rules(level: Optional[str] = None) -> List[dict]:
    """
    列表查询规则卡索引，支持按复用等级筛选。
    返回简要信息列表（不含完整 JSON）。
    """
    conn = _get_connection()
    if level:
        cursor = conn.execute(
            "SELECT rule_id, rule_name, reuse_level, created_date, thumbnail_path, core_selling_point FROM rules WHERE reuse_level = ? ORDER BY created_date DESC",
            (level,),
        )
    else:
        cursor = conn.execute(
            "SELECT rule_id, rule_name, reuse_level, created_date, thumbnail_path, core_selling_point FROM rules ORDER BY created_date DESC"
        )

    rows = cursor.fetchall()
    conn.close()

    return [
        {
            "rule_id": row["rule_id"],
            "rule_name": row["rule_name"],
            "reuse_level": row["reuse_level"],
            "created_date": row["created_date"],
            "thumbnail_path": row["thumbnail_path"],
            "core_selling_point": row["core_selling_point"],
        }
        for row in rows
    ]


def update_rule(rule_id: str, rule: RuleCard) -> bool:
    """更新规则卡，返回是否成功"""
    json_path = RULES_DIR / f"{rule_id}.json"
    if not json_path.exists():
        return False

    # 更新 JSON 文件
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(rule.model_dump(), f, ensure_ascii=False, indent=2)

    # 更新 SQLite 索引
    conn = _get_connection()
    conn.execute("""
        UPDATE rules
        SET rule_name = ?, reuse_level = ?, core_selling_point = ?
        WHERE rule_id = ?
    """, (
        rule.rule_name,
        rule.reuse_level,
        rule.layer_0_core.core_selling_point,
        rule_id,
    ))
    conn.commit()
    conn.close()
    return True


def delete_rule(rule_id: str) -> bool:
    """删除规则卡，返回是否成功"""
    json_path = RULES_DIR / f"{rule_id}.json"

    # 删除 JSON 文件
    if json_path.exists():
        json_path.unlink()

    # 删除 SQLite 索引
    conn = _get_connection()
    cursor = conn.execute("DELETE FROM rules WHERE rule_id = ?", (rule_id,))
    deleted = cursor.rowcount > 0
    conn.commit()
    conn.close()
    return deleted

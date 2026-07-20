"""文件原子写入工具——防止进程中断损坏 JSON 唯一数据源。"""
import json
import os
from pathlib import Path


def atomic_write_json(path: Path, data: dict, **kwargs) -> None:
    """原子写 JSON：写临时文件 -> flush+fsync -> os.replace 原子替换。

    要么完整写成，要么完全不变，防止进程被杀（Ctrl-C/停止项目.command）时
    JSON 文件截断损坏（JSON 是规则卡/图库/生图任务的唯一完整数据源，SQLite 只是索引）。
    os.replace 在 POSIX 同文件系统上是原子操作。
    """
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, **kwargs)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)

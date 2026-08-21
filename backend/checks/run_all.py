"""一次跑完所有检查（2026-08-21）。

用法:
    python3 checks/run_all.py           # 全部
    python3 checks/run_all.py --quick   # 跳过零回归（它要起子进程 + git show，慢一些）

退出码 0 = 全绿，非 0 = 有检查失败（失败数即退出码）。
"""

import os
import subprocess
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.dirname(_HERE)

# (脚本名, 说明, 是否属于 quick 集)
CHECKS = (
    ("check_element_list.py", "元素清单与可变维度严格一对一", True),
    ("check_no_cjk_in_prompt.py", "图无中文 R1（指令主体）", True),
    ("check_blocked_keywords.py", "blocked 判据双向用例", True),
    ("check_regression.py", "图形类抠图指令零回归（逐字节）", False),
)


def main():
    quick = "--quick" in sys.argv
    failed = []
    for script, desc, in_quick in CHECKS:
        if quick and not in_quick:
            print("== 跳过（--quick）：%s" % desc)
            continue
        proc = subprocess.run([sys.executable, os.path.join(_HERE, script)],
                              cwd=_BACKEND)
        if proc.returncode != 0:
            failed.append(script)
        print()

    if failed:
        print("❌ %d 个检查未通过：%s" % (len(failed), ", ".join(failed)))
        return len(failed)
    print("✅ 全部检查通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())

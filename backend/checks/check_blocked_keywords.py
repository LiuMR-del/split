"""blocked 判据（`_requires_non_latin_text`）的双向用例（2026-08-21）。

**为什么必须双向测**：blocked 是唯一没有 override 的状态——候选一旦被判 blocked，
前端 checkbox 永久禁用、用户无法绕过。所以**误封的代价大于漏封**：
- 漏封 → 生成一张带中文的废图，用户重新生成即可
- 误封 → 一个合法候选永久不可用，用户只能改规则卡数据

这条判据踩过的坑（2026-08-21 代码审查发现）：裸子串匹配让
`arabic` 命中 **Arabic**a（咖啡品种）、`thai` 命中 **Thai**land（国名），
这俩都是 POD 印花高频题材、跟文字系统毫无关系。改用正则词边界修复。

同 CLAUDE.md 里 `_cn_name_overlaps` / `_is_abstract_dimension` 的教训：
**只测一个方向必然往另一个方向翻车**。改判据必须两组用例一起跑。

用法: python3 checks/check_blocked_keywords.py
"""

import sys

from _common import report

from services.prompt_generator import _requires_non_latin_text

# (中文值, 英文平行值, 期望是否 block, 理由)
CASES = [
    # ── 该挡住：语义上就是要求写非拉丁文字 ──
    ("中文纪念短句", "Chinese memorial short quote", True,
     "语义要求写中文（英文值本身纯英文、过得了 CJK 检测，所以只能靠语义判据）"),
    ("日文短句", "Japanese text", True, "语义要求写日文"),
    ("阿拉伯文书法", "Arabic script calligraphy", True, "语义要求写阿语"),
    ("韩文标语", "Korean hangul slogan", True, "语义要求写韩文"),
    ("汉字印章", "Hanzi seal stamp", True, "语义要求写汉字"),

    # ── 不该挡：与文字系统无关，误封会让合法候选永久不可用 ──
    ("阿拉比卡咖啡语录", "Arabica coffee quote", False,
     "Arabica 是咖啡品种，裸子串会命中其中的 arabic"),
    ("泰国旅行标语", "Thailand travel slogan", False,
     "Thailand 是国名，裸子串会命中其中的 thai"),
    ("日式极简文案", "Japanese-style minimal quote", False,
     "-style 说的是版式风格，不是要写日文"),
    ("韩式简约标语", "Korean-style minimal slogan", False, "同上，风格修饰"),
    ("英文追思诗句", "English memorial verse", False, "英文，正常候选"),
    ("思念寄语", "Longing message", False,
     "中文值但不要求写中文——这类靠中→英现翻解决，不该 block"),
    ("12条团队精神短句", "", False,
     "旧卡无英文平行值，靠现翻顶上，不该 block（否则整个维度不可用）"),
]


def main():
    failures = []
    for label_cn, label_en, expect, why in CASES:
        got = _requires_non_latin_text(label_cn, label_en)
        if got != expect:
            kind = "误封（合法候选被永久禁用）" if got else "漏封（会生成非英文文字）"
            failures.append("%s | %s → block=%s 应为 %s ── %s；理由：%s"
                            % (label_cn, label_en or "(无英文值)", got, expect, kind, why))

    block_cases = sum(1 for c in CASES if c[2])
    desc = "%d 组用例（%d 组该挡 + %d 组不该挡）" % (
        len(CASES), block_cases, len(CASES) - block_cases)
    return report("blocked 判据双向用例（该挡的挡住 + 不该挡的别误伤）", desc, failures)


if __name__ == "__main__":
    sys.exit(main())

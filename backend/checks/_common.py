"""验证脚本的共享工具（2026-08-21）。

为什么不是 pytest：这些检查的本质是**拿全库真实规则卡当输入做断言**
（"57 张卡的元素清单必须与可变维度下拉框逐项相等"），不是隔离的单元测试。
数据在 data/rules/*.json 里、会随使用增长，用普通脚本更贴合，也便于
在改动后直接 `python3 checks/xxx.py` 看结果。

每个检查脚本的约定：
- 从 backend/ 目录运行：`python3 checks/check_xxx.py`
- 退出码 0 = 全部通过，1 = 有失败项（便于串起来跑）
- 打印"检查了什么/多少条/失败几条"，失败时打印足够定位的样本
"""

import glob
import json
import os
import re
import sys

# 让脚本能 import services/prompts（从 backend/ 运行时 '.' 已在 path，
# 但直接 `python3 checks/x.py` 时 sys.path[0] 是 checks/，所以显式加上）
_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

RULES_GLOB = os.path.join(_BACKEND_DIR, "data", "rules", "RULE-*.json")

_CJK_RE = re.compile(r"[一-鿿]")


def has_cjk(text):
    """是否含 CJK 汉字（与 services.prompt_generator._module_contains_cjk 同判据）"""
    return bool(_CJK_RE.search(text or ""))


def cjk_fragments(text):
    """取出所有中文片段，失败时用来指出到底哪里有中文"""
    return re.findall(r"[一-鿿]+", text or "")


def iter_rule_cards(require_replaceable=True):
    """遍历全库规则卡。

    参数:
        require_replaceable: 只产出"有第3层可变维度"的卡（多数检查都只关心这些；
            空壳卡/解析失败卡没有维度可校验，跳过避免噪音）

    产出:
        (文件名, 规则卡 dict) 二元组
    """
    for path in sorted(glob.glob(RULES_GLOB)):
        try:
            with open(path, encoding="utf-8") as f:
                card = json.load(f)
        except Exception:
            continue
        # 占位文件是 ID 并发保护的半成品，不是真数据
        if card.get("_placeholder"):
            continue
        if require_replaceable:
            rep = (card.get("layer_3_variable") or {}).get("replaceable_elements") or {}
            if not isinstance(rep, dict) or not rep:
                continue
        yield os.path.basename(path), card


def get_replaceable(card):
    """取第3层可变维度 dict（元素清单与版本C下拉框的共同数据源）"""
    rep = (card.get("layer_3_variable") or {}).get("replaceable_elements") or {}
    return rep if isinstance(rep, dict) else {}


class FakeTranslator:
    """假 AI 客户端：把中文词条按规则译成可断言的英文，用于验证翻译回写链路。

    真 AI 每次结果不同、要花钱、还可能抖动 502，不能用于自动化检查。
    这里用"去掉中文字符"模拟一次**完美翻译**，从而验证的是**回写链路**
    （译文有没有正确替换进 prompt / custom_prompt_template），而不是翻译质量。
    """

    def __init__(self):
        self.calls = 0
        self.last_terms = None

    async def text_request(self, system_prompt, user_prompt, temperature=None):
        self.calls += 1
        match = re.search(r"\[.*?\]", system_prompt, re.S)
        terms = json.loads(match.group(0)) if match else []
        self.last_terms = terms
        out = []
        for t in terms:
            # 去掉中文后若为空，给个占位英文（模拟 AI 总会给出英文）
            en = re.sub(r"[一-鿿]+", " ", t).strip()
            out.append(re.sub(r"\s+", " ", en) or "translated phrase")
        return json.dumps({"translations": out}, ensure_ascii=False)


# 抠图指令里 others 擦除清单的分隔标记。清单里含中文是**既有正常行为**
# （点名用中文定位画面元素，不是要模型画字），所以做"图无中文"检查时
# 必须把这段排除，只看决定"画什么/怎么画"的指令主体。
_OTHERS_HEAD = "You MUST erase these — "
_OTHERS_TAIL_CANDIDATES = (" — plus every OTHER text", " — plus all text")


def split_prompt_body(prompt):
    """把抠图指令拆成 (指令主体, others清单)。

    指令主体 = others 清单之前 + 之后的部分（都是模板里决定语言的地方）。
    取不到 others 标记时整段都算主体。
    """
    prompt = prompt or ""
    if _OTHERS_HEAD not in prompt:
        return prompt, ""
    head, rest = prompt.split(_OTHERS_HEAD, 1)
    for tail_mark in _OTHERS_TAIL_CANDIDATES:
        if tail_mark in rest:
            others, tail = rest.split(tail_mark, 1)
            return head + tail, others
    return head, rest


def report(title, total_desc, failures, max_show=8):
    """统一的结果输出 + 退出码。

    参数:
        title: 检查名（打印在首行）
        total_desc: 检查规模描述（如 "57 卡 / 310 维度 / 1634 变体"）
        failures: 失败项列表，每项是可打印的 tuple/str
    """
    print("== %s" % title)
    print("   范围: %s" % total_desc)
    if not failures:
        print("   ✅ 通过（0 失败）")
        return 0
    print("   ❌ 失败 %d 项：" % len(failures))
    for item in failures[:max_show]:
        print("      %s" % (item,))
    if len(failures) > max_show:
        print("      …… 另有 %d 项" % (len(failures) - max_show))
    return 1

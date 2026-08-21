"""图形类抠图指令的逐字节零回归对比（2026-08-21）。

**这是本项目最有价值的一个检查。** 抠图模板的五段措辞每一段都是实测出来的
（原位擦除 / 白底 / others 点名 / 风格锁定 / 消除 mockup，由来见
prompts/prompt_generation.py 的注释），删任何一段都会让抠图退化——而退化
**只能靠看图发现**，代码层面完全静默。

所以任何改动 `extract_element_list` / `_build_element_variants` /
抠图模板的工作，都要跑这个检查确认"改动前已存在的图形类元素，
产出的指令逐字节没变"。

做法：用 `git show <ref>:path` 取出旧版的两个模块到临时目录，与当前版
在同一批规则卡上跑，逐字节比 extraction_prompt / variants /
custom_prompt_template。

只比图形类（is_text_slot=False）：文字类是 2026-08-21 新增的路径，
旧版根本没有这些条目，比不了。

用法:
    python3 checks/check_regression.py            # 与 HEAD 比
    python3 checks/check_regression.py <git-ref>  # 与指定提交比
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile

from _common import get_replaceable, iter_rule_cards, report

_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_REPO = os.path.dirname(_BACKEND)

# 需要从旧版取出的模块（抠图指令的产出链路）
_TRACKED = (
    "backend/services/prompt_generator.py",
    "backend/prompts/prompt_generation.py",
)


def _build_old_tree(ref):
    """把旧版模块取到临时目录，补齐依赖后返回该目录路径。

    只替换 _TRACKED 里的文件，其余依赖模块直接从当前工作区复制——
    这样比对的是"这两个文件的改动带来的差异"，不掺杂其他改动。
    """
    tmp = tempfile.mkdtemp(prefix="split_regress_")
    for sub in ("services", "prompts"):
        os.makedirs(os.path.join(tmp, sub), exist_ok=True)
        open(os.path.join(tmp, sub, "__init__.py"), "a").close()

    for rel in _TRACKED:
        out = subprocess.run(
            ["git", "show", "%s:%s" % (ref, rel)],
            cwd=_REPO, capture_output=True, text=True,
        )
        if out.returncode != 0:
            shutil.rmtree(tmp, ignore_errors=True)
            raise SystemExit("无法从 %s 取出 %s：%s" % (ref, rel, out.stderr.strip()))
        dst = os.path.join(tmp, rel.split("backend/", 1)[1])
        with open(dst, "w", encoding="utf-8") as f:
            f.write(out.stdout)

    # 补齐当前工作区里旧版会 import 的其他模块
    for sub in ("services", "prompts"):
        src_dir = os.path.join(_BACKEND, sub)
        for fn in os.listdir(src_dir):
            if not fn.endswith(".py"):
                continue
            dst = os.path.join(tmp, sub, fn)
            if not os.path.exists(dst):
                shutil.copy(os.path.join(src_dir, fn), dst)
    return tmp


def _snapshot(extract_fn):
    """跑一遍全库，产出 {(卡名, element_key): 指令三件套} 快照。

    不跑翻译：翻译需要 AI（假客户端的输出与旧版无法对齐），而且翻译只作用于
    文字类，本检查只比图形类，两者不相交。
    """
    snap = {}
    for name, card in iter_rule_cards():
        try:
            elements = extract_fn(card)
        except Exception as e:      # 旧版可能对某些卡抛错，记下来不中断
            snap[(name, "<ERROR>")] = {"error": repr(e)}
            continue
        for el in elements:
            if el.get("is_text_slot"):
                continue
            snap[(name, el["element_key"])] = {
                "extraction": el.get("extraction_prompt"),
                "custom": el.get("custom_prompt_template"),
                "variants": [
                    (v.get("label_cn"), v.get("label_for_prompt"), v.get("prompt"))
                    for v in el.get("variants", [])
                ],
            }
    return snap


def _diff_excerpt(old_text, new_text, span=70):
    """截取两段文本**首个差异点**周围的片段。

    不能简单取开头 N 字：抠图指令前 100+ 字是固定模板，删掉中后段的
    某一句（如"风格锁定"）时开头完全一样，打印出来两行看着一模一样，
    根本没法定位（实测踩过）。
    """
    old_text, new_text = old_text or "", new_text or ""
    i = 0
    while i < min(len(old_text), len(new_text)) and old_text[i] == new_text[i]:
        i += 1
    start = max(0, i - 20)
    mark = "…" if start else ""
    return ("%s%s" % (mark, old_text[start:start + span]),
            "%s%s" % (mark, new_text[start:start + span]),
            i)


def main():
    ref = sys.argv[1] if len(sys.argv) > 1 else "HEAD"

    # 当前版快照
    from services.prompt_generator import extract_element_list as now_extract
    now = _snapshot(now_extract)

    # 旧版快照（在子进程里跑，避免与当前版模块在同一进程里互相污染 sys.modules）
    tmp = _build_old_tree(ref)
    try:
        # ⚠️ sys.path 顺序至关重要：tmp（旧版）必须排在 _BACKEND（当前版）**之前**，
        # 否则子进程 import 到的还是当前版，比对结果永远"逐字节一致"——
        # 这是最危险的假绿（检查看起来在跑、实际什么都没验）。
        # 每次 insert(0, x) 都会把 x 顶到最前，所以要**倒序** insert：
        # 先插最不优先的 checks/，再 _BACKEND，最后 tmp，结束后 tmp 在 [0]。
        script = (
            "import sys, json;"
            "sys.path.insert(0, %r);"      # checks/（拿 _common）
            "sys.path.insert(0, %r);"      # 当前版 backend（补齐未跟踪的依赖）
            "sys.path.insert(0, %r);"      # 旧版 tmp —— 必须最后插，排在最前
            "import importlib;"
            "m = importlib.import_module('services.prompt_generator');"
            "assert m.__file__.startswith(%r), "
            "'旧版模块未生效，实际加载了 ' + m.__file__;"
            "from _common import iter_rule_cards;"
            "out = {};"
            "\nfor name, card in iter_rule_cards():\n"
            "    try:\n"
            "        els = m.extract_element_list(card)\n"
            "    except Exception as e:\n"
            "        out['%%s|<ERROR>' %% name] = {'error': repr(e)}; continue\n"
            "    for el in els:\n"
            "        if el.get('is_text_slot'): continue\n"
            "        out['%%s|%%s' %% (name, el['element_key'])] = {\n"
            "            'extraction': el.get('extraction_prompt'),\n"
            "            'custom': el.get('custom_prompt_template'),\n"
            "            'variants': [[v.get('label_cn'), v.get('label_for_prompt'),"
            " v.get('prompt')] for v in el.get('variants', [])],\n"
            "        }\n"
            "print(json.dumps(out, ensure_ascii=False))"
        ) % (os.path.join(_BACKEND, "checks"), _BACKEND, tmp, tmp)
        proc = subprocess.run([sys.executable, "-c", script],
                              capture_output=True, text=True, cwd=_BACKEND)
        if proc.returncode != 0:
            raise SystemExit("旧版快照生成失败：\n%s" % proc.stderr[-1500:])
        old_raw = json.loads(proc.stdout)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    old = {}
    for k, v in old_raw.items():
        name, key = k.split("|", 1)
        if "variants" in v:
            v["variants"] = [tuple(x) for x in v["variants"]]
        old[(name, key)] = v

    failures = []
    same = removed_l2 = 0
    for key, old_val in old.items():
        if key[1] == "<ERROR>":
            continue
        new_val = now.get(key)
        if new_val is None:
            # `L2::` 前缀 = 来自第 2 层 must_have_elements。2026-08-21 起元素清单
            # 只认第 3 层（为与「可变维度」下拉框严格一对一），这批消失是**有意的**，
            # 不算回归。`L3::` 项消失才是真问题——那意味着某个可变维度被丢了。
            if key[1].startswith("L2::"):
                removed_l2 += 1
            else:
                failures.append("L3 维度消失：%s / %s（可变维度被丢了，破坏一对一）"
                                % key)
            continue
        if old_val.get("extraction") != new_val.get("extraction"):
            o, n, at = _diff_excerpt(old_val.get("extraction"), new_val.get("extraction"))
            failures.append("extraction_prompt 变了：%s / %s（第 %d 字符起）\n"
                            "        旧: %s\n        新: %s"
                            % (key[0], key[1], at, o, n))
        elif old_val.get("variants") != new_val.get("variants"):
            diff = next((
                (a, b) for a, b in zip(old_val["variants"], new_val["variants"]) if a != b
            ), None)
            if diff:
                o, n, at = _diff_excerpt(diff[0][2], diff[1][2])
                failures.append("variants 变了：%s / %s [%s]（第 %d 字符起）\n"
                                "        旧: %s\n        新: %s"
                                % (key[0], key[1], diff[0][0], at, o, n))
            else:
                failures.append("variants 条数变了：%s / %s（%d → %d）"
                                % (key[0], key[1], len(old_val["variants"]),
                                   len(new_val["variants"])))
        elif old_val.get("custom") != new_val.get("custom"):
            o, n, at = _diff_excerpt(old_val.get("custom"), new_val.get("custom"))
            failures.append("custom_prompt_template 变了：%s / %s（第 %d 字符起）\n"
                            "        旧: %s\n        新: %s"
                            % (key[0], key[1], at, o, n))
        else:
            same += 1

    added = len(set(now) - set(old))
    desc = ("与 %s 比：图形类 %d 项逐字节一致 / %d 项有差异 / %d 项本次新增 / "
            "%d 项 L2 来源已按设计移除"
            % (ref, same, len(failures), added, removed_l2))
    code = report("图形类抠图指令零回归（逐字节）", desc, failures)
    if added and not failures:
        print("   ℹ️  新增 %d 项属预期（如原先被判抽象而丢弃的维度重新纳入）" % added)
    return code


if __name__ == "__main__":
    sys.exit(main())

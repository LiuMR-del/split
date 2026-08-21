"""元素拆分清单的结构一致性检查（2026-08-21）。

对应 CLAUDE.md 铁律「元素清单与「可变维度」下拉框严格一对一」。

**最关键的一条是 A**：界面上「🧩 元素变体素材」与「🔧 可变维度」是同一批维度，
用户按这个前提操作（"我下拉框里有 5 个维度，素材区就该有 5 个"）。这两条链路
在代码里是两个函数（extract_element_list / generate_version_c_template），
很容易改一处漏一处——2026-08-21 之前它们各自判断，实测 57 张卡里 56 张不一致。

用法: python3 checks/check_element_list.py
"""

import asyncio
import sys

from _common import (
    FakeTranslator,
    get_replaceable,
    has_cjk,
    iter_rule_cards,
    report,
    split_prompt_body,
)

from services.prompt_generator import (
    PromptGenerator,
    extract_element_list,
    strip_blocked_variant_prompts,
    translate_variant_prompts_to_en,
)


async def main():
    failures = []
    cards = dims = variants = blocked = 0

    generator = PromptGenerator(ai_client=None)   # 版本C 模板不需要 AI（只跳过翻译）

    for name, card in iter_rule_cards():
        cards += 1
        rep = get_replaceable(card)
        elements = extract_element_list(card)
        # 跑完整管线：翻译 + 清空 blocked，检查的是用户真正拿到的数据
        await translate_variant_prompts_to_en(elements, FakeTranslator())
        strip_blocked_variant_prompts(elements)

        # ── A. 与「可变维度」下拉框严格一对一（含顺序）──
        # 直接拿版本C 模板做对比，而不是拿 rep.keys()——那样只证明"和数据源一致"，
        # 证不了"和用户在界面上看到的下拉框一致"（下拉框万一将来加了过滤就漂移了）
        template = await generator.generate_version_c_template(rule_card=card)
        dropdown = [f["field_name"] for f in template.get("selectable_fields", [])]
        listed = [e["element_key"][4:] for e in elements]
        if listed != dropdown:
            failures.append(
                "%s 维度与下拉框不一致 缺=%s 多=%s 顺序异=%s"
                % (name, set(dropdown) - set(listed), set(listed) - set(dropdown),
                   listed != dropdown and set(listed) == set(dropdown))
            )

        dims += len(elements)
        for el in elements:
            key = el["element_key"][4:]
            item = rep.get(key) or {}
            variants += len(el["variants"])

            # ── B. 变体数 = 1（原始）+ 有效 alternatives 数 ──
            expect = 1 + len([
                a for a in (item.get("alternatives") or [])
                if isinstance(a, str) and a.strip()
            ])
            if len(el["variants"]) != expect:
                failures.append("%s/%s 变体数 %d != %d"
                                % (name, el["name_cn"], len(el["variants"]), expect))

            # ── C. 与下拉框的候选数也要相等（同一批候选）──
            field = next((f for f in template.get("selectable_fields", [])
                          if f["field_name"] == key), None)
            if field is not None and len(el["variants"]) != len(field.get("options", [])):
                failures.append("%s/%s 候选数与下拉框不等 %d != %d"
                                % (name, el["name_cn"], len(el["variants"]),
                                   len(field.get("options", []))))

            # ── D. 内部字段不得外泄（_raw 是给 _build_* 读 alternatives 的中间数据）──
            if "_raw" in el:
                failures.append("%s/%s _raw 未剔除（会随 API 响应发给前端）"
                                % (name, el["name_cn"]))

            # ── E. 必备字段齐全（前端按这些字段渲染标注与守卫）──
            for f_name in ("is_abstract", "is_text_slot", "extraction_prompt",
                           "variants", "custom_prompt_template"):
                if f_name not in el:
                    failures.append("%s/%s 缺字段 %s" % (name, el["name_cn"], f_name))

            for v in el["variants"]:
                # ── F. 页面显示用的 label_cn 绝不能空 ──
                # 用户靠它对照翻译，空了界面上就是一行空白
                if not (v.get("label_cn") or "").strip():
                    failures.append("%s/%s label_cn 为空" % (name, el["name_cn"]))

                if v.get("blocked_reason"):
                    blocked += 1
                    # ── G. blocked 项的 prompt 必须已清空 ──
                    if v.get("prompt"):
                        failures.append("%s/%s blocked 项 prompt 未清空"
                                        % (name, el["name_cn"]))
                    continue

                prompt = v.get("prompt") or ""
                if not prompt:
                    failures.append("%s/%s 非 blocked 却没有 prompt"
                                    % (name, el["name_cn"]))
                    continue

                # ── H. 模板按 is_text_slot 正确分支 ──
                # 图形版写死 "plus all text..."，抠文字本身时会把目标文字自己擦掉
                if el["is_text_slot"]:
                    if "plus all text" in prompt:
                        failures.append("%s/%s 文字类误用图形模板"
                                        % (name, el["name_cn"]))
                    if "every OTHER text" not in prompt:
                        failures.append("%s/%s 文字类模板缺 every OTHER text"
                                        % (name, el["name_cn"]))
                elif "plus all text" not in prompt:
                    failures.append("%s/%s 图形类模板被改动（应含 plus all text）"
                                    % (name, el["name_cn"]))

                # ── I. others 清单不能含目标自己（"擦掉X"与"保留X"自相矛盾）──
                # 词级判重对纯数字目标（2012-2026）失效，靠字面子串兜底
                _, others = split_prompt_body(prompt)
                target = el.get("value_for_prompt") or ""
                if target and others and target in others:
                    failures.append("%s/%s others 含目标自己（%s）"
                                    % (name, el["name_cn"], target[:24]))

    desc = "%d 卡 / %d 维度 / %d 变体（其中 %d 个候选 blocked）" % (
        cards, dims, variants, blocked)
    return report("元素清单结构一致性（对齐可变维度下拉框）", desc, failures)


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

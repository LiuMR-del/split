"""「图无中文（R1）」铁律检查：元素拆分路径（2026-08-21）。

铁律：**生成的图里不能出现中文**。但注意本项目有一条容易搞反的区分：

| | 中文 | 说明 |
|---|---|---|
| 页面显示（label_cn / label_translated） | **必须有** | 用户要对照翻译，本检查会确认它没被删 |
| 抠图指令的**主体** | **不能有** | 决定"写什么字/画什么"，中文会被画进图 |
| 抠图指令的 **others 擦除清单** | **允许有** | 点名用中文定位画面元素，既有正常行为 |

所以检查只看指令主体（split_prompt_body 已剔除 others 段）。

**只检查文字类元素**：图形类候选的中文值只是给模型定位"图里哪个东西"
（`REPLACE it with 小兔子`），实测 7 张旧卡 87/87 变体含中文且正常工作，
不是违规——把图形类也拉进来检查会得到一堆假警报。

用法: python3 checks/check_no_cjk_in_prompt.py
"""

import asyncio
import sys

from _common import (
    FakeTranslator,
    cjk_fragments,
    has_cjk,
    iter_rule_cards,
    report,
    split_prompt_body,
)

from services.prompt_generator import (
    extract_element_list,
    strip_blocked_variant_prompts,
    translate_variant_prompts_to_en,
)


async def main():
    failures = []
    text_dims = checked = translated_dims = 0
    display_cn_kept = 0

    for name, card in iter_rule_cards():
        elements = extract_element_list(card)
        needs_translation = any(
            v.get("needs_en_translation")
            for el in elements for v in el["variants"]
        )
        # 模拟一次**完美翻译**，验证的是回写链路而非翻译质量
        await translate_variant_prompts_to_en(elements, FakeTranslator())
        strip_blocked_variant_prompts(elements)
        if needs_translation:
            translated_dims += 1

        for el in elements:
            if not el["is_text_slot"]:
                continue
            text_dims += 1

            # ── A. 自定义变体模板的主体不能含中文 ──
            # 前端 handleAddCustom 只校验**用户输入**不含中文，管不了模板自带的
            # 中文 element_role。漏掉这里 = 用户输入合法英文、指令里仍有中文
            # （2026-08-21 审查发现，RULE-0015/0019/0020 三个维度复现过）
            body, _ = split_prompt_body(el.get("custom_prompt_template") or "")
            if has_cjk(body):
                failures.append("%s/%s custom_prompt_template 主体含中文 %s"
                                % (name, el["name_cn"], cjk_fragments(body)[:3]))

            for v in el["variants"]:
                # ── B. 页面显示的中文必须保留（反向断言）──
                # 防"为了守铁律把中文一起删了"——那会让用户没法对照翻译
                if has_cjk(v.get("label_cn") or ""):
                    display_cn_kept += 1

                if v.get("blocked_reason"):
                    # blocked 项不参与翻译，prompt 应已被清空
                    if v.get("prompt"):
                        failures.append("%s/%s blocked 项 prompt 未清空"
                                        % (name, el["name_cn"]))
                    continue

                checked += 1
                body, _ = split_prompt_body(v.get("prompt") or "")
                if has_cjk(body):
                    failures.append(
                        "%s/%s [%s] 指令主体含中文 %s"
                        % (name, el["name_cn"], (v.get("label_cn") or "")[:16],
                           cjk_fragments(body)[:3])
                    )

                # ── C. 发给模型的候选值本身不能含中文 ──
                if has_cjk(v.get("label_for_prompt") or ""):
                    failures.append("%s/%s label_for_prompt 含中文：%s"
                                    % (name, el["name_cn"], v.get("label_for_prompt")))

    desc = ("%d 个文字类维度 / %d 条指令（%d 张卡触发了中→英现翻）；"
            "页面保留中文的候选 %d 条" % (text_dims, checked, translated_dims,
                                          display_cn_kept))
    code = report("图无中文 R1（元素拆分指令主体）", desc, failures)

    # 页面中文被整体删掉是另一种故障，单独提示（不计入失败，因为可能确实全是英文卡）
    if display_cn_kept == 0 and text_dims > 0:
        print("   ⚠️  没有任何候选的 label_cn 含中文——若非全库都是英文卡，"
              "可能是页面显示的中文被误删了（用户要靠它对照翻译）")
    return code


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

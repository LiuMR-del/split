"""
批量导入 5 条规则卡（阶段 0 验证通过）
运行方式：cd /Users/liu/Downloads/tool/Split/backend && python3 seed_rules.py
"""

import sys
from pathlib import Path

# 确保 backend 目录在 sys.path 中
sys.path.insert(0, str(Path(__file__).parent))

from models.rule_card import (
    RuleCard,
    CoreSellingPoint,
    CommercialLayer,
    VisualStructureLayer,
    MustHaveElement,
    VariableBoundaryLayer,
    ReplaceableItem,
    ProductAdaptationLayer,
    ProductAdaptation,
    DataValidationLayer,
)
from services.rule_store import init_db, save_rule, list_rules

TODAY = "2026-06-30"


def build_rules() -> list[RuleCard]:
    rules = []

    # ── RULE-0001 ──────────────────────────────────────────────
    rules.append(RuleCard(
        rule_id="RULE-0001",
        rule_name="可爱动物+花卉环绕+名字定制规则",
        reuse_level="S",
        source_images=["竞品图_小奶牛毯.jpg"],
        created_date=TODAY,
        last_updated=TODAY,
        layer_0_core=CoreSellingPoint(
            core_selling_point="可爱幼态动物居中 + 花卉/装饰环绕 + 名字个性化定制",
            selling_point_type="个性化定制/Personalization",
            why_it_sells="一只萌萌的动物 + 能印孩子名字 = 完美的儿童个性化礼物。买家觉得印了名字就是'用心准备的'专属礼物",
            lock_rule="必须保留：一只可爱幼态动物居中作为视觉焦点 + 名字个性化 + 干净浅色底的精致礼物感。动物品种可换，但可爱幼态不能变",
        ),
        layer_1_commercial=CommercialLayer(
            target_audience=["妈妈/Mom", "奶奶外婆/Grandma", "朋友/Friends"],
            use_scenario=["生日/Birthday", "新生儿/New Baby", "圣诞节/Christmas", "日常/Everyday"],
            purchase_motivation="印了孩子名字的专属毯子——个性化+可爱=完美的儿童礼物",
            core_emotion=["甜美/Sweet", "可爱/Cute", "温柔/Tender"],
            price_sensitivity="中（礼物型消费，$20-40）",
        ),
        layer_2_visual=VisualStructureLayer(
            layout_formula="主体动物居中 + 花卉/装饰半环绕（上角+下角）+ 名字在主体下方",
            must_have_elements=[
                MustHaveElement(slot="主视觉", description="一只可爱卡通动物，全身站立，微笑表情", position="画面正中央", visual_weight="最重，第一眼看到"),
                MustHaveElement(slot="上方装饰", description="花卉/藤蔓/装饰元素", position="左上角和右上角", visual_weight="中等，营造精致感"),
                MustHaveElement(slot="下方装饰", description="与上方对称的装饰", position="左下角和右下角", visual_weight="中等，呼应上方"),
                MustHaveElement(slot="名字", description="个性化名字，大号粗体", position="主体下方居中", visual_weight="文字中最大"),
                MustHaveElement(slot="背景", description="纯白色/干净底", position="整个画面底色", visual_weight="最轻"),
            ],
            style="柔和水彩/Soft Watercolor",
            color_mood="粉白甜美/Pink White Sweet",
            text_hierarchy="名字最大，无其他文字层级",
        ),
        layer_3_variable=VariableBoundaryLayer(
            replaceable_elements={
                "动物种类": ReplaceableItem(original="小奶牛", alternatives=["小鹿", "小兔子", "小象", "小独角兽", "小恐龙", "小狐狸"]),
                "动物配饰": ReplaceableItem(original="粉色蝴蝶结", alternatives=["花冠", "皇冠", "小帽子", "领结", "无配饰"]),
                "装饰元素": ReplaceableItem(original="白色大花+粉玫瑰+绿叶", alternatives=["藤蔓+绿叶", "星星+月亮", "气球+彩带", "彩虹+云朵"]),
                "色彩方案": ReplaceableItem(original="粉白绿棕（女孩感）", alternatives=["蓝绿橙棕（男孩感）", "黄橙绿（中性活泼）", "紫白绿（优雅）"]),
                "风格": ReplaceableItem(original="柔和水彩", alternatives=["扁平插画", "手绘线描", "复古插画", "3D卡通"]),
                "场景切换": ReplaceableItem(original="通用", alternatives=["圣诞版（加圣诞帽+雪花）", "复活节版（加彩蛋）", "万圣节版（加南瓜）"]),
            },
            must_not_change=["一只可爱动物居中的构图逻辑", "名字个性化", "动物必须可爱幼态", "整体干净精致的礼物感", "白色或浅色干净底"],
        ),
        layer_4_product=ProductAdaptationLayer(adaptations={
            "毛毯": ProductAdaptation(canvas_ratio="3:4 竖版", adaptation_notes="面积大，装饰可丰富，动物可画细节", simplify=[], enhance=["增加装饰密度"]),
            "相框": ProductAdaptation(canvas_ratio="1:1 或 4:5", adaptation_notes="花卉收紧成完整花环，动物缩小，更精致紧凑", simplify=["去掉复杂背景"], enhance=[]),
            "衣服": ProductAdaptation(canvas_ratio="根据印花区域", adaptation_notes="只保留动物+名字，花卉最多一小簇或去掉，远看有识别度", simplify=["大幅简化装饰"], enhance=[]),
            "沙滩巾": ProductAdaptation(canvas_ratio="1:2", adaptation_notes="动物放大，花卉做满版边框，颜色加饱和", simplify=[], enhance=["颜色加饱和", "主体放大"]),
        }),
        layer_5_data=DataValidationLayer(
            source_sales_rank="Amazon 儿童个性化毛毯 BSR 前 500",
            proven_platforms=["Amazon", "Etsy"],
            seasonal_dependency="低（全年可卖）",
            ip_dependency="无",
            reuse_level="S",
            reuse_level_reason="S级：跨产品、跨主题（换动物）、跨性别（换颜色）、跨节日、全年通用",
        ),
    ))

    # ── RULE-0002 ──────────────────────────────────────────────
    rules.append(RuleCard(
        rule_id="RULE-0002",
        rule_name="国旗/国庆拼块徽章规则",
        reuse_level="B",
        source_images=["竞品图_美国250周年毯.jpg"],
        created_date=TODAY,
        last_updated=TODAY,
        layer_0_core=CoreSellingPoint(
            core_selling_point="美国250周年（1776-2026）纪念 + 九宫格拼块徽章",
            selling_point_type="特定事件/Specific Event",
            why_it_sells="2026年是美国建国250周年，限时热点，爱国消费者想要一件有纪念意义的专属物品",
            lock_rule="必须保留250th Anniversary主题、美国国旗色、爱国标志元素（国旗/星/鹰/自由女神），不能换国家不能换事件",
        ),
        layer_1_commercial=CommercialLayer(
            target_audience=["爸爸/Dad", "朋友/Friends"],
            use_scenario=["国庆/National Day", "纪念日/Anniversary"],
            purchase_motivation="表达爱国情怀，纪念国家大事件，个性化名字=专属纪念品",
            core_emotion=["自豪/Proud", "庄重/Dignified", "复古/Vintage", "怀念/Nostalgic"],
            price_sensitivity="中（纪念品消费）",
        ),
        layer_2_visual=VisualStructureLayer(
            layout_formula="九宫格/多宫格拼块布局，每格一个独立徽章图案",
            must_have_elements=[
                MustHaveElement(slot="主题徽章", description="国旗盾牌、大星、椭圆旗纹等", position="上排三个格子", visual_weight="高"),
                MustHaveElement(slot="名字", description="个性化名字", position="中排左格", visual_weight="中"),
                MustHaveElement(slot="核心文案", description="250th Anniversary United States", position="中排中格", visual_weight="最高"),
                MustHaveElement(slot="标志性图案", description="飘扬国旗、自由女神像、鹰徽", position="下排三个格子", visual_weight="高"),
                MustHaveElement(slot="分隔条", description="红白条纹+星星角标", position="格子之间", visual_weight="低"),
            ],
            style="复古拼布/Vintage Quilting",
            color_mood="红蓝白爱国/Red Blue White Patriotic",
            text_hierarchy="核心文案最大 > 名字 > 年份",
        ),
        layer_3_variable=VariableBoundaryLayer(
            replaceable_elements={
                "拼块风格": ReplaceableItem(original="缝制拼布", alternatives=["复古邮票风", "军事臂章风", "木刻版画风"]),
                "质感": ReplaceableItem(original="布面做旧", alternatives=["做旧羊皮纸", "金属浮雕", "皮革压纹"]),
                "辅色": ReplaceableItem(original="金棕色", alternatives=["银色", "铜色"]),
                "附加文案": ReplaceableItem(original="无", alternatives=["We The People", "Land of the Free", "United We Stand"]),
            },
            must_not_change=["美国250周年主题", "红蓝白国旗色", "九宫格拼块构图", "名字个性化", "庄重纪念感"],
        ),
        layer_4_product=ProductAdaptationLayer(adaptations={
            "毛毯": ProductAdaptation(canvas_ratio="3:4", adaptation_notes="拼块风天然适合大面积毛毯", simplify=[], enhance=[]),
            "相框": ProductAdaptation(canvas_ratio="1:1", adaptation_notes="缩减到4格或6格，保留核心徽章", simplify=["减少格数"], enhance=[]),
            "衣服": ProductAdaptation(canvas_ratio="根据印花区", adaptation_notes="只取一个核心徽章，不做满版拼块", simplify=["只保留单个徽章"], enhance=[]),
        }),
        layer_5_data=DataValidationLayer(
            source_sales_rank="Amazon BSR 前 500",
            proven_platforms=["Amazon"],
            seasonal_dependency="高（主要在国庆前后和2026特定年份）",
            ip_dependency="无（国旗/自由女神是公共领域）",
            reuse_level="B",
            reuse_level_reason="B级：拼块构图模式可复用，但内容强绑定美国+250周年特定事件",
        ),
    ))

    # ── RULE-0003 ──────────────────────────────────────────────
    rules.append(RuleCard(
        rule_id="RULE-0003",
        rule_name="暗黑/哥特情侣+趣味文案+名字定制规则",
        reuse_level="A",
        source_images=["竞品图_骷髅手比心毯.jpg"],
        created_date=TODAY,
        last_updated=TODAY,
        layer_0_core=CoreSellingPoint(
            core_selling_point="骷髅手比心形成爱心形状——又酷又甜的暗黑浪漫视觉符号",
            selling_point_type="视觉符号/Visual Symbol",
            why_it_sells="买家就是冲着'骷髅手比心'这个又酷又甜的反差来的——暗黑元素表达甜蜜，叛逆中有温柔",
            lock_rule="必须保留骷髅手比心形成爱心的视觉符号，不能换成其他手势或其他物体。暗黑哥特调性+黑底不能换",
        ),
        layer_1_commercial=CommercialLayer(
            target_audience=["情侣/Couples"],
            use_scenario=["情人节/Valentine's Day", "纪念日/Anniversary", "生日/Birthday", "日常/Everyday"],
            purchase_motivation="我们不是普通情侣，我们有点怪但很甜——用暗黑元素表达甜蜜，反差萌",
            core_emotion=["暗黑浪漫/Dark Romantic", "叛逆/Rebellious", "酷/Cool"],
            price_sensitivity="中（礼物型消费+个性化溢价）",
        ),
        layer_2_visual=VisualStructureLayer(
            layout_formula="中央大型标志性手势 + 内部文字区 + 散落装饰元素满铺背景",
            must_have_elements=[
                MustHaveElement(slot="中央主视觉", description="两只骷髅手比心形成爱心形状", position="正中央，最大元素", visual_weight="最重"),
                MustHaveElement(slot="名字", description="两个人名字", position="爱心内部上方", visual_weight="文字最大"),
                MustHaveElement(slot="趣味文案", description="You're My Favorite Weirdo", position="爱心内部中间", visual_weight="文字中等"),
                MustHaveElement(slot="纪念日期", description="EST. 日期", position="爱心内部底部", visual_weight="文字最小"),
                MustHaveElement(slot="散落装饰", description="大小不一的红色爱心", position="上下两端散落", visual_weight="低"),
            ],
            style="哥特暗黑/Gothic Dark",
            color_mood="黑+红暗黑/Black Red Dark",
            text_hierarchy="名字最大 > 趣味文案 > 日期",
        ),
        layer_3_variable=VariableBoundaryLayer(
            replaceable_elements={
                "散落装饰": ReplaceableItem(original="红色爱心", alternatives=["暗红玫瑰花瓣", "骷髅蝴蝶+星星", "蝙蝠+月亮", "黑色羽毛"]),
                "配色方案": ReplaceableItem(original="黑+白+红", alternatives=["黑+白+紫+银", "黑+白+金", "黑+白+暗绿"]),
                "骷髅手细节": ReplaceableItem(original="无附加", alternatives=["手指戴戒指", "手腕藤蔓缠绕", "手上纹身图案"]),
                "背景效果": ReplaceableItem(original="纯黑色", alternatives=["极暗紫色渐变+星尘", "暗红烟雾", "月光光晕"]),
                "趣味文案": ReplaceableItem(original="You're My Favorite Weirdo", alternatives=["Partners in Crime", "Til Death Do Us Part", "Two Weirdos in Love"]),
            },
            must_not_change=["骷髅手比心形成爱心的视觉符号", "暗黑/哥特整体调性", "两人名字个性化", "纪念日期", "趣味/叛逆感文案", "黑色底"],
        ),
        layer_4_product=ProductAdaptationLayer(adaptations={
            "毛毯": ProductAdaptation(canvas_ratio="3:4", adaptation_notes="黑底+简单图形在毛毯上效果好", simplify=[], enhance=[]),
            "衣服": ProductAdaptation(canvas_ratio="根据印花区", adaptation_notes="暗黑风本来就是服装强项，可只保留中央手势+名字", simplify=["去掉散落爱心"], enhance=[]),
            "马克杯": ProductAdaptation(canvas_ratio="环绕横幅", adaptation_notes="骷髅手比心做杯面主视觉，名字在杯背", simplify=["缩小主视觉"], enhance=[]),
        }),
        layer_5_data=DataValidationLayer(
            source_sales_rank="Amazon 情侣个性化毛毯品类",
            proven_platforms=["Amazon", "Etsy"],
            seasonal_dependency="低（情人节高峰，但纪念日/生日全年有）",
            ip_dependency="无",
            reuse_level="A",
            reuse_level_reason="A级：暗黑情侣是稳定亚文化市场，跨产品（毯+衣+杯），全年有需求",
        ),
    ))

    # ── RULE-0004 ──────────────────────────────────────────────
    rules.append(RuleCard(
        rule_id="RULE-0004",
        rule_name="Bootleg复古T恤风照片拼贴规则",
        reuse_level="A",
        source_images=["竞品图_BestMom照片拼贴毯.jpg"],
        created_date=TODAY,
        last_updated=TODAY,
        layer_0_core=CoreSellingPoint(
            core_selling_point="90年代Bootleg rap tee风格 + 3D金属感大标题 + 照片拼贴",
            selling_point_type="视觉概念/Visual Concept",
            why_it_sells="复古rap tee风格+照片定制=既搞笑又潮酷的致敬礼物。反差感（严肃的演唱会海报风 + 温馨家庭照）是核心吸引力",
            lock_rule="必须保留Bootleg rap tee视觉风格、3D金属感大标题、照片拼贴位、黑底+夸张光效。照片区域是核心不能去掉",
        ),
        layer_1_commercial=CommercialLayer(
            target_audience=["妈妈/Mom", "爸爸/Dad", "奶奶外婆/Grandma"],
            use_scenario=["母亲节/Mother's Day", "父亲节/Father's Day", "生日/Birthday", "圣诞节/Christmas"],
            purchase_motivation="用我们的照片做一份独一无二的纪念品——照片定制=最高级别的个性化",
            core_emotion=["搞笑/Funny", "酷/Cool", "怀念/Nostalgic", "感恩/Grateful"],
            price_sensitivity="中高（照片定制溢价高）",
        ),
        layer_2_visual=VisualStructureLayer(
            layout_formula="顶部3D金属大标题 + 中央大主照片 + 周围环绕小照片 + 闪电/光效背景",
            must_have_elements=[
                MustHaveElement(slot="大标题", description="BEST MOM/DAD Ever（3D金属感闪光文字）", position="顶部最醒目", visual_weight="最高"),
                MustHaveElement(slot="中央主照片", description="最大的照片位（圆形/椭圆裁切）", position="正中央", visual_weight="最重"),
                MustHaveElement(slot="环绕小照片", description="5-6张不同角度/时期的照片位", position="围绕中央主照片", visual_weight="中"),
                MustHaveElement(slot="光效背景", description="闪电/光芒/星光效果", position="整个背景", visual_weight="低"),
            ],
            style="Bootleg复古T恤/Bootleg Vintage Tee",
            color_mood="黑+红暗黑/Black Red Dark",
            text_hierarchy="3D金属大标题最醒目，无其他文字",
        ),
        layer_3_variable=VariableBoundaryLayer(
            replaceable_elements={
                "主角": ReplaceableItem(original="MOM", alternatives=["DAD", "GRANDMA", "GRANDPA", "WIFE", "TEACHER"]),
                "标题文案": ReplaceableItem(original="BEST MOM Ever", alternatives=["BEST DAD Ever", "World's Greatest Grandma", "Legend Since [年份]"]),
                "光效颜色": ReplaceableItem(original="紫色闪电", alternatives=["蓝色闪电+金色光芒", "红色火焰", "绿色极光"]),
                "照片数量": ReplaceableItem(original="1大+5小", alternatives=["1大+3小", "1大+7小"]),
            },
            must_not_change=["Bootleg rap tee视觉风格", "3D金属感大标题", "照片拼贴的个性化核心", "黑底+夸张光效"],
        ),
        layer_4_product=ProductAdaptationLayer(adaptations={
            "毛毯": ProductAdaptation(canvas_ratio="3:4", adaptation_notes="照片要高清，印大了不能糊", simplify=[], enhance=[]),
            "衣服": ProductAdaptation(canvas_ratio="根据印花区", adaptation_notes="Bootleg风本来就是T恤起源，天然适配，缩小照片数量", simplify=["减少照片数"], enhance=[]),
            "海报": ProductAdaptation(canvas_ratio="2:3", adaptation_notes="非常适合直接当房间装饰", simplify=[], enhance=[]),
        }),
        layer_5_data=DataValidationLayer(
            source_sales_rank="Amazon 照片定制毛毯品类",
            proven_platforms=["Amazon", "Etsy"],
            seasonal_dependency="中（母亲节/父亲节高峰，但生日全年有）",
            ip_dependency="无",
            reuse_level="A",
            reuse_level_reason="A级：跨人群（妈妈/爸爸/奶奶），跨产品（毯+衣+海报），但依赖用户上传照片",
        ),
    ))

    # ── RULE-0005 ──────────────────────────────────────────────
    rules.append(RuleCard(
        rule_id="RULE-0005",
        rule_name="家庭花园/每人一花+名字规则",
        reuse_level="S",
        source_images=["竞品图_MomsGarden出生花毯.jpg"],
        created_date=TODAY,
        last_updated=TODAY,
        layer_0_core=CoreSellingPoint(
            core_selling_point="名字以手写体作为花茎/根茎与花朵视觉相连 + 简约水彩花朵",
            selling_point_type="视觉概念/Visual Concept",
            why_it_sells="每个孩子的名字像从土里长出来连着一朵花='妈妈的花园里每个孩子都在生长'，极其触动家庭情感。简约花朵保证画面干净优雅",
            lock_rule="名字必须以手写体作为花茎/根茎出现在花朵下方且视觉上相连。花朵必须是简约水彩风（不能精致到植物图鉴级别）。每人一朵独立的花",
        ),
        layer_1_commercial=CommercialLayer(
            target_audience=["妈妈/Mom", "奶奶外婆/Grandma"],
            use_scenario=["母亲节/Mother's Day", "生日/Birthday", "圣诞节/Christmas", "日常/Everyday"],
            purchase_motivation="每个孩子一朵花+名字=每个家庭成员都有专属位置，强情感连接+高度个性化",
            core_emotion=["温柔/Tender", "感恩/Grateful", "怀念/Nostalgic", "优雅/Elegant"],
            price_sensitivity="中高（家庭个性化+情感价值高）",
        ),
        layer_2_visual=VisualStructureLayer(
            layout_formula="顶部标题区 + 下方多株花朵并排陈列（每株花代表一个家庭成员）",
            must_have_elements=[
                MustHaveElement(slot="主标题", description="Mom's Garden", position="顶部居中", visual_weight="文字最大"),
                MustHaveElement(slot="副标题", description="Where Love Grows", position="主标题下方", visual_weight="文字中等"),
                MustHaveElement(slot="蝴蝶装饰", description="2-5只蝴蝶", position="标题周围和花朵间", visual_weight="低"),
                MustHaveElement(slot="花朵1-N", description="每人一株独立花朵（不同种类），花下有该人名字作为根茎", position="中下部等间距排列", visual_weight="最重"),
                MustHaveElement(slot="背景", description="纯白色", position="整个画面", visual_weight="最轻"),
            ],
            style="柔和水彩/Soft Watercolor",
            color_mood="柔和暖色/Soft Warm",
            text_hierarchy="主标题Garden最大（装饰性字体）> 副标题 > 花下名字（手写体）",
        ),
        layer_3_variable=VariableBoundaryLayer(
            replaceable_elements={
                "标题主角": ReplaceableItem(original="Mom's Garden", alternatives=["Grandma's Garden", "Nana's Garden", "Dad's Garden", "Our Family Garden"]),
                "副标题": ReplaceableItem(original="Where Love Grows", alternatives=["Where Memories Bloom", "Planted with Love", "Blooming with Joy"]),
                "飞行装饰": ReplaceableItem(original="彩色蝴蝶", alternatives=["金色小蜜蜂", "小蜻蜓", "小瓢虫", "小鸟"]),
                "花朵数量": ReplaceableItem(original="6株（2排×3）", alternatives=["3株（1排）", "4株（2排×2）", "8株（2排×4）", "9株（3排×3）"]),
                "底色": ReplaceableItem(original="纯白色", alternatives=["暖奶油白", "极浅薰衣草紫", "极浅薄荷绿"]),
                "主题大改": ReplaceableItem(original="花园", alternatives=["Dad's Workshop（每人一个工具）", "Grandpa's Fishing Buddies（每人一条鱼）"]),
            },
            must_not_change=["名字作为根茎/花茎与花朵视觉相连", "花朵简约水彩风", "每人一朵独立花", "标题区+花朵陈列区的两段式构图", "白底干净感"],
        ),
        layer_4_product=ProductAdaptationLayer(adaptations={
            "毛毯": ProductAdaptation(canvas_ratio="3:4", adaptation_notes="面积大，花朵可画更多细节，6-10株放得下", simplify=[], enhance=["可增加装饰细节"]),
            "相框": ProductAdaptation(canvas_ratio="4:5", adaptation_notes="花朵缩减到3-5株一排，标题缩小，非常适合客厅装饰画", simplify=["减少花朵数"], enhance=[]),
            "马克杯": ProductAdaptation(canvas_ratio="环绕横幅", adaptation_notes="横向排3-4朵花，标题缩小放顶部", simplify=["减少花朵数", "标题缩小"], enhance=[]),
            "手提袋": ProductAdaptation(canvas_ratio="1:1", adaptation_notes="非常适合帆布袋审美，白底花朵天然匹配", simplify=[], enhance=[]),
        }),
        layer_5_data=DataValidationLayer(
            source_sales_rank="Amazon 家庭个性化毛毯品类 BSR 前 200",
            proven_platforms=["Amazon", "Etsy"],
            seasonal_dependency="低（母亲节高峰，但生日/乔迁/圣诞全年有）",
            ip_dependency="无",
            reuse_level="S",
            reuse_level_reason="S级：跨人群（Mom/Grandma/Nana/Dad）、跨产品（毯/相框/杯/袋）、跨主题（花园→工坊→鱼塘）、个性化深度极高（名字数量可变+花种可变）",
        ),
    ))

    return rules


def main():
    print("=" * 60)
    print("  规则卡批量导入脚本")
    print("=" * 60)

    # 初始化数据库
    init_db()
    print("[OK] SQLite 数据库已初始化")

    # 构建 5 条规则卡
    rules = build_rules()
    print(f"[OK] 已构建 {len(rules)} 条规则卡")

    # 逐条保存
    for rule in rules:
        save_rule(rule)
        print(f"  -> 已保存: {rule.rule_id} | {rule.rule_name} | 复用等级={rule.reuse_level}")

    # 验证
    print("\n" + "-" * 60)
    print("  验证：调用 list_rules() 查询所有规则")
    print("-" * 60)
    all_rules = list_rules()
    print(f"  数据库中共有 {len(all_rules)} 条规则卡：\n")
    for r in all_rules:
        print(f"  [{r['reuse_level']}] {r['rule_id']} - {r['rule_name']}")
        print(f"       核心卖点: {r['core_selling_point']}")
        print(f"       创建日期: {r['created_date']}")
        print()

    if len(all_rules) == 5:
        print("=" * 60)
        print("  全部 5 条规则卡导入成功！")
        print("=" * 60)
    else:
        print(f"[WARNING] 预期 5 条，实际 {len(all_rules)} 条，请检查。")


if __name__ == "__main__":
    main()

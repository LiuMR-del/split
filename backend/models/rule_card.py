"""
6 层规则卡 - 数据模型
"""

from pydantic import BaseModel, Field
from typing import List, Optional, Dict
from datetime import datetime


class CoreSellingPoint(BaseModel):
    """第 0 层：核心卖点锚定"""
    core_selling_point: str = Field(description="买家下单的直接原因")
    core_selling_point_en: Optional[str] = Field(default=None, description="核心卖点英文版，用于英文生图提示词")
    selling_point_type: str = Field(description="卖点类型")
    why_it_sells: str = Field(description="为什么驱动下单")
    lock_rule: str = Field(description="锁定规则：什么绝不能改")


class CommercialLayer(BaseModel):
    """第 1 层：商业层"""
    target_audience: List[str] = Field(description="目标人群")
    use_scenario: List[str] = Field(description="使用场景")
    purchase_motivation: str = Field(description="购买动机")
    core_emotion: List[str] = Field(description="核心情绪")
    price_sensitivity: str = Field(description="价格敏感度")


class MustHaveElement(BaseModel):
    """必备元素"""
    slot: str = Field(description="槽位名称")
    description: str = Field(description="元素描述")
    description_en: Optional[str] = Field(default=None, description="元素描述英文版，用于英文生图提示词")
    position: str = Field(description="位置")
    visual_weight: str = Field(description="视觉权重")
    is_text_slot: bool = Field(default=False, description="是否为文字类槽位（名字/日期/文案等个性化定制文字）")


class VisualStructureLayer(BaseModel):
    """第 2 层：视觉结构层"""
    layout_formula: str = Field(description="构图公式")
    layout_formula_en: Optional[str] = Field(default=None, description="构图公式英文版，用于英文生图提示词")
    must_have_elements: List[MustHaveElement] = Field(description="必备元素")
    style: str = Field(description="视觉风格")
    color_mood: str = Field(description="色彩情绪")
    text_hierarchy: str = Field(description="文字层级")


class ReplaceableItem(BaseModel):
    """可替换项"""
    original: str = Field(description="原始值")
    original_en: Optional[str] = Field(default=None, description="原始值英文版，用于英文生图提示词")
    alternatives: List[str] = Field(description="可替换选项")
    alternatives_en: Optional[List[str]] = Field(default=None, description="可替换选项英文版列表，用于英文生图提示词")
    is_text_slot: bool = Field(default=False, description="是否为文字类槽位（名字/日期/文案等个性化定制文字）")


class VariableBoundaryLayer(BaseModel):
    """第 3 层：可变边界层"""
    replaceable_elements: Dict[str, ReplaceableItem] = Field(description="可替换元素")
    must_not_change: List[str] = Field(description="绝不能换的")


class ProductAdaptation(BaseModel):
    """单个产品的适配规则"""
    canvas_ratio: str = Field(description="画布比例")
    adaptation_notes: str = Field(description="适配说明")
    simplify: List[str] = Field(default_factory=list, description="需要简化的")
    enhance: List[str] = Field(default_factory=list, description="可以增强的")


class ProductAdaptationLayer(BaseModel):
    """第 4 层：产品适配层"""
    adaptations: Dict[str, ProductAdaptation] = Field(description="各产品适配规则")


class DataValidationLayer(BaseModel):
    """第 5 层：数据验证层"""
    source_sales_rank: str = Field(default="", description="来源销量排名")
    proven_platforms: List[str] = Field(default_factory=list, description="已验证平台")
    seasonal_dependency: str = Field(description="季节依赖度")
    ip_dependency: str = Field(description="IP依赖度")
    reuse_level: str = Field(description="复用等级 S/A/B/C")
    reuse_level_reason: str = Field(description="等级判断理由")


class RuleCard(BaseModel):
    """完整的 6 层规则卡"""
    rule_id: str = Field(description="规则ID")
    rule_name: str = Field(description="规则名称")
    reuse_level: str = Field(description="复用等级 S/A/B/C")
    source_images: List[str] = Field(default_factory=list, description="来源图片")
    thumbnail_path: str = Field(default="", description="缩略图路径，格式 /uploads/xxx.jpg")
    created_date: str = Field(description="创建日期")
    last_updated: str = Field(description="最后更新日期")

    layer_0_core: CoreSellingPoint = Field(description="第0层：核心卖点锚定")
    layer_1_commercial: CommercialLayer = Field(description="第1层：商业层")
    layer_2_visual: VisualStructureLayer = Field(description="第2层：视觉结构层")
    layer_3_variable: VariableBoundaryLayer = Field(description="第3层：可变边界层")
    layer_4_product: ProductAdaptationLayer = Field(description="第4层：产品适配层")
    layer_5_data: DataValidationLayer = Field(description="第5层：数据验证层")

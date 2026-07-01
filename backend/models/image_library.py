"""
自有图库数据模型 - 图片标签结构
"""

from pydantic import BaseModel, Field
from typing import List, Optional


class ImageTag(BaseModel):
    """自有图标签"""
    image_id: str = Field(description="图片ID，格式 IMG-0001")
    filename: str = Field(description="原始文件名")
    file_path: str = Field(description="存储路径")
    thumbnail_path: str = Field(default="", description="缩略图路径")

    # 标签（从受控词表中选）
    themes: List[str] = Field(default_factory=list, description="主题标签，如 恐龙/宠物/花卉")
    styles: List[str] = Field(default_factory=list, description="风格标签，从 style 词表选")
    color_moods: List[str] = Field(default_factory=list, description="色彩情绪，从 color_mood 词表选")
    emotions: List[str] = Field(default_factory=list, description="情绪标签，从 core_emotion 词表选")
    target_audiences: List[str] = Field(default_factory=list, description="目标人群")

    # 自由描述
    description: str = Field(default="", description="AI 生成的图片描述")
    elements: List[str] = Field(default_factory=list, description="图片中的主要元素")
    layout_type: str = Field(default="", description="构图类型，如 居中主体+环绕装饰、九宫格拼块、满版平铺")

    # 元数据
    created_date: str = Field(default="", description="入库日期")
    ai_tagged: bool = Field(default=False, description="是否已被AI自动打标")
    manually_reviewed: bool = Field(default=False, description="是否已人工审核")

"""
生图 API 数据模型
"""

from pydantic import BaseModel, Field
from typing import Optional, List


class ImageGenConfig(BaseModel):
    """生图 API 配置"""
    provider: str = Field(default="aireiter", description="生图服务商")
    api_url: str = Field(default="https://aireiter.com", description="API 基础地址")
    api_key: str = Field(description="API Key")
    model: str = Field(default="nano_banana_pro_advanced", description="生图模型")
    api_type: str = Field(default="openai", description="API 类型：openai（同步）或 aireiter（异步）")


class ImageGenRequest(BaseModel):
    """生图请求"""
    rule_id: str = Field(description="基于哪条规则")
    prompt_positive: str = Field(description="正向提示词")
    prompt_negative: str = Field(default="", description="负向提示词")
    width: int = Field(default=1024, description="宽度")
    height: int = Field(default=1024, description="高度")
    count: int = Field(default=1, ge=1, le=4, description="生成数量 1-4")


class ImageGenTask(BaseModel):
    """生图任务状态"""
    task_id: str = Field(description="本地任务ID")
    out_task_id: str = Field(description="远端任务ID")
    rule_id: str = Field(description="关联规则")
    status: str = Field(description="pending/processing/completed/failed")
    prompt_positive: str
    prompt_negative: str
    width: int = Field(default=1024, description="宽度")
    height: int = Field(default=1024, description="高度")
    image_urls: List[str] = Field(default_factory=list, description="远端生成的图片URL")
    local_images: List[str] = Field(default_factory=list, description="已下载到本地的图片路径")
    error: str = Field(default="", description="错误信息")
    estimated_credits: float = Field(default=0, description="预估消耗积分")
    created_at: str
    completed_at: str = Field(default="")


class ImageGenConfigResponse(BaseModel):
    """生图配置响应（key 脱敏）"""
    provider: str
    api_url: str
    api_key_masked: str
    model: str
    api_type: str = Field(default="openai", description="API 类型：openai 或 aireiter")
    is_configured: bool

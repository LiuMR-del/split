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
    rule_name: str = Field(default="", description="规则名称（提交时冗余存一份，生图任务页按规则分组展示时不用再反查）")
    version: str = Field(default="", description="提示词来自哪个版本：A(资料库关联)/B(AI推荐)/C(自定义模板)，旧数据/未传时为空")
    prompt_positive: str = Field(description="正向提示词")
    prompt_negative: str = Field(default="", description="负向提示词")
    width: int = Field(default=1024, description="宽度")
    height: int = Field(default=1024, description="高度")
    count: int = Field(default=1, ge=1, le=4, description="生成数量 1-4")
    # #7：附带竞品原图生图。attach_rule_image 默认 True——大多数场景希望参考竞品图；
    # reference_image_paths 是前端已上传/生成的额外参考图相对 URL 路径（如 "/uploads/xxx.jpg"），
    # 批次五（生图流程参考图上传）启用，本批次恒为空列表
    attach_rule_image: bool = Field(default=True, description="是否附带规则卡的竞品原图作为生图参考")
    reference_image_paths: List[str] = Field(default_factory=list, description="额外参考图的相对 URL 路径列表")


class ImageGenTask(BaseModel):
    """生图任务状态"""
    task_id: str = Field(description="本地任务ID")
    out_task_id: str = Field(description="远端任务ID")
    rule_id: str = Field(description="关联规则")
    rule_name: str = Field(default="", description="规则名称")
    version: str = Field(default="", description="来源提示词版本：A/B/C，旧数据为空")
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
    # #7：这次提交是否真的带上了参考图（受支持的模式 + 有可用图片路径 双重满足才为 True）
    used_reference: bool = Field(default=False, description="本次生图是否实际附带了参考图")


class ImageGenConfigResponse(BaseModel):
    """生图配置响应（key 脱敏）"""
    provider: str
    api_url: str
    api_key_masked: str
    model: str
    api_type: str = Field(default="openai", description="API 类型：openai 或 aireiter")
    is_configured: bool
    # #7：批次三 Spike 结论——仅 OpenAI 模式的 /v1/images/edits 确认支持带参考图，
    # AIReiter 模式当前环境无法验证（自建代理没实现原生 submit 路由，aireiter.com 域名不可达），
    # 前端据此决定是否显示/启用"附带竞品原图"开关
    supports_reference: bool = Field(default=False, description="当前配置的生图模式是否支持带参考图")

"""
AI 模型配置 - 数据模型
"""

from pydantic import BaseModel


class AIModelConfig(BaseModel):
    """AI 模型配置"""
    provider: str       # "openai" 或 "anthropic" 或 "custom"
    api_url: str        # API 地址，如 https://api.openai.com/v1
    api_key: str        # API Key
    model: str          # 模型名，如 gpt-4o, claude-sonnet-4-20250514


class SettingsResponse(BaseModel):
    """配置响应（隐藏 API Key 中间部分）"""
    provider: str
    api_url: str
    api_key_masked: str     # 如 "sk-...xxxx"
    model: str
    is_configured: bool

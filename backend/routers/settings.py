"""
AI 模型配置路由
- GET  /api/settings        → 读取配置（key 脱敏）
- POST /api/settings        → 保存配置
- POST /api/settings/test   → 测试连接
- POST /api/settings/models → 拉取远端可用模型列表
"""

import json
from pathlib import Path
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException
from models.settings import AIModelConfig, SettingsResponse
from services.ai_client import AIClient

router = APIRouter()

# 配置文件路径
CONFIG_DIR = Path(__file__).parent.parent / "data"
CONFIG_PATH = CONFIG_DIR / "config.json"


def _mask_api_key(key: str) -> str:
    """将 API Key 脱敏，只显示前 3 位和后 4 位"""
    if not key or len(key) <= 8:
        return "***"
    return f"{key[:3]}...{key[-4:]}"


def _load_config() -> Optional[dict]:
    """从 config.json 读取配置，文件不存在则返回 None"""
    if not CONFIG_PATH.exists():
        return None
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def _save_config(config: dict) -> None:
    """将配置写入 config.json"""
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)


@router.get("/settings", response_model=SettingsResponse)
async def get_settings():
    """获取当前 AI 模型配置（API Key 脱敏显示）"""
    config = _load_config()
    if config is None:
        return SettingsResponse(
            provider="",
            api_url="",
            api_key_masked="",
            model="",
            is_configured=False,
        )

    return SettingsResponse(
        provider=config.get("provider", ""),
        api_url=config.get("api_url", ""),
        api_key_masked=_mask_api_key(config.get("api_key", "")),
        model=config.get("model", ""),
        is_configured=bool(config.get("api_key")),
    )


@router.post("/settings", response_model=SettingsResponse)
async def save_settings(config: AIModelConfig):
    """保存 AI 模型配置到 config.json"""
    _save_config(config.model_dump())

    return SettingsResponse(
        provider=config.provider,
        api_url=config.api_url,
        api_key_masked=_mask_api_key(config.api_key),
        model=config.model,
        is_configured=bool(config.api_key),
    )


@router.post("/settings/test")
async def test_settings(config: AIModelConfig):
    """测试 AI 模型连接是否正常"""
    client = AIClient(config)
    result = await client.test_connection()
    return result


@router.post("/settings/models")
async def fetch_models(config: AIModelConfig):
    """拉取远端 API 可用的模型列表

    仅支持 OpenAI 兼容格式（GET /models）。
    返回 {"models": [{"id": "gpt-5.4", "name": "GPT-5.4"}, ...]}
    """
    api_url = config.api_url.rstrip("/")
    headers = {
        "Authorization": f"Bearer {config.api_key}",
    }
    # Anthropic: 尝试实时拉取模型列表（GET /v1/models, 需 x-api-key + anthropic-version）
    if config.provider == "anthropic":
        anthropic_headers = {
            "x-api-key": config.api_key,
            "anthropic-version": "2023-06-01",
        }
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(
                    f"{api_url}/models", headers=anthropic_headers
                )
                if resp.status_code == 200:
                    data = resp.json()
                    models = []
                    for m in data.get("data", []):
                        models.append({
                            "id": m.get("id", ""),
                            "name": m.get("display_name", m.get("id", "")),
                        })
                    models.sort(key=lambda x: x["name"])
                    return {"models": models}
        except Exception:
            pass
        # 实时拉取失败时回退到硬编码列表（可手动更新）
        return {"models": [
            {"id": "claude-sonnet-4-20250514", "name": "Claude Sonnet 4"},
            {"id": "claude-sonnet-4-6", "name": "Claude Sonnet 4.6"},
            {"id": "claude-opus-4-20250514", "name": "Claude Opus 4"},
            {"id": "claude-opus-4-6", "name": "Claude Opus 4.6"},
            {"id": "claude-haiku-4-5-20251001", "name": "Claude Haiku 4.5"},
        ]}

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(f"{api_url}/models", headers=headers)
            if resp.status_code != 200:
                return {"models": [], "error": f"HTTP {resp.status_code}"}
            data = resp.json()
            models = []
            for m in data.get("data", []):
                models.append({
                    "id": m.get("id", ""),
                    "name": m.get("display_name", m.get("id", "")),
                })
            # 按名称排序
            models.sort(key=lambda x: x["name"])
            return {"models": models}
    except Exception as e:
        return {"models": [], "error": str(e)}

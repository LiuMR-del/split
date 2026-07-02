"""
AI/VLM 响应 JSON 提取工具

VLM 返回的文本有时是纯 JSON，有时包在 ```json 代码块里，
有时前后夹杂说明文字。这里统一用三级策略解析，
image_analyzer.py / image_tagger.py / prompt_generator.py 共用。
"""

import json
import re


def extract_json_from_ai_response(text: str) -> dict:
    """
    从 AI/VLM 响应文本中提取 JSON。
    依次尝试三种策略：
    1. 直接解析整段文本
    2. 提取 ```json ... ``` 代码块中的内容
    3. 找第一个 { 到最后一个 } 之间的内容

    参数:
        text: AI 返回的原始文本

    返回:
        解析出的字典；三种策略都失败时返回
        {"raw_response": text, "parse_error": "..."}
    """
    # 策略 1：直接解析整段文本
    try:
        return json.loads(text.strip())
    except (json.JSONDecodeError, ValueError):
        pass

    # 策略 2：提取 ```json ... ``` 代码块
    pattern = r"```(?:json)?\s*\n?(.*?)\n?\s*```"
    match = re.search(pattern, text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1).strip())
        except (json.JSONDecodeError, ValueError):
            pass

    # 策略 3：找第一个 { 到最后一个 } 之间的内容
    first_brace = text.find("{")
    last_brace = text.rfind("}")
    if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
        try:
            return json.loads(text[first_brace : last_brace + 1])
        except (json.JSONDecodeError, ValueError):
            pass

    # 全部失败，返回原始文本包装
    return {"raw_response": text, "parse_error": "无法从 AI 响应中提取有效 JSON"}

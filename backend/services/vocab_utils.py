"""
受控词表格式解析工具

项目里的受控词表统一用 "中文/English" 格式存值
（如 "柔和水彩/Soft Watercolor"）。这里提供两个方向的拆分，
prompt_generator.py 和 image_library_store.py 共用，
避免同一个约定在两处各写一份拆分逻辑。
"""


def extract_chinese_part(text: str) -> str:
    """从 "中文/English" 格式中取中文部分（"/" 前）。没有 "/" 时原样返回并去空格。"""
    if not text:
        return ""
    if "/" in text:
        return text.split("/", 1)[0].strip()
    return text.strip()


def extract_english_part(text: str) -> str:
    """从 "中文/English" 格式中取英文部分（"/" 后）。没有 "/" 时原样返回（不去空格，兼容旧调用方行为）。"""
    if not text:
        return ""
    if "/" in text:
        return text.split("/", 1)[1].strip()
    return text

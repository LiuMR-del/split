"""
图片格式兼容工具

统一处理 AVIF/HEIF 等 VLM 不原生支持的格式：
- 注册 pillow-heif 解码器（模块导入时执行一次）
- 判断文件格式是否需要转换
- 转换为 VLM 原生支持的 JPEG

image_analyzer.py 和 image_tagger.py 都调用这里，避免重复维护
两份几乎相同的 Pillow 转换逻辑。

本模块是"支持哪些图片格式"的唯一事实来源：
- VLM_SUPPORTED_FORMATS: VLM 原生能直接处理的文件后缀，其余格式会在
  prepare_image_for_vlm 中自动转 JPEG
- UPLOAD_ACCEPTED_MIME_TYPES: 上传接口允许接受的 MIME 类型（覆盖 VLM
  原生支持的格式 + 可以被 Pillow 转换成 JPEG 的格式）

新增支持格式时只需要改这里（如果 Pillow 转换还需要额外依赖，比如
pillow-heif，记得同步更新 requirements.txt），不需要再去
routers/analyze.py 里改一份重复的白名单——这正是之前 AVIF 支持
漏改导致上传被拒的根因。
"""

import base64
import io
from pathlib import Path

# 注册 AVIF/HEIF 支持（如果 pillow-heif 已安装）。
# 放在模块顶层，导入本模块时执行一次，被多个 service 共享。
try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
except ImportError:
    pass

# VLM API 通常只原生支持这些格式，其他格式需要先转换为 JPEG
VLM_SUPPORTED_FORMATS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}

# 文件后缀 → MIME 类型（仅覆盖 VLM 原生支持的格式；需要转换的格式统一转
# JPEG 后用 image/jpeg，不需要在这里单独列出）
_MIME_TYPE_MAP = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
}

# 从 _MIME_TYPE_MAP 推导：VLM 原生支持的 MIME 类型集合
_VLM_SUPPORTED_MIME_TYPES = set(_MIME_TYPE_MAP.values())

# 除 VLM 原生支持外，还能被 prepare_image_for_vlm 转换成 JPEG 后接受的格式。
# 这些格式不会被直接发给 VLM，而是先经 Pillow（必要时 pillow-heif）转码。
_CONVERTIBLE_MIME_TYPES = {
    "image/avif",
    "image/bmp",
    "image/tiff",
}

# 上传接口允许接受的 MIME 类型：VLM 原生支持的 + 可转换的格式。
# 这是上传白名单的唯一事实来源，routers/analyze.py 等上传入口应直接
# 引用此常量，不要再单独维护一份 allowed_types。
UPLOAD_ACCEPTED_MIME_TYPES = _VLM_SUPPORTED_MIME_TYPES | _CONVERTIBLE_MIME_TYPES


def prepare_image_for_vlm(image_path) -> tuple:
    """
    读取图片并准备好发给 VLM 用的 base64 + media_type。
    格式不被 VLM 原生支持时（avif/bmp/tiff 等），自动用 Pillow 转成 JPEG。

    参数:
        image_path: 图片文件路径（str 或 Path）

    返回:
        (base64_string, media_type) 二元组
    """
    path = Path(image_path)
    suffix = path.suffix.lower()

    if suffix in VLM_SUPPORTED_FORMATS:
        image_data = path.read_bytes()
        media_type = _MIME_TYPE_MAP.get(suffix, "image/jpeg")
        return base64.b64encode(image_data).decode(), media_type

    # 不支持的格式（avif/bmp/tiff 等），用 Pillow 转成 JPEG
    try:
        from PIL import Image
        img = Image.open(str(path))
        # RGBA/透明通道转 RGB（JPEG 不支持透明）
        if img.mode in ("RGBA", "LA", "P"):
            img = img.convert("RGB")
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=90)
        return base64.b64encode(buf.getvalue()).decode(), "image/jpeg"
    except ImportError:
        # Pillow 没安装，降级直接发原格式（可能被 API 拒绝）
        image_data = path.read_bytes()
        return base64.b64encode(image_data).decode(), "image/jpeg"
    except Exception as e:
        raise Exception(f"图片格式转换失败（{suffix}）: {str(e)}")

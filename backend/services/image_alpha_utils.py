"""白底图转透明底 PNG（三期阶段四·元素拆分图用）

## 为什么需要这个模块

元素抠取要同时满足两件事：**元素位置/比例与原图一致** + **透明底**。
实测这两件事在生图 API 侧**不可兼得**：

- 只要透明底（`background="transparent"` 参数，不提位置要求）→ 真 RGBA 透明，
  但元素被重新居中、画布比例不可控（实测 1672×941）。
- 要求"保持原画布与原位置" → 上游忽略 `background=transparent`，返回
  **原图尺寸的 RGB 白底图**（`size` 取 1024x1024 和 1024x1536 都一样，
  已用控制变量法排除 size 是原因）。

所以选了"位置优先"：让生图出**白底**图（位置对），落盘时在这里转成真透明。

## 阈值是怎么定的（不是拍脑袋）

对实测白底图统计"每像素离纯白的距离"（`(255 - rgb).max()`）的分位数：

    50% → 9    80% → 10   90% → 14   95% → 101   98% → 132   最大 194

背景噪点集中在 ≤14，真实内容 ≥101，**中间有干净的空档**，所以取
`LO=14`（以下全透明）、`HI=45`（以上全不透明），中间线性过渡。

不同阈值下元素包围盒（归一化）的实测对比，说明为什么不能更松：

    LO=6  → x 0.00~1.00 y 0.00~1.00   ← 背景噪点被当成内容，包围盒撑满全图
    LO=10 → x 0.04~0.93 y 0.03~0.84   ← 仍有残留
    LO=14 → x 0.07~0.92 y 0.27~0.60   ← 稳定，与原图彩虹位置吻合
    LO=18 → x 0.07~0.92 y 0.27~0.58   ← 与 14 基本一致

## 为什么用"软 alpha + 去白"而不是二值抠图

水彩/手绘元素的边缘是渐变羽化的，二值阈值必然二选一：要么留一圈白边，
要么啃掉边缘细节。这里按"离白距离"算连续 alpha，再把半透明像素的颜色
**反推回未与白底混合前的原色**（un-premultiply against white），
才能既保住渐变又不留白边。

实测（彩虹拱门，合成到红底目视 + 客观指标）：白边残留 **0.0%**，
半透明边缘像素占 1.2%，位置守在原位。
"""

import io
from typing import Tuple

# 离纯白的距离阈值：<LO 判为背景（全透明），>HI 判为实体（全不透明），中间线性过渡。
# 取值依据见模块 docstring 的分位数与包围盒实测数据——改这两个数before请重跑那组统计。
ALPHA_LO = 14
ALPHA_HI = 45


def white_to_transparent(image_bytes: bytes) -> Tuple[bytes, dict]:
    """把白底 PNG 转成透明底 PNG。

    参数:
        image_bytes: 原始图片字节（白底，通常是生图 API 返回的 PNG）

    返回:
        (转换后的 PNG 字节, 统计信息 dict)
        统计信息含 transparent_ratio / semi_ratio / opaque_ratio / bbox，
        供日志与验证用。

    失败时**原样返回输入字节** + `{"converted": False, "error": ...}`——
    转透明是增强功能，失败不能让整个生图流程报错（用户至少还能拿到白底图）。
    """
    try:
        from PIL import Image
        import numpy as np

        src = Image.open(io.BytesIO(image_bytes))
        # 已经是透明图（走了 background=transparent 分支）就不重复处理
        if src.mode in ("RGBA", "LA") and _has_real_alpha(src):
            return image_bytes, {"converted": False, "reason": "already_transparent"}

        rgb = np.array(src.convert("RGB")).astype(np.int16)
        h, w, _ = rgb.shape

        # 每像素离纯白的最大通道距离（0=纯白，越大越"有内容"）
        dist = (255 - rgb).max(axis=2)
        alpha = np.clip(
            (dist - ALPHA_LO) * 255.0 / (ALPHA_HI - ALPHA_LO), 0, 255
        ).astype(np.uint8)

        # 去白：半透明像素当前颜色是"原色与白底按 alpha 混合"的结果，
        # 反解出原色，否则合成到深色背景上会看到一圈发白的边
        af = alpha.astype(np.float32) / 255.0
        # alpha 极小的像素反解会放大噪声（除以接近 0），这些像素反正全透明，颜色无所谓
        af_safe = np.where(af < 0.02, 1.0, af)
        unmixed = np.clip(
            (rgb - 255 * (1 - af_safe[..., None])) / af_safe[..., None], 0, 255
        ).astype(np.uint8)

        out = Image.fromarray(np.dstack([unmixed, alpha]))
        buf = io.BytesIO()
        out.save(buf, format="PNG")

        stats = {"converted": True}
        total = alpha.size
        stats["transparent_ratio"] = round(float((alpha == 0).sum()) / total, 4)
        stats["semi_ratio"] = round(float(((alpha > 0) & (alpha < 255)).sum()) / total, 4)
        stats["opaque_ratio"] = round(float((alpha == 255).sum()) / total, 4)
        ys, xs = np.where(alpha > 20)
        if len(xs):
            stats["bbox"] = [
                round(float(xs.min()) / w, 3), round(float(ys.min()) / h, 3),
                round(float(xs.max()) / w, 3), round(float(ys.max()) / h, 3),
            ]
        return buf.getvalue(), stats
    except Exception as e:
        # 转换失败不阻断生图流程，退回白底图
        return image_bytes, {"converted": False, "error": str(e)}


def _has_real_alpha(img) -> bool:
    """判断 RGBA 图是否真的有透明像素（不是"有 alpha 通道但全不透明"的假透明）。"""
    try:
        alpha = img.getchannel("A")
        lo, _ = alpha.getextrema()
        return lo < 250
    except Exception:
        return False

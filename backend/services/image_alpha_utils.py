"""白底图转透明底 PNG（三期阶段四·元素拆分图用）

## 为什么需要这个模块

元素抠取要同时满足两件事：**元素位置/比例与原图一致** + **透明底**。

2026-08-18 修正了这里的做法。此前是"让上游出白底、本地转透明"，因为实测
要求"保持原画布与原位置"时上游会忽略 `background=transparent`。但后来发现：
**不传 background 参数时，上游会自作主张返回 RGBA 抠好的图，而且抠得有碎洞**
（实测 18 张元素图里 `wildflower sprigs` 内部碎洞 4.68%、`ivy vines` 2.48%、
`eucalyptus branches` 2.33%），用户反馈的"主体元素缺失"就是这个。

现在的做法是**显式要求上游别抠**（`background="opaque"`，实测生效、返回 RGB
整图且位置正确），拿到不透明整图后由本模块本地抠——本地可控、可调、出问题能定位。

## 判定方向：严判背景，其余全保留（2026-08-18 v2，用户思路）

v1 的判定方向是"判定内容"：全局软阈值（离白距离 14~45 线性过渡）+ 宽容差
洪水填充（`FLOOD_WHITE_DIST=40`，把浅色主体也算"白"、靠连通性区分）。
真实失败案例 **GEN-0175 拉布拉多**：奶油色毛发的离白距离恰好落在 14~45
过渡带 → 半透明；且毛色边界本身近白、洪水屏障有缺口 → 宽容差洪水漏进主体
内部，头顶/面部出现整片半透明斑块（深色页面上显示为灰斑）。

v2 反转判定方向（= 用户提出的"先判定元素形状区域，区域内不做任何擦除"）：

1. **背景必须同时满足两个严条件**：离白距离 ≤ 自适应容差（从四角采样估计，
   实测上游整图背景 p99=2，容差通常 4~6）+ **从画布边缘连通可达**（洪水填充，
   4 邻接）。
2. **环形例外**：被内容包围、连不到边缘的大块白区（≥2% 画布）判背景——
   金色圆环/花环的中心必须透明（实测 `thin gold circle` 中心占 20.9%）。
3. **其余像素一律不透明**——浅色毛发（距离 5~45）不再进过渡带，整片保留。
4. **软过渡只保留在背景边缘的羽化带**（背景膨胀 4px 的环带）：抗锯齿边缘
   像素是"内容色与白底的混合"，在羽化带内按距离线性给 alpha 并反解原色
   （un-premultiply），保证水彩渐变边不留白边——这是 v1 实测白边残留 0.0%
   的机制，v2 只是把它的作用范围从全图收窄到边缘带。

## 羽化带阈值 ALPHA_LO/HI 的数据依据（v1 实测，v2 沿用于羽化带内）

对实测白底图统计"每像素离纯白的距离"（`(255 - rgb).max()`）的分位数：

    50% → 9    80% → 10   90% → 14   95% → 101   98% → 132   最大 194

`LO=14`（以下全透明）、`HI=45`（以上全不透明），中间线性过渡。配合
un-premultiply 去白，实测白边残留 **0.0%**（合成到红底目视确认）。
"""

import io
from typing import Optional, Tuple

# 羽化带内的软 alpha 阈值：<LO 全透明，>HI 全不透明，中间线性过渡。
# 取值依据见模块 docstring——v2 起只作用于背景边缘羽化带，不再全局应用
# （全局应用会把离白距离 14~45 的浅色毛发整片变成半透明，GEN-0175 实测教训）。
ALPHA_LO = 14
ALPHA_HI = 45

# 封闭白区判定为背景的面积阈值（占全图比例）。
# 依据：环形/边框类元素（花环、金色圆环）的中心白区通常占画面 10%~40%
# （实测 thin gold circle 中心 20.9%），主体内部的白毛/高光块远小于此。
ENCLOSED_BG_MIN_RATIO = 0.02

# 背景容差估计的上下限与安全边距。
# 实测上游 `background=opaque` 整图的背景离白距离 p99=2（三张样本一致），
# 容差通常估出 4~6；上限 12 防四角都被内容占据时把内容当背景。
BG_TOL_MIN = 4
BG_TOL_MAX = 12
BG_TOL_MARGIN = 3

# 背景边缘羽化带宽度（像素）。抗锯齿/水彩渐变边通常 2~4px。
RIM_PX = 4


def white_to_transparent(image_bytes: bytes) -> Tuple[bytes, dict]:
    """把白底 PNG 转成透明底 PNG（背景优先判定，见模块 docstring）。

    参数:
        image_bytes: 原始图片字节（白底整图；上游若返回 RGBA 则走兜底重抠）

    返回:
        (转换后的 PNG 字节, 统计信息 dict)
        统计信息含 transparent_ratio / semi_ratio / opaque_ratio / bbox / bg_tol，
        供日志与验证用。

    失败时**原样返回输入字节** + `{"converted": False, "error": ...}`——
    转透明是增强功能，失败不能让整个生图流程报错（用户至少还能拿到白底图）。
    """
    try:
        from PIL import Image
        import numpy as np

        src = Image.open(io.BytesIO(image_bytes))

        # 上游已经抠好透明的情况：合成回白底重抠（兜底路径）。
        #
        # 正常路径下**不该走到这里**——元素拆分已显式要求上游返回不透明整图
        # （`force_opaque=True`，见 image_gen_client._openai_generate）。
        # 兜底的代价：洞里原本的颜色在上游抠图时已永久丢失，只能补成白色。
        if src.mode in ("RGBA", "LA") and _has_real_alpha(src):
            src = _flatten_onto_white(src)
            reprocessed_from_alpha = True
        else:
            reprocessed_from_alpha = False

        rgb = np.array(src.convert("RGB")).astype(np.int16)
        h, w, _ = rgb.shape

        # 每像素离纯白的最大通道距离（0=纯白，越大越"有内容"）
        dist = (255 - rgb).max(axis=2)

        # ── 背景优先判定：严条件洪水 + 环形面积例外 + 边缘羽化带 ──
        bg, rim, conn_stats = _classify_background(dist)

        # 软 alpha 只在需要的地方算：背景=0，羽化带=线性过渡，其余=255
        alpha = np.full((h, w), 255, dtype=np.uint8)
        if bg is None:
            # scipy 缺失时的降级：退回 v1 的全局软阈值（浅色主体会受损，
            # 但功能不中断；正常部署 requirements 里有 scipy 不会走到这）
            alpha = np.clip(
                (dist - ALPHA_LO) * 255.0 / (ALPHA_HI - ALPHA_LO), 0, 255
            ).astype(np.uint8)
        else:
            ramp = np.clip(
                (dist - ALPHA_LO) * 255.0 / (ALPHA_HI - ALPHA_LO), 0, 255
            ).astype(np.uint8)
            alpha[bg] = 0
            alpha[rim] = ramp[rim]

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
        stats.update(conn_stats)
        stats["reprocessed_from_alpha"] = reprocessed_from_alpha
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


def _classify_background(dist):
    """背景优先分类。返回 (bg 掩码, rim 羽化带掩码, 统计 dict)。

    背景 = 离白距离 ≤ 自适应容差 且 从画布边缘洪水可达（4 邻接；8 邻接会
    从对角缝隙渗入主体）。加环形例外：封闭大块白区（≥2% 画布）也判背景。

    scipy 缺失时返回 (None, None, 统计)，调用方降级为全局软阈值。
    """
    import numpy as np
    try:
        from scipy import ndimage
    except ImportError:
        return None, None, {"bg_method": "fallback_no_scipy"}

    h, w = dist.shape
    total = float(h * w)

    tol = _estimate_bg_tol(dist)
    white = dist <= tol
    stats = {"bg_method": "v2_bg_flood", "bg_tol": int(tol)}

    # 洪水填充：从画布四边出发，只在"近纯白"内漫延
    seed = np.zeros_like(white)
    seed[0, :] = white[0, :]
    seed[-1, :] = white[-1, :]
    seed[:, 0] = white[:, 0]
    seed[:, -1] = white[:, -1]
    if seed.any():
        bg = ndimage.binary_propagation(seed, mask=white)
    else:
        # 四边都不是白（内容顶满画布）——没有可达背景
        bg = np.zeros_like(white)

    # 环形例外：连不到边缘的封闭白区，大块（环心）判背景，小块（主体内部
    # 高光/毛发亮斑）保持不透明
    enclosed = white & ~bg
    kept = 0
    if enclosed.any():
        lab, n = ndimage.label(enclosed)
        if n:
            sizes = ndimage.sum(enclosed, lab, index=np.arange(1, n + 1))
            for i in range(n):
                if sizes[i] / total >= ENCLOSED_BG_MIN_RATIO:
                    bg |= (lab == i + 1)
                    kept += 1
    stats["enclosed_kept"] = kept

    # 边缘羽化带：背景向内容侧膨胀 RIM_PX，抗锯齿混合像素在这里做软过渡
    rim = ndimage.binary_dilation(bg, iterations=RIM_PX) & ~bg
    stats["bg_ratio"] = round(float(bg.sum()) / total, 4)
    return bg, rim, stats


def _estimate_bg_tol(dist) -> int:
    """从四角采样估计背景容差：取"最干净的角"的 p99 + 安全边距。

    元素拆分图的内容通常不满画布，至少有一个角是纯背景；取四角中 p99 最小
    的那个角（内容碰到的角 p99 会大，被 min 排除）。实测上游整图背景
    p99=2 → 容差 5。全部角都被内容占据时被 BG_TOL_MAX 兜住。
    """
    import numpy as np

    h, w = dist.shape
    cs = max(4, min(h, w) // 25)
    corners = [
        dist[:cs, :cs], dist[:cs, -cs:], dist[-cs:, :cs], dist[-cs:, -cs:],
    ]
    cleanest_p99 = min(float(np.percentile(c, 99)) for c in corners)
    return int(np.clip(cleanest_p99 + BG_TOL_MARGIN, BG_TOL_MIN, BG_TOL_MAX))


def _flatten_onto_white(img):
    """把带 alpha 的图合成到纯白底，返回 RGB 图。

    用于"上游已抠但抠得有洞"的情况：先摊回白底，再走本地抠图重抠一遍。
    """
    from PIL import Image

    rgba = img.convert("RGBA")
    white = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
    return Image.alpha_composite(white, rgba).convert("RGB")


def _has_real_alpha(img) -> bool:
    """判断 RGBA 图是否真的有透明像素（不是"有 alpha 通道但全不透明"的假透明）。"""
    try:
        alpha = img.getchannel("A")
        lo, _ = alpha.getextrema()
        return lo < 250
    except Exception:
        return False

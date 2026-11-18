"""生成「浮贴 / FloatPaste」玻璃质感图标（蓝紫极光 + 白色玻璃剪贴板）。

设计要点：
- 超椭圆（squircle）外形，接近 macOS 图标
- 底色是清透的蓝→紫对角渐变，左上奶白强光，整体像一块磨砂玻璃
- 图形是白色高光玻璃质感的叠卡（剪贴板），带柔和投影与顶部提亮
- 全部超采样绘制，保证 16px 仍可辨认
"""

from PIL import Image, ImageDraw, ImageFilter
import numpy as np
import os

SS = 4                 # 超采样倍数
SIZE = 1024            # 最终尺寸
BIG = SIZE * SS

OUT_DIR = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'resources'))


def squircle_mask(size: int, n: float = 4.2, shrink: float = 0.0) -> Image.Image:
    """用超椭圆公式生成平滑遮罩；shrink 为向内收缩比例。"""
    half = size / 2.0
    y, x = np.ogrid[-half:half, -half:half]
    radius = half * (1.0 - shrink)
    v = (np.abs(x) / radius) ** n + (np.abs(y) / radius) ** n
    edge = 0.035
    alpha = np.clip((1.0 - v) / edge, 0.0, 1.0)
    alpha = (np.sqrt(alpha) * 255).astype(np.uint8)
    return Image.fromarray(alpha, mode='L')


def gradient(size: int, stops) -> Image.Image:
    """135° 对角线性渐变，stops = [(pos0~1, (r,g,b)), ...]"""
    t = (np.arange(size)[None, :] + np.arange(size)[:, None]) / (2.0 * size - 2.0)
    out = np.zeros((size, size, 3), dtype=np.float32)
    stops = sorted(stops)
    for i in range(len(stops) - 1):
        p0, c0 = stops[i]
        p1, c1 = stops[i + 1]
        c0 = np.array(c0, dtype=np.float32)
        c1 = np.array(c1, dtype=np.float32)
        m = (t >= p0) & (t <= p1)
        local = ((t - p0) / max(p1 - p0, 1e-6))[:, :, None]
        out[m] = (c0[None, None, :] + (c1 - c0)[None, None, :] * local)[m]
    return Image.fromarray(out.astype(np.uint8), mode='RGB')


def radial_glow(size: int, center, radius: float, color, strength: float) -> Image.Image:
    yy, xx = np.mgrid[0:size, 0:size]
    cx, cy = center
    r = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / radius
    a = np.clip(1.0 - r, 0.0, 1.0) ** 1.6
    arr = np.zeros((size, size, 4), dtype=np.float32)
    arr[:, :, 0] = color[0]
    arr[:, :, 1] = color[1]
    arr[:, :, 2] = color[2]
    arr[:, :, 3] = a * 255 * strength
    return Image.fromarray(arr.astype(np.uint8), mode='RGBA')


def build_background(size: int) -> Image.Image:
    base = gradient(size, [
        (0.00, (126, 206, 255)),
        (0.26, (143, 180, 255)),
        (0.56, (166, 168, 248)),
        (0.80, (198, 168, 244)),
        (1.00, (224, 180, 238)),
    ]).convert('RGBA')

    base.alpha_composite(radial_glow(size, (size * 0.10, size * 0.02), size * 0.62,
                                     (255, 252, 246), 0.92))
    base.alpha_composite(radial_glow(size, (size * 0.74, size * 0.28), size * 0.52,
                                     (128, 226, 255), 0.55))
    base.alpha_composite(radial_glow(size, (size * 0.50, size * 1.02), size * 0.58,
                                     (216, 168, 250), 0.52))
    base.alpha_composite(radial_glow(size, (size * 1.02, size * 1.04), size * 0.68,
                                     (92, 102, 196), 0.30))

    # 玻璃上的斜向高光带
    sweep = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sweep)
    sd.polygon([(0, size * 0.62), (size * 0.55, size * 0.02),
                (size * 0.86, size * 0.02), (0, size * 0.94)],
               fill=(255, 255, 255, 44))
    sweep = sweep.filter(ImageFilter.GaussianBlur(size * 0.02))
    base.alpha_composite(sweep)
    return base


def draw_glyph(size: int) -> Image.Image:
    """白色玻璃质感的叠卡（剪贴板）图形"""
    layer = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    u = size / 1024.0

    bw, bh = 330 * u, 360 * u
    r = 66 * u

    # 后卡（左下半透明）
    bx, by = size * 0.255 - bw * 0.18, size * 0.345
    d.rounded_rectangle([bx, by, bx + bw, by + bh], radius=r, fill=(255, 255, 255, 118))

    # 前卡（右上白色玻璃）
    fx, fy = size * 0.44, size * 0.235
    d.rounded_rectangle([fx, fy, fx + bw, fy + bh], radius=r, fill=(255, 255, 255, 250))

    # 顶部高光
    gloss = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(gloss)
    gd.rounded_rectangle([fx + 4 * u, fy + 4 * u, fx + bw - 4 * u, fy + bh * 0.44],
                         radius=r, fill=(255, 255, 255, 120))
    gloss = gloss.filter(ImageFilter.GaussianBlur(12 * u))
    layer.alpha_composite(gloss)

    # 内容线（淡蓝灰，模拟玻璃上的刻线）
    line_color = (116, 148, 208, 210)
    lw = int(26 * u)
    for x0, x1, y in ((0.16, 0.84, 0.40), (0.16, 0.68, 0.56), (0.16, 0.54, 0.72)):
        ly = fy + bh * y
        d.rounded_rectangle([fx + bw * x0, ly - lw / 2, fx + bw * x1, ly + lw / 2],
                            radius=lw / 2, fill=line_color)
    return layer


def main():
    bg = build_background(BIG)

    glyph = draw_glyph(BIG)

    # 图形背后的柔光，让中心发光
    halo = radial_glow(BIG, (BIG * 0.50, BIG * 0.46), BIG * 0.30, (255, 255, 255), 0.55)
    bg.alpha_composite(halo)

    shadow = Image.new('RGBA', (BIG, BIG), (0, 0, 0, 0))
    shadow.paste((40, 62, 132, 110), (int(BIG * 0.022), int(BIG * 0.036)), glyph.split()[3])
    shadow = shadow.filter(ImageFilter.GaussianBlur(BIG * 0.014))

    comp = bg.copy()
    comp.alpha_composite(shadow)
    comp.alpha_composite(glyph)

    # 边缘内描边（白色 60%），做出玻璃厚度
    ring = squircle_mask(BIG, n=4.4)
    inner = squircle_mask(BIG, n=4.4, shrink=0.026)
    diff = (np.asarray(ring, dtype=np.int16) - np.asarray(inner, dtype=np.int16)).clip(0, 255).astype(np.uint8)
    stroke = Image.new('RGBA', (BIG, BIG), (255, 255, 255, 0))
    stroke.putalpha(Image.fromarray(diff))
    comp.alpha_composite(stroke)

    comp.putalpha(squircle_mask(BIG, n=4.4))

    final = comp.resize((SIZE, SIZE), Image.LANCZOS)
    os.makedirs(OUT_DIR, exist_ok=True)
    png = os.path.join(OUT_DIR, 'icon.png')
    final.save(png)

    for s in (512, 256):
        final.resize((s, s), Image.LANCZOS).save(os.path.join(OUT_DIR, f'icon-{s}.png'))

    sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (24, 24), (16, 16)]
    final.save(os.path.join(OUT_DIR, 'icon.ico'), sizes=sizes)

    # 尺寸自检图
    sheet = Image.new('RGBA', (200, 104), (244, 246, 251, 255))
    x = 8
    for s in (96, 32, 16):
        im = final.resize((s, s), Image.LANCZOS)
        sheet.alpha_composite(im, (x, (104 - s) // 2))
        x += s + 12
    sheet.save(os.path.join(OUT_DIR, '_sheet.png'))

    print('icon written:', png, os.path.getsize(png), 'bytes')


if __name__ == '__main__':
    main()

"""存贴屋 / CunTieWu 图标 v2 —— 电光蓝紫高对比版。

为什么重画：旧图标是淡紫玻璃 + 白图形，整体明度高、饱和低，
在浅色桌面、Windows 任务栏上都糊成一片白，看不清。

新版要点：
1. 底色换成高饱和电光渐变（钴蓝 #2F5BFF → 紫 #7C2BFF → 洋红 #C02BD8），
   明度压到中等，白图形才能跳出来；加一圈青色边缘光增强轮廓。
2. 图形放大、留白收窄，16px 下仍能认出"叠起来的两张卡片"。
3. 正卡纯白实心 + 深蓝刻线（不是浅灰），缩放时不发灰。
4. 图标四周留 6% 内边距，任务栏对齐不贴边。
"""

from PIL import Image, ImageDraw, ImageFilter
import numpy as np
import os

SS = 4
SIZE = 1024
BIG = SIZE * SS
OUT_DIR = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'resources'))


def squircle_mask(size, n=4.2, shrink=0.0):
    half = size / 2.0
    y, x = np.ogrid[-half:half, -half:half]
    radius = half * (1.0 - shrink)
    v = (np.abs(x) / radius) ** n + (np.abs(y) / radius) ** n
    edge = 0.030
    alpha = np.clip((1.0 - v) / edge, 0.0, 1.0)
    return Image.fromarray((np.sqrt(alpha) * 255).astype(np.uint8), mode='L')


def gradient(size, stops):
    t = (np.arange(size)[None, :] + np.arange(size)[:, None]) / (2.0 * size - 2.0)
    out = np.zeros((size, size, 3), dtype=np.float32)
    for i in range(len(stops) - 1):
        p0, c0 = stops[i]
        p1, c1 = stops[i + 1]
        c0 = np.array(c0, dtype=np.float32)
        c1 = np.array(c1, dtype=np.float32)
        m = (t >= p0) & (t <= p1)
        local = ((t - p0) / max(p1 - p0, 1e-6))[:, :, None]
        out[m] = (c0[None, None, :] + (c1 - c0)[None, None, :] * local)[m]
    return Image.fromarray(out.astype(np.uint8), mode='RGB')


def radial(size, center, radius, color, strength, power=1.8):
    yy, xx = np.mgrid[0:size, 0:size]
    r = np.sqrt((xx - center[0]) ** 2 + (yy - center[1]) ** 2) / radius
    a = np.clip(1.0 - r, 0.0, 1.0) ** power
    arr = np.zeros((size, size, 4), dtype=np.float32)
    arr[:, :, 0], arr[:, :, 1], arr[:, :, 2] = color
    arr[:, :, 3] = a * 255 * strength
    return Image.fromarray(arr.astype(np.uint8), mode='RGBA')


def build_bg(size):
    # 电光蓝紫：左上钴蓝，中段紫，右下洋红；明度控制在 35%~55%
    base = gradient(size, [
        (0.00, (36, 84, 255)),
        (0.30, (64, 62, 250)),
        (0.58, (124, 43, 255)),
        (0.82, (176, 32, 224)),
        (1.00, (206, 36, 186)),
    ]).convert('RGBA')
    # 左上冷白高光，只提亮不洗白
    base.alpha_composite(radial(size, (size * 0.20, size * 0.12), size * 0.55, (180, 226, 255), 0.55))
    # 右下深紫压边，让轮廓更沉
    base.alpha_composite(radial(size, (size * 1.02, size * 1.04), size * 0.60, (40, 10, 90), 0.55))
    # 青色边缘光（左上）
    base.alpha_composite(radial(size, (size * 0.02, size * 0.46), size * 0.42, (90, 255, 250), 0.45))
    return base


def draw_glyph(size, line_alpha=225):
    layer = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    u = size / 1024.0

    bw, bh = 356 * u, 392 * u
    r = 78 * u
    ox, oy = size * 0.245, size * 0.235     # 整体图形位置（略偏左上，视觉居中）

    # 后卡：奶白半透明，往左上偏移
    d.rounded_rectangle([ox - 46 * u, oy - 40 * u, ox - 46 * u + bw, oy - 40 * u + bh],
                        radius=r, fill=(255, 255, 255, 205))

    # 正卡：纯白
    fx, fy = ox + 42 * u, oy + 54 * u
    d.rounded_rectangle([fx, fy, fx + bw, fy + bh], radius=r, fill=(255, 255, 255, 255))

    # 正卡顶部微高光（很淡，只为不做成死白平片）
    gloss = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(gloss)
    gd.rounded_rectangle([fx + 6 * u, fy + 6 * u, fx + bw - 6 * u, fy + bh * 0.42],
                         radius=r, fill=(255, 255, 255, 90))
    gloss = gloss.filter(ImageFilter.GaussianBlur(16 * u))
    layer.alpha_composite(gloss)

    # 刻线：深靛蓝，实心圆角条
    lc = (46, 28, 132, line_alpha)
    lw = 34 * u
    for x0, x1, yy in ((0.17, 0.83, 0.36), (0.17, 0.66, 0.55), (0.17, 0.52, 0.74)):
        ly = fy + bh * yy
        d.rounded_rectangle([fx + bw * x0, ly - lw / 2, fx + bw * x1, ly + lw / 2], radius=lw / 2, fill=lc)
    return layer


def compose(size_big):
    bg = build_bg(size_big)
    glyph = draw_glyph(size_big)

    # 图形下方投影，让卡片从底色上"立"起来
    shadow = Image.new('RGBA', (size_big, size_big), (0, 0, 0, 0))
    shadow.paste((18, 6, 60, 120), (int(size_big * 0.03), int(size_big * 0.05)), glyph.split()[3])
    shadow = shadow.filter(ImageFilter.GaussianBlur(size_big * 0.018))

    comp = bg.copy()
    comp.alpha_composite(shadow)
    comp.alpha_composite(glyph)

    # 内描边：外侧亮青、内侧白，做出玻璃厚度感
    outer = squircle_mask(size_big, n=4.4)
    inner = squircle_mask(size_big, n=4.4, shrink=0.022)
    diff = (np.asarray(outer, dtype=np.int16) - np.asarray(inner, dtype=np.int16)).clip(0, 255).astype(np.uint8)
    stroke = Image.new('RGBA', (size_big, size_big), (188, 240, 255, 0))
    stroke.putalpha(Image.fromarray(diff))
    comp.alpha_composite(stroke)

    comp.putalpha(squircle_mask(size_big, n=4.4))
    return comp.resize((SIZE, SIZE), Image.LANCZOS)


def build_tray(size):
    """托盘图标：纯图形，无内边距概念，直接在透明底上画，放大到边缘。"""
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    bg = build_bg(size)
    mask = squircle_mask(size, n=4.0)
    bg.putalpha(mask)
    canvas.alpha_composite(bg)
    glyph = draw_glyph(size)
    canvas.alpha_composite(glyph)
    return canvas


def main():
    final = compose(BIG)
    os.makedirs(OUT_DIR, exist_ok=True)
    png = os.path.join(OUT_DIR, 'icon.png')
    final.save(png)
    for s in (512, 256):
        final.resize((s, s), Image.LANCZOS).save(os.path.join(OUT_DIR, f'icon-{s}.png'))

    final.save(os.path.join(OUT_DIR, 'icon.ico'),
               sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (40, 40), (32, 32), (24, 24), (16, 16)])

    tray = build_tray(256)
    tray.save(os.path.join(OUT_DIR, 'tray.png'))
    tray.save(os.path.join(OUT_DIR, 'tray.ico'), sizes=[(64, 64), (48, 48), (32, 32), (24, 24), (16, 16)])

    # 尺寸自检：白底 + 深底两条，看两种背景下的辨识度
    sheet = Image.new('RGBA', (330, 116), (248, 250, 253, 255))
    y = 6
    for bgc in ((248, 250, 253, 255), (28, 30, 38, 255)):
        ImageDraw.Draw(sheet).rectangle([6, y, 324, y + 50], fill=bgc)
        x = 12
        for s in (48, 32, 24, 16):
            sheet.alpha_composite(final.resize((s, s), Image.LANCZOS), (x, y + (50 - s) // 2))
            x += s + 14
        y += 56
    sheet.save(os.path.join(OUT_DIR, '_sheet.png'))
    print('ok', os.path.getsize(png))


if __name__ == '__main__':
    main()

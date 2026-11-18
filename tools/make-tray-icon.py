"""剪贴栈 · 托盘小图标生成器
专门为 16/20/24/32px 优化：比主图标更饱和、描白边、卡片更胖、线条更粗，避免在系统托盘里发灰模糊。
输出：resources/tray.png（256，供高DPI缩放）、resources/tray.ico（16/20/24/32/48）
"""
from PIL import Image, ImageDraw, ImageFilter

SS = 8          # 超采样
BASE = 64       # 逻辑尺寸
W = BASE * SS
OUT = r"E:\浮贴\resources"


def squircle(size, radius):
    m = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return m


def gradient(size):
    img = Image.new('RGB', (size, size))
    px = img.load()
    c0 = (94, 168, 255)
    c1 = (168, 138, 255)
    for y in range(size):
        for x in range(size):
            t = (x / size * 0.55 + y / size * 0.45)
            px[x, y] = (
                int(c0[0] * (1 - t) + c1[0] * t),
                int(c0[1] * (1 - t) + c1[1] * t),
                int(c0[2] * (1 - t) + c1[2] * t),
            )
    return img


def build():
    canvas = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    # 玻璃底
    body = gradient(W).convert('RGBA')
    body.putalpha(squircle(W, int(W * 0.27)))
    canvas = Image.alpha_composite(canvas, body)

    # 顶部亮面
    hl = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(hl)
    d.ellipse((-W * 0.2, -W * 0.55, W * 0.85, W * 0.35), fill=(255, 255, 255, 120))
    hl.putalpha(Image.composite(hl.getchannel('A'), Image.new('L', (W, W), 0), squircle(W, int(W * 0.27))))
    canvas = Image.alpha_composite(canvas, hl)

    # 后卡（左上，偏灰白）
    back = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(back)
    d.rounded_rectangle((W * 0.15, W * 0.15, W * 0.60, W * 0.60), radius=int(W * 0.09),
                        fill=(226, 238, 255, 240), outline=(255, 255, 255, 255), width=int(W * 0.012))
    canvas = Image.alpha_composite(canvas, back)

    # 前卡（右下，纯白）+ 三条深蓝文字线
    front = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(front)
    d.rounded_rectangle((W * 0.36, W * 0.38, W * 0.86, W * 0.87), radius=int(W * 0.10),
                        fill=(255, 255, 255, 255), outline=(255, 255, 255, 255), width=int(W * 0.012))
    bar_x0, bar_x1 = W * 0.445, W * 0.775
    bar_h = int(W * 0.055)
    for i, frac in enumerate((1.0, 0.74, 0.5)):
        y = W * (0.505 + i * 0.105)
        d.rounded_rectangle((bar_x0, y, bar_x0 + (bar_x1 - bar_x0) * frac, y + bar_h),
                            radius=int(bar_h / 2), fill=(38, 66, 140, 255))
    canvas = Image.alpha_composite(canvas, front)

    out = canvas.resize((BASE, BASE), Image.LANCZOS)
    return out


if __name__ == '__main__':
    icon = build()
    icon.resize((256, 256), Image.NEAREST).save(OUT + r'\tray.png')
    sizes = [48, 32, 24, 20, 16]
    # 每档单独重采样，保证 16px 也锐利（NEAREST 由 64 直接取，再用 LANCZOS 轻微平滑）
    reps = []
    for s in sizes:
        reps.append(icon.resize((s, s), Image.LANCZOS))
    reps[0].save(OUT + r'\tray.ico', format='ICO', sizes=[(s, s) for s in sizes], append_images=reps[1:])
    # 预览拼图（放大到易看）
    sheet = Image.new('RGBA', (420, 160), (32, 34, 40, 255))
    x = 14
    for s in (48, 32, 24, 20, 16):
        big = icon.resize((s, s), Image.LANCZOS)
        view = big.resize((s * 2, s * 2), Image.NEAREST)
        sheet.alpha_composite(view, (x, 60))
        x += s * 2 + 20
    sheet.save(OUT + r'\_tray_sheet.png')
    print('tray done')

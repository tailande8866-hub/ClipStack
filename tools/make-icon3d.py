"""浮贴 · FloatPaste —— 3D 玻璃图标生成器（numpy + PIL）
风格：清透蓝紫玻璃 squircle，厚玻璃边缘、镜面高光、白色玻璃叠卡。
"""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

S = 1024
SS = 3          # 超采样倍率
W = S * SS
OUT = r"E:\浮贴\resources"


def hexrgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float32)


def linear_gradient(w, h, c0, c1, c2=None, c3=None, diag=True):
    """返回 h*w*3 的 float 渐变"""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    t = (xx / max(w - 1, 1) + yy / max(h - 1, 1)) / 2 if diag else yy / max(h - 1, 1)
    t = np.clip(t, 0, 1)
    img = np.zeros((h, w, 3), np.float32)
    if c2 is None:
        a, b = hexrgb(c0), hexrgb(c1)
        for k in range(3):
            img[..., k] = a[k] * (1 - t) + b[k] * t
    elif c3 is None:
        a, b, c = hexrgb(c0), hexrgb(c1), hexrgb(c2)
        t2 = np.clip(t * 2, 0, 1)
        t3 = np.clip(t * 2 - 1, 0, 1)
        m1 = (1 - t3)[..., None]
        img = (a * (1 - t2)[..., None] + b * t2[..., None]) * (1 - t2)[..., None] * 0
        # 三段：0-0.5 为 a->b，0.5-1 为 b->c
        w1 = np.clip(1 - np.abs(t - 0.0) / 0.5, 0, 1)[..., None]
        img = np.where(t[..., None] < 0.5,
                       a * (1 - t2)[..., None] + b * t2[..., None],
                       b * (1 - t3)[..., None] + c * t3[..., None])
    else:
        a, b, c, d = hexrgb(c0), hexrgb(c1), hexrgb(c2), hexrgb(c3)
        t2 = np.clip(t * 3, 0, 1)
        t3 = np.clip(t * 3 - 1, 0, 1)
        t4 = np.clip(t * 3 - 2, 0, 1)
        img = np.where(t[..., None] < 1 / 3,
                       a * (1 - t2)[..., None] + b * t2[..., None],
                       np.where(t[..., None] < 2 / 3,
                                b * (1 - t3)[..., None] + c * t3[..., None],
                                c * (1 - t4)[..., None] + d * t4[..., None]))
    return img


def squircle_mask(size, n=4.2, inset=0):
    c = size / 2
    r = size / 2 - inset
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    x = (xx - c) / r
    y = (yy - c) / r
    f = (np.abs(x) ** n + np.abs(y) ** n) ** (1.0 / n)
    # 软过渡抗锯齿（约 1.5 超采样像素）
    aa = 1.6 / r
    a = np.clip((1.0 - f) / aa + 0.5, 0, 1)
    return (a * 255).astype(np.uint8)


def to_img(rgb):
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), 'RGB')


def paste_mask(rgb_img, mask):
    out = rgb_img.convert('RGBA')
    out.putalpha(mask)
    return out


def soft_blob(size, cx, cy, rx, ry, color, alpha, blur=0):
    """柔和径向光斑"""
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    d = np.sqrt(((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2)
    a = np.clip(1 - d, 0, 1) ** 2
    rgb = np.zeros((size, size, 3), np.float32)
    rgb[:] = hexrgb(color)
    img = Image.fromarray(rgb.astype(np.uint8), 'RGB')
    m = Image.fromarray((a * alpha * 255).astype(np.uint8), 'L')
    if blur:
        m = m.filter(ImageFilter.GaussianBlur(blur))
    return paste_mask(img, m)


def rounded_mask(size, radius, box):
    m = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle(box, radius=radius, fill=255)
    return m


def card(size, box, radius, face=(255, 255, 255), top=None, bottom=None,
         shadow=(30, 50, 110), shadow_alpha=90, shadow_blur=18, shadow_off=(0, 10),
         extrusion=10, edge=0.9):
    """带厚度(挤出)与投影的玻璃卡"""
    layer = Image.new('RGBA', (size, size), (0, 0, 0, 0))

    # 投影
    sm = rounded_mask(size, radius, (box[0] + shadow_off[0] - 4, box[1] + shadow_off[1] + extrusion,
                                    box[2] + shadow_off[0] + 6, box[3] + shadow_off[1] + extrusion + 4))
    sm = sm.filter(ImageFilter.GaussianBlur(shadow_blur))
    sh = Image.new('RGBA', (size, size), (*shadow, 0))
    sh.putalpha(sm.point(lambda v: int(v * shadow_alpha / 255)))
    layer = Image.alpha_composite(layer, sh)

    # 挤出侧面（下方深色厚度）
    ex = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    exm = rounded_mask(size, radius, (box[0], box[1] + extrusion, box[2], box[3] + extrusion))
    ex.putalpha(exm.point(lambda v: int(v * 150 / 255)))
    ex_rgb = np.zeros((size, size, 3), np.float32)
    ex_rgb[:] = hexrgb('#6F7FC4')
    exr = Image.fromarray(ex_rgb.astype(np.uint8), 'RGB').convert('RGBA')
    exr.putalpha(ex.getchannel('A'))
    layer = Image.alpha_composite(layer, exr)

    # 卡面（带竖向渐变，制造玻璃反光）
    cm = rounded_mask(size, radius, box)
    bm = np.array(cm, np.float32)[..., None] / 255.0
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    t = np.clip((yy - box[1]) / max(box[3] - box[1], 1), 0, 1)[..., None]
    c_top = np.array(top if top else face, np.float32)
    c_bot = np.array(bottom if bottom else face, np.float32)
    rgb = c_top * (1 - t) + c_bot * t
    face_img = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), 'RGB').convert('RGBA')
    face_img.putalpha(cm.point(lambda v: int(v * 0.96)))
    layer = Image.alpha_composite(layer, face_img)

    # 顶部 1px 高光
    hl = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(hl)
    d.line([(box[0] + radius * 0.6, box[1] + 1.2), (box[2] - radius * 0.6, box[1] + 1.2)],
           fill=(255, 255, 255, 235), width=2)
    hl = hl.filter(ImageFilter.GaussianBlur(1.2))
    layer = Image.alpha_composite(layer, hl)

    # 轮廓
    edge_l = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(edge_l)
    d.rounded_rectangle(box, radius=radius, outline=(255, 255, 255, int(255 * edge)), width=2)
    layer = Image.alpha_composite(layer, edge_l)

    # 底部内阴影（玻璃厚度压暗）
    inner = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(inner)
    d.rounded_rectangle((box[0] + 4, box[1] + 4, box[2] - 4, box[3] - 4), radius=max(radius - 4, 2),
                        outline=(70, 90, 170, 90), width=4)
    inner = inner.filter(ImageFilter.GaussianBlur(6))
    layer = Image.alpha_composite(layer, inner)
    return layer


def build():
    size = W
    # ---------- 背景：柔和彩色氛围 ----------
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas = Image.alpha_composite(canvas, soft_blob(size, size * 0.34, size * 0.22,
                                                     size * 0.5, size * 0.5, '#BFE9FF', 0.0))
    # 图标本体尺寸
    body_inset = int(size * 0.03)
    body_box = (body_inset, body_inset, size - body_inset, size - body_inset)
    body_size = body_box[2] - body_box[0]
    cx = (body_box[0] + body_box[2]) / 2
    cy = (body_box[1] + body_box[3]) / 2

    # ---------- 外投影 + 彩色辉光 ----------
    body_mask = squircle_mask(size, 4.2, body_inset)
    sh_mask = Image.fromarray(body_mask, 'L').filter(ImageFilter.GaussianBlur(int(size * 0.035)))
    sh_mask = sh_mask.point(lambda v: int(v * 0.85))
    shadow = Image.new('RGBA', (size, size), (24, 34, 78, 255))
    shadow.putalpha(sh_mask)
    shadow = shadow.crop((0, 0, size, size))
    off = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    off.alpha_composite(shadow, (0, int(size * 0.012)))
    canvas = Image.alpha_composite(canvas, off)

    # ---------- 玻璃主体：四色对角渐变 ----------
    grad = linear_gradient(size, size, '#74D6FF', '#6FA0FF', '#8C86FF', '#B98CF2')
    # 边缘暗化，做出玻璃倒角
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    d = np.sqrt(((xx - cx) / (body_size / 2)) ** 2 + ((yy - cy) / (body_size / 2)) ** 2)
    vig = np.clip(1 - (d ** 2) * 0.20, 0.80, 1)[..., None]
    grad = grad * vig
    # 提升饱和度与亮度，避免偏灰
    lum = grad.mean(axis=2, keepdims=True)
    grad = np.clip(lum + (grad - lum) * 1.55 + 8, 0, 255)

    body_img = to_img(grad).convert('RGBA')
    body_img.putalpha(Image.fromarray(body_mask, 'L'))

    # 底部厚度：下垂的深紫渐变（3D 感的关键）
    depth = np.zeros((size, size, 3), np.float32)
    depth[:] = hexrgb('#5F57C4')
    dm = Image.fromarray(body_mask, 'L')
    dt = np.clip((yy - cy) / (body_size / 2), 0, 1)[..., None]  # 下部更强
    dmask = (np.array(dm, np.float32) * (dt[..., 0] ** 2) * 1.0).astype(np.uint8)
    depth_img = Image.fromarray(depth.astype(np.uint8), 'RGB').convert('RGBA')
    depth_img.putalpha(Image.fromarray(dmask, 'L').filter(ImageFilter.GaussianBlur(int(size * 0.02))))
    canvas = Image.alpha_composite(canvas, depth_img)

    # 上部厚度：顶缘清透亮面（透光）
    light = np.zeros((size, size, 3), np.float32)
    light[:] = hexrgb('#EAF6FF')
    lt = np.clip((cy - yy) / (body_size / 2), 0, 1)[..., None]
    lmask = (np.array(Image.fromarray(body_mask, 'L'), np.float32) * (lt[..., 0] ** 3) * 0.34).astype(np.uint8)
    light_img = Image.fromarray(light.astype(np.uint8), 'RGB').convert('RGBA')
    light_img.putalpha(Image.fromarray(lmask, 'L').filter(ImageFilter.GaussianBlur(int(size * 0.01))))
    canvas = Image.alpha_composite(canvas, light_img)

    canvas = Image.alpha_composite(canvas, body_img)

    # ---------- 玻璃边缘：外亮边 + 内暗边（厚度感） ----------
    m_body = np.array(body_mask, np.float32)
    m_in1 = np.array(squircle_mask(size, 4.2, body_inset + int(size * 0.009)), np.float32)
    m_in2 = np.array(squircle_mask(size, 4.2, body_inset + int(size * 0.020)), np.float32)

    ring_light_a = np.clip(m_body - m_in1, 0, 255)
    vert = np.clip(1.15 - (yy - body_box[1]) / body_size * 1.05, 0.35, 1.25)
    a1 = np.clip(ring_light_a * vert, 0, 255).astype(np.uint8)
    rim = Image.new('RGBA', (size, size), (255, 255, 255, 235))
    rim.putalpha(Image.fromarray(a1, 'L').filter(ImageFilter.GaussianBlur(int(size * 0.002))))
    canvas = Image.alpha_composite(canvas, rim)

    ring_dark_a = np.clip(m_in1 - m_in2, 0, 255)
    a2 = np.clip(ring_dark_a * 0.65, 0, 255).astype(np.uint8)
    rimd = Image.new('RGBA', (size, size), (86, 74, 168, 255))
    rimd.putalpha(Image.fromarray(a2, 'L').filter(ImageFilter.GaussianBlur(int(size * 0.004))))
    canvas = Image.alpha_composite(canvas, rimd)

    # ---------- 内层折射带（边缘一圈薄亮） ----------
    inner_inset = int(size * 0.013)
    ring_mask = squircle_mask(size, 4.2, body_inset + inner_inset)
    ring = Image.new('RGBA', (size, size), (255, 255, 255, 0))
    ring.putalpha(Image.fromarray(np.clip(np.array(ring_mask, np.float32), 0, 255).astype(np.uint8), 'L')
                  .filter(ImageFilter.GaussianBlur(int(size * 0.006))).point(lambda v: int(v * 0.35)))
    canvas = Image.alpha_composite(canvas, ring)

    # ---------- 顶部镜面高光（大椭圆 + 小锐点） ----------
    gloss = soft_blob(size, cx - body_size * 0.20, body_box[1] + body_size * 0.10,
                      body_size * 0.40, body_size * 0.20, '#FFFFFF', 0.62, blur=int(size * 0.03))
    gmask = squircle_mask(size, 4.2, body_inset + 4)
    gloss.putalpha(Image.fromarray(np.minimum(np.array(gloss.getchannel('A'), np.float32),
                                              np.array(gmask, np.float32)).astype(np.uint8), 'L'))
    canvas = Image.alpha_composite(canvas, gloss)

    hot = soft_blob(size, cx - body_size * 0.24, body_box[1] + body_size * 0.13,
                    body_size * 0.14, body_size * 0.06, '#FFFFFF', 1.0, blur=int(size * 0.004))
    hot.putalpha(Image.fromarray(np.minimum(np.array(hot.getchannel('A'), np.float32),
                                            np.array(gmask, np.float32)).astype(np.uint8), 'L'))
    canvas = Image.alpha_composite(canvas, hot)

    # 底部反光弧
    arc = soft_blob(size, cx, body_box[3] - body_size * 0.06,
                    body_size * 0.34, body_size * 0.06, '#D9C8FF', 0.55, blur=int(size * 0.012))
    arc.putalpha(Image.fromarray(np.minimum(np.array(arc.getchannel('A'), np.float32),
                                            np.array(gmask, np.float32)).astype(np.uint8), 'L'))
    canvas = Image.alpha_composite(canvas, arc)

    # ---------- 白色玻璃叠卡（独立图层，整体轻微倾斜 → 3D 立体感） ----------
    cw, ch = int(body_size * 0.40), int(body_size * 0.40)
    r = int(cw * 0.23)
    gap = int(body_size * 0.052)
    total_w = cw * 2 - gap
    total_h = ch * 2 - gap
    left = int(cx - total_w / 2)
    top = int(cy - total_h / 2)

    cards = Image.new('RGBA', (size, size), (0, 0, 0, 0))

    back_box = (left, top + int(body_size * 0.028), left + cw, top + ch + int(body_size * 0.028))
    cards = Image.alpha_composite(cards, card(
        size, back_box, r, face=(238, 245, 255), top=(230, 240, 255), bottom=(182, 204, 250),
        shadow=(40, 58, 126), shadow_alpha=95, shadow_blur=int(size * 0.015),
        shadow_off=(int(size * 0.004), int(size * 0.012)),
        extrusion=int(size * 0.010), edge=0.60))

    front_box = (left + cw - gap, top + ch - gap, left + cw - gap + cw, top + ch - gap + ch)
    cards = Image.alpha_composite(cards, card(
        size, front_box, r, face=(255, 255, 255), top=(255, 255, 255), bottom=(208, 222, 252),
        shadow=(30, 46, 110), shadow_alpha=135, shadow_blur=int(size * 0.018),
        shadow_off=(int(size * 0.006), int(size * 0.014)),
        extrusion=int(size * 0.012), edge=1.0))

    # 前卡文字线条
    fx0, fy0, fx1, fy1 = front_box
    lx0 = fx0 + int(cw * 0.15)
    lx1 = fx1 - int(cw * 0.15)
    ly = fy0 + int(ch * 0.25)

    def bars(y, w2, color):
        dd = ImageDraw.Draw(cards)
        dd.rounded_rectangle((lx0 + 4, y + 5, lx0 + w2 + 4, y + int(ch * 0.058) + 5),
                             radius=7, fill=(64, 86, 150, 55))
        dd.rounded_rectangle((lx0, y, lx0 + w2, y + int(ch * 0.058)), radius=7, fill=color)

    bars(ly, lx1 - lx0, (34, 58, 130, 240))
    bars(ly + int(ch * 0.155), int((lx1 - lx0) * 0.68), (48, 76, 150, 215))
    bars(ly + int(ch * 0.31), int((lx1 - lx0) * 0.46), (66, 94, 168, 195))

    cards = cards.rotate(-7, resample=Image.BICUBIC, center=(cx, cy))
    canvas = Image.alpha_composite(canvas, cards)

    # 斜向玻璃扫光（压在卡片之上，制造反光）
    sheen_c = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(sheen_c)
    d.polygon([(cx - body_size * 0.9, cy + body_size * 0.4),
               (cx - body_size * 0.2, cy - body_size * 0.95),
               (cx + body_size * 0.12, cy - body_size * 0.95),
               (cx - body_size * 0.55, cy + body_size * 0.55)],
              fill=(255, 255, 255, 58))
    sheen_c = sheen_c.filter(ImageFilter.GaussianBlur(int(size * 0.03)))
    sm_mask = Image.fromarray(gmask, 'L')
    sheen_c.putalpha(Image.fromarray(np.minimum(np.array(sheen_c.getchannel('A'), np.float32),
                                                np.array(sm_mask, np.float32)).astype(np.uint8), 'L'))
    canvas = Image.alpha_composite(canvas, sheen_c)
    # ---------- 外轮廓（1px 亮边 + 底部暗边） ----------
    edge_img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(edge_img)
    d.rounded_rectangle(body_box, radius=int(body_size * 0.28), outline=(255, 255, 255, 205), width=3)
    edge_img = edge_img.filter(ImageFilter.GaussianBlur(1.5))
    canvas = Image.alpha_composite(canvas, edge_img)

    # 深色内描边，强化轮廓
    dark_rim = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(dark_rim)
    d.rounded_rectangle((body_box[0] + 2, body_box[1] + 2, body_box[2] - 2, body_box[3] - 2),
                        radius=int(body_size * 0.28), outline=(78, 66, 150, 110), width=3)
    dark_rim = dark_rim.filter(ImageFilter.GaussianBlur(2))
    canvas = Image.alpha_composite(canvas, dark_rim)

    # ---------- 降采样 ----------
    final = canvas.resize((S, S), Image.LANCZOS)
    return final


def save_all(icon):
    icon.save(f"{OUT}\\icon.png")
    icon.resize((512, 512), Image.LANCZOS).save(f"{OUT}\\icon-512.png")
    icon.resize((256, 256), Image.LANCZOS).save(f"{OUT}\\icon-256.png")
    # ICO 多尺寸：以 256 原图为基准，避免从小图放大导致糊
    sizes = [256, 128, 64, 48, 32, 24, 16]
    base = icon.resize((256, 256), Image.LANCZOS)
    base.save(f"{OUT}\\icon.ico", format='ICO', sizes=[(s, s) for s in sizes])
    # 自检拼图
    sheet = Image.new('RGBA', (1024, 300), (12, 15, 22, 255))
    x = 20
    for s in (256, 128, 96, 64, 48, 32, 24, 16):
        im = icon.resize((s, s), Image.LANCZOS)
        sheet.alpha_composite(im, (x, 150 - s // 2))
        x += s + 22
    sheet.save(f"{OUT}\\_sheet.png")


if __name__ == '__main__':
    ic = build()
    save_all(ic)
    print('done', ic.size)

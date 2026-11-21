/**
 * 取自「逆行官网」particles.js（duo-particles）的两套粒子效果，改写成 TS 模块：
 *   mountSilverField(host) → 银尘颗粒（主面板背景）
 *   mountStarfield(host)   → 三层闪烁星空（设置页背景）
 * WebGL2 不可用时银尘静默跳过、星空降级为 2D canvas。
 * 配色跟随 <html data-theme="light|dark">，运行中切换即时生效。
 */

type Mounted = { destroy: () => void } | null

const docEl = () => document.documentElement
const reduceMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const isLight = () => docEl().getAttribute('data-theme') === 'light'

function makeCanvas(host: HTMLElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.setAttribute('aria-hidden', 'true')
  canvas.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;z-index:0'
  host.appendChild(canvas)
  return canvas
}

function getGL(canvas: HTMLCanvasElement): WebGL2RenderingContext | null {
  try {
    return canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'low-power',
    }) as WebGL2RenderingContext | null
  } catch {
    return null
  }
}

function buildProgram(
  gl: WebGL2RenderingContext,
  VS: string,
  FS: string,
  tag: string,
): WebGLProgram | null {
  const compile = (type: number, src: string) => {
    const sh = gl.createShader(type)
    if (!sh) return null
    gl.shaderSource(sh, src)
    gl.compileShader(sh)
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.warn(`[${tag}] shader:`, gl.getShaderInfoLog(sh))
      gl.deleteShader(sh)
      return null
    }
    return sh
  }
  const vs = compile(gl.VERTEX_SHADER, VS)
  const fs = compile(gl.FRAGMENT_SHADER, FS)
  if (!vs || !fs) return null
  const program = gl.createProgram()
  if (!program) return null
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn(`[${tag}] link:`, gl.getProgramInfoLog(program))
    return null
  }
  return program
}

/** 离屏 / 收起到后台自动暂停，resize 自适应（DPR 上限 2） */
function lifecycle(
  host: HTMLElement,
  canvas: HTMLCanvasElement,
  onResize: (w: number, h: number, ratio: number) => void,
  onFrame: (now: number) => void,
): () => void {
  let W = 0
  let H = 0
  let raf = 0
  let visible = true

  const resize = () => {
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    const rect = host.getBoundingClientRect()
    const w = Math.max(1, Math.round(rect.width * ratio))
    const h = Math.max(1, Math.round(rect.height * ratio))
    if (w === W && h === H) return
    W = canvas.width = w
    H = canvas.height = h
    onResize(w, h, ratio)
  }

  const frame = (now: number) => {
    onFrame(now)
    raf = requestAnimationFrame(frame)
  }
  const play = () => {
    if (!raf) raf = requestAnimationFrame(frame)
  }
  const pause = () => {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
  }

  let ro: ResizeObserver | null = null
  if ('ResizeObserver' in window) {
    ro = new ResizeObserver(resize)
    ro.observe(host)
  } else {
    window.addEventListener('resize', resize, { passive: true })
  }
  resize()

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting)
      if (visible && document.visibilityState !== 'hidden') play()
      else pause()
    })
    io.observe(host)
  }
  const onVis = () => {
    if (document.visibilityState === 'hidden') pause()
    else if (visible) play()
  }
  document.addEventListener('visibilitychange', onVis)
  play()

  return () => {
    pause()
    ro?.disconnect()
    document.removeEventListener('visibilitychange', onVis)
  }
}

/* ============================ 星空（三层闪烁） ============================ */
const STAR_VS = `#version 300 es
void main() {
  vec2 c = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(c * 2.0 - 1.0, 0.0, 1.0);
}`

const STAR_FS = `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform float uTime;
uniform float uRatio;
uniform float uLight;
out vec4 outColor;

uint hashU(uvec2 p) {
  uint h = p.x * 0x9e3779b9u ^ p.y * 0x85ebca6bu;
  h ^= h >> 16; h *= 0x7feb352du;
  h ^= h >> 15; h *= 0x846ca68bu;
  h ^= h >> 16;
  return h;
}
float rnd(uvec2 p) { return float(hashU(p) >> 8) / 16777216.0; }

vec3 stars(vec2 px, float spacing, float layer) {
  vec2 g = px / spacing;
  ivec2 cell = ivec2(floor(g));
  uvec2 u = uvec2(cell);
  uint L = uint(layer);
  float seed = rnd(u + uvec2(L * 113u));
  vec2 pos = vec2(rnd(u + uvec2(L * 31u + 7u)), rnd(u + uvec2(L * 53u + 19u)));
  pos = mix(vec2(0.15), vec2(0.85), pos);
  vec2 d = (fract(g) - pos) * spacing;
  float dist = length(d);
  float radius = mix(0.45, 1.25, pow(seed, 3.0));
  float core = exp(-dist * dist / (radius * radius));
  float halo = exp(-dist * dist / (radius * radius * 16.0)) * 0.10;
  float pulse = 0.5 + 0.5 * sin(uTime * mix(1.2, 2.8, seed) + seed * 62.83);
  float twinkle = 0.08 + 0.92 * pow(pulse, 1.8);
  float bright = step(0.94, seed);
  float rays = exp(-abs(d.x) * 6.0) * exp(-abs(d.y) / 3.0)
             + exp(-abs(d.y) * 6.0) * exp(-abs(d.x) / 3.0);
  float lum = (core + halo + rays * bright * 0.18) * twinkle;
  lum *= mix(0.40, 1.25, seed) * step(0.25, rnd(u + uvec2(L * 79u)));
  vec3 cool = uLight > 0.5 ? vec3(0.30, 0.38, 0.54) : vec3(0.70, 0.80, 1.0);
  vec3 warm = uLight > 0.5 ? vec3(0.40, 0.38, 0.34) : vec3(1.0, 0.96, 0.88);
  return mix(cool, warm, seed) * lum;
}

void main() {
  vec2 px = gl_FragCoord.xy / uRatio;
  float starK = uLight > 0.5 ? 0.5 : 1.0;
  vec3 starlight = (stars(px, 38.0, 1.0)
                  + stars(px + vec2(37.0, 71.0), 73.0, 2.0)
                  + stars(px + vec2(109.0, 29.0), 137.0, 3.0)) * starK;
  float peak = max(starlight.r, max(starlight.g, starlight.b));
  outColor = vec4(min(starlight, vec3(1.0)), clamp(peak, 0.0, 1.0));
}`

/* ========================= 银尘颗粒（铺满容器） ========================= */
const SILVER_VS = STAR_VS

const SILVER_FS = `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform float uTime;
uniform float uRatio;
uniform float uLight;
out vec4 outColor;

float rnd(vec2 p) {
  uvec2 q = uvec2(ivec2(floor(p)));
  uint h = q.x * 0x9e3779b9u ^ q.y * 0x85ebca6bu;
  h ^= h >> 16; h *= 0x7feb352du;
  h ^= h >> 15; h *= 0x846ca68bu;
  h ^= h >> 16;
  return float(h >> 8) / 16777216.0;
}
// 局部相干：一片区域的颗粒会一起聚一起散
float coherence(vec2 pixel, float phase) {
  vec2 grid = pixel / 33.6;
  vec2 cell = floor(grid);
  vec2 f = fract(grid);
  vec2 blend = f * f * (3.0 - 2.0 * f);
  float value = 0.0;
  for (int row = 0; row < 2; ++row) {
    for (int col = 0; col < 2; ++col) {
      vec2 nb = cell + vec2(float(col), float(row));
      float organize = 0.5 + 0.5 * sin(phase * 3.2 + rnd(nb + 263.0) * 6.283185);
      float weight = (col == 0 ? 1.0 - blend.x : blend.x) * (row == 0 ? 1.0 - blend.y : blend.y);
      value += organize * weight;
    }
  }
  return value;
}
void main() {
  vec2 pixel = gl_FragCoord.xy / uRatio;
  const float spacing = 2.00;
  float phase = uTime;
  float organize = coherence(pixel, phase);
  vec2 groupCell = floor(pixel / spacing);
  vec2 jitter = vec2(rnd(groupCell + 47.0), rnd(groupCell + 83.0)) - 0.5;
  vec2 point = pixel + vec2(-0.8 * phase, 0.0) + jitter * (0.22 * spacing * 0.49) * organize;
  point.x += sin(pixel.y * 0.037 + phase * 1.6) * 0.35;
  point.y += sin(pixel.x * 0.028 - phase * 1.8) * 0.35;
  vec2 coordinate = point / spacing;
  vec2 cell = mod(floor(coordinate), 4096.0);
  float seed = rnd(cell + 31.0);
  vec2 gj = vec2(rnd(cell + 47.0), rnd(cell + 83.0)) - 0.5;
  vec2 local = fract(coordinate) - 0.5 - gj * 0.22;
  float radius = mix(0.30, 0.48, seed);
  float dist = length(local);
  float grain = 1.0 - smoothstep(radius, radius + 0.07, dist);
  grain += exp(-max(dist - radius, 0.0) * 24.0) * 0.02;
  grain *= step(0.30, rnd(cell + 151.0));
  float wave = 0.5 + 0.5 * sin(phase * mix(2.4, 4.0, rnd(cell + 197.0)) + seed * 6.283185);
  float sparkle = min((0.22 + wave * 0.62 + pow(wave, 5.0) * 0.16) * 1.10, 1.0);
  float cluster = smoothstep(0.30, 0.88, organize);
  // 铺满整块，只保留颗粒自身的聚散闪烁（原版右侧消散留给卡片，这里不需要）
  // 面板底色本来就深，这里只做一层若隐若现的银尘，别抢卡片和文字
  float density = clamp(grain * sparkle * (0.42 + 1.30 * cluster * cluster), 0.0, 1.0);
  float lit = pow(density, 0.85) * smoothstep(0.02, 0.16, density);
  vec3 silver = uLight > 0.5 ? vec3(0.32, 0.39, 0.53) : vec3(0.76, 0.83, 0.93);
  float alpha = lit * (uLight > 0.5 ? 0.22 : 0.46);
  outColor = vec4(silver * alpha, alpha);
}`

function mountGL(
  host: HTMLElement,
  VS: string,
  FS: string,
  tag: string,
  withLight: boolean,
): Mounted {
  const canvas = makeCanvas(host)
  const gl = getGL(canvas)
  if (!gl) {
    canvas.remove()
    return null
  }
  const program = buildProgram(gl, VS, FS, tag)
  if (!program) {
    canvas.remove()
    return null
  }
  gl.useProgram(program)
  const uRes = gl.getUniformLocation(program, 'uResolution')
  const uTime = gl.getUniformLocation(program, 'uTime')
  const uRatio = gl.getUniformLocation(program, 'uRatio')
  const uLight = withLight ? gl.getUniformLocation(program, 'uLight') : null
  gl.disable(gl.DEPTH_TEST)
  gl.disable(gl.CULL_FACE)

  const stop = lifecycle(
    host,
    canvas,
    (w, h, r) => {
      gl.viewport(0, 0, w, h)
      gl.uniform2f(uRes, w, h)
      gl.uniform1f(uRatio, r)
    },
    (now) => {
      gl.uniform1f(uTime, now / 1000)
      if (uLight) gl.uniform1f(uLight, isLight() ? 1 : 0)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    },
  )

  return {
    destroy: () => {
      stop()
      canvas.remove()
    },
  }
}

/** 银尘颗粒：铺满 host（host 需要 position:relative + overflow:hidden） */
export function mountSilverField(host: HTMLElement): Mounted {
  if (!host || reduceMotion()) return null
  return mountGL(host, SILVER_VS, SILVER_FS, 'silver-grains', true)
}

/** 三层闪烁星空：铺满 host */
export function mountStarfield(host: HTMLElement): Mounted {
  if (!host || reduceMotion()) return null
  return mountGL(host, STAR_VS, STAR_FS, 'starfield', true)
}

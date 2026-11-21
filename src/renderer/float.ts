import './float.css'
import { initTheme } from './theme'

initTheme()

const root = document.getElementById('root')!

const ball = document.createElement('button')
ball.className = 'float-ball'
ball.title = '点击展开剪贴栈（右键更多操作）'
ball.innerHTML = `
  <span class="aura" aria-hidden="true"></span>
  <span class="halo" aria-hidden="true"></span>
  <span class="halo-inner" aria-hidden="true"></span>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
       stroke-linecap="round" stroke-linejoin="round">
    <rect x="3.4" y="6.6" width="12.4" height="12.4" rx="3.2" opacity="0.5" />
    <rect x="7.4" y="3.4" width="12.4" height="12.4" rx="3.2" fill="rgba(255,255,255,0.30)" />
    <line x1="10.6" y1="8.2" x2="16.8" y2="8.2" stroke="#2B477A" stroke-width="1.4" />
    <line x1="10.6" y1="11.2" x2="14.6" y2="11.2" stroke="#2B477A" stroke-width="1.4" opacity="0.75" />
  </svg>
`

// 向外散射的粒子（每 3.4s 一圈，与光环呼吸同频）
const sparks = document.createElement('div')
sparks.className = 'sparks'
sparks.setAttribute('aria-hidden', 'true')
for (let i = 0; i < 18; i++) {
  const s = document.createElement('span')
  s.className = 'spark'
  const angle = (i / 18) * Math.PI * 2 + Math.random() * 0.35
  const dist = 26 + Math.random() * 18
  s.style.setProperty('--dx', `${(Math.cos(angle) * dist).toFixed(1)}px`)
  s.style.setProperty('--dy', `${(Math.sin(angle) * dist).toFixed(1)}px`)
  s.style.setProperty('--delay', `${(Math.random() * 3.4).toFixed(2)}s`)
  s.style.setProperty('--size', `${(2 + Math.random() * 2.4).toFixed(1)}px`)
  s.style.setProperty('--hue', i % 3 === 0 ? '#D9ECFF' : i % 3 === 1 ? '#A6C8FF' : '#C9B6FF')
  sparks.appendChild(s)
}
ball.appendChild(sparks)

// 拖动：按住球体移动窗口；是拖动还是单击由主进程按真实鼠标位移判定
// 位移全部由主进程用 screen.getCursorScreenPoint() 自己算，不依赖 pointermove
let dragging = false

ball.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return
  dragging = true
  // 按下就让主进程接管：拖动完全由主进程读真实鼠标位置来走，
  // 不依赖 pointermove（窗口一移动，捕获容易丢，事件链就断）
  window.electronAPI.startFloatDrag()
  try {
    ball.setPointerCapture(e.pointerId)
  } catch {
    /* 忽略 */
  }
})

function endDrag(e: PointerEvent) {
  if (!dragging) return
  dragging = false
  try {
    ball.releasePointerCapture(e.pointerId)
  } catch {
    /* 忽略 */
  }
  // 是拖动还是单击，交给主进程按真实鼠标位移判定（渲染层收不到 pointermove 也不影响）
  window.electronAPI.endFloatDrag()
}

ball.addEventListener('pointerup', endDrag)
// 兜底：窗口移动时 pointer capture 可能断，pointerup 会落到 document / window 上
document.addEventListener('pointerup', endDrag)
window.addEventListener('mouseup', (e) => {
  if (dragging && e.button === 0) endDrag(e as unknown as PointerEvent)
})

// 键盘触发（无障碍）仍然可以展开
ball.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') window.electronAPI.expandFromFloat()
})

ball.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  window.electronAPI.showFloatMenu()
})

root.appendChild(ball)

// 窗口比球大（给光晕渐隐留空间），球之外的透明区域点击穿透
let ignoring = false
const setIgnore = (next: boolean) => {
  if (next === ignoring) return
  ignoring = next
  window.electronAPI.setFloatIgnore(next)
}
const HIT_R = 46 // 球 46px + 少量容差
document.addEventListener('mousemove', (e) => {
  if (dragging) return
  const r = ball.getBoundingClientRect()
  const dx = e.clientX - (r.left + r.width / 2)
  const dy = e.clientY - (r.top + r.height / 2)
  setIgnore(Math.hypot(dx, dy) > HIT_R)
})
window.addEventListener('mouseleave', () => setIgnore(true))
// 已经处于穿透状态时鼠标重新移入：forward 事件依旧会送到页面，可正常恢复
document.addEventListener('mouseenter', (e) => {
  const r = ball.getBoundingClientRect()
  const dx = e.clientX - (r.left + r.width / 2)
  const dy = e.clientY - (r.top + r.height / 2)
  setIgnore(Math.hypot(dx, dy) > HIT_R)
})

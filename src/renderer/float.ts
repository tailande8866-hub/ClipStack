import './float.css'

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

ball.addEventListener('click', () => {
  window.electronAPI.expandFromFloat()
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

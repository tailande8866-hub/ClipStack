/**
 * 删除时的白色细沙消散效果。
 *
 * 为什么单独抽出来：以前粒子层是挂在卡片里的，卡片一卸载粒子就跟着消失。
 * 双排视图删卡必须马上重排（否则会留个空格子、补位猛跳），所以粒子不能依赖卡片的生命周期，
 * 这里直接往 body 挂一层 fixed 粒子层，播完自己删掉，卡片该什么时候移除就什么时候移除。
 */

const COUNT = 420

export interface DissolveRect {
  left: number
  top: number
  width: number
  height: number
}

export function burstDissolve(rect: DissolveRect): void {
  if (typeof document === 'undefined') return

  const layer = document.createElement('div')
  layer.className = 'dissolve-layer'
  layer.setAttribute('aria-hidden', 'true')
  layer.style.left = `${Math.round(rect.left)}px`
  layer.style.top = `${Math.round(rect.top)}px`
  layer.style.width = `${Math.round(rect.width)}px`
  layer.style.height = `${Math.round(rect.height)}px`

  const frag = document.createDocumentFragment()
  for (let i = 0; i < COUNT; i++) {
    const dot = document.createElement('span')
    dot.className = 'dissolve-dot'
    dot.style.setProperty('--px', `${(3 + Math.random() * 94).toFixed(1)}%`)
    dot.style.setProperty('--py', `${(3 + Math.random() * 94).toFixed(1)}%`)
    dot.style.setProperty('--tx', `${(4 + Math.random() * 44).toFixed(1)}px`)
    dot.style.setProperty('--ty', `${(-4 - Math.random() * 32).toFixed(1)}px`)
    dot.style.setProperty('--delay', `${(150 + Math.random() * 320).toFixed(0)}ms`)
    dot.style.setProperty('--dur', `${(820 + Math.random() * 480).toFixed(0)}ms`)
    dot.style.setProperty('--dot', `${(1 + Math.random() * 1.7).toFixed(1)}px`)
    dot.style.setProperty(
      '--dot-hue',
      Math.random() < 0.82 ? 'rgba(255, 255, 255, 0.92)' : 'rgba(214, 232, 252, 0.9)',
    )
    frag.appendChild(dot)
  }
  layer.appendChild(frag)
  document.body.appendChild(layer)

  // 最晚的一颗：150+320 延迟 + 1300 时长，1.7s 后清场
  window.setTimeout(() => layer.remove(), 1700)
}

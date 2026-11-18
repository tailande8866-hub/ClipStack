import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  content: string
  anchor: { left: number; top: number; right: number; bottom: number }
  onClose: () => void
}

/**
 * 文字详情浮层：
 * - 通过 portal 挂到 body，避免被卡片的 overflow:hidden / backdrop-filter 变成"幽灵遮罩"挡住列表点击与滚动
 * - 非模态：不铺全屏蒙层，不会拦截列表的点击和滚轮
 * - 点外部区域 / 按 Esc / 列表滚动时自动关闭
 */
export default function TextDetailPopup({ content, anchor, onClose }: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number }>({
    left: 0,
    top: 0,
    maxHeight: 340
  })

  useLayoutEffect(() => {
    const winW = window.innerWidth
    const winH = window.innerHeight
    const w = 292
    const gap = 8
    const top = Math.max(10, Math.min(anchor.top, winH - 120))
    let left = anchor.left
    if (left + w + 10 > winW) left = winW - w - 10
    if (left < 10) left = 10
    const maxHeight = Math.max(120, winH - top - 12)
    setPos({ left, top, maxHeight })
  }, [anchor])

  const closeTimer = useRef<number | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onScroll = () => onClose()
    document.addEventListener('keydown', onKey)
    window.addEventListener('wheel', onScroll, { passive: true })
    return () => {
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', onScroll)
    }
  }, [onClose])

  const cancelClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }

  // 鼠标离开浮层后自动收起，避免这一层挡住列表的点击与滚轮
  const scheduleClose = () => {
    cancelClose()
    closeTimer.current = window.setTimeout(onClose, 420)
  }

  useEffect(() => cancelClose, [])

  return createPortal(
    <div
      className="detail-pop"
      style={{ left: pos.left, top: pos.top, maxHeight: pos.maxHeight }}
      ref={boxRef}
      onMouseEnter={cancelClose}
      onMouseLeave={scheduleClose}
    >
      <div className="detail-box" style={{ maxHeight: pos.maxHeight }}>
        <div className="detail-header">
          <span className="detail-title">文字详情</span>
          <button className="detail-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="detail-body">{content}</div>
      </div>
    </div>,
    document.body
  )
}

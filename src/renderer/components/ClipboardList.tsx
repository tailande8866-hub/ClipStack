import { useLayoutEffect, useRef, type ReactNode } from 'react'
import type { ClipboardItem } from '../types/clipboard'
import ClipboardCard from './ClipboardCard'

interface Props {
  items: ClipboardItem[]
  onChanged: () => void
  layout?: 'list' | 'grid'
  focusedId?: number | null
}

// 今天 / 昨天 / 11-19 这种小标题，列表长了也能看出时间感
function dayLabel(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diffDays = Math.round((startOf(today) - startOf(d)) / 86400000)
  if (diffDays <= 0) return '今天'
  if (diffDays === 1) return '昨天'
  if (diffDays < 7) return `${diffDays} 天前`
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`
}

export default function ClipboardList({ items, onChanged, layout = 'list', focusedId = null }: Props) {
  const listRef = useRef<HTMLDivElement>(null)
  // 上一次每张卡在列表里的位置（用 offsetTop/Left，不受滚动和动画影响）
  const lastPos = useRef<Map<number, { x: number; y: number }>>(new Map())

  // 删除/置顶之后卡片会重新排列，这里补一段位移动画，让它们滑过去而不是猛跳一下。
  // 双排视图尤其需要：以前删掉左边那张，右边和内层格子会僵在原地，最后才突然补上。
  useLayoutEffect(() => {
    const el = listRef.current
    if (!el) return
    const cards = Array.from(el.querySelectorAll<HTMLElement>('[data-item-id]'))
    const now = new Map<number, { x: number; y: number }>()
    const moves: { card: HTMLElement; dx: number; dy: number; dist: number }[] = []

    cards.forEach((card) => {
      const id = Number(card.dataset.itemId)
      const pos = { x: card.offsetLeft, y: card.offsetTop }
      now.set(id, pos)
      const prev = lastPos.current.get(id)
      if (!prev || card.classList.contains('deleting')) return
      const dx = prev.x - pos.x
      const dy = prev.y - pos.y
      const dist = Math.abs(dx) + Math.abs(dy)
      if (dist < 1) return
      moves.push({ card, dx, dy, dist })
    })

    lastPos.current = now

    // 补位：越靠近空洞的卡片越先动、走得越远，整排顺次推过去。
    // 之前 easeOutExpo 起手太快，看着像“啪”一下弹到位，很生硬；
    // 现在改成两头都收的曲线（起步轻、落位轻），并把错峰拉开一点，慢慢推、慢慢停。
    const grid = layout === 'grid'
    moves.forEach(({ card, dx, dy, dist }) => {
      const delay = grid ? Math.min(110, Math.round(dist / 3.2)) : 0
      card.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)` },
          { transform: 'translate(0, 0)' },
        ],
        {
          duration: grid ? 600 : 420,
          delay,
          easing: grid ? 'cubic-bezier(0.42, 0.03, 0.2, 1)' : 'cubic-bezier(0.34, 0.02, 0.22, 1)',
          fill: 'backwards',
        },
      )
    })
  }, [items, layout])

  if (items.length === 0) return null

  const rows: ReactNode[] = []
  let lastKey = ''

  items.forEach((item) => {
    // 置顶内容单独成一组，固定排在最上面
    const key = item.is_pinned ? 'pinned' : dayLabel(item.created_at)
    if (key !== lastKey) {
      rows.push(
        <div key={`h-${key}-${item.id}`} className="time-group">
          {key === 'pinned' ? '置顶' : key}
        </div>,
      )
      lastKey = key
    }
    rows.push(
      <ClipboardCard key={item.id} item={item} onChanged={onChanged} focused={item.id === focusedId} layout={layout} />,
    )
  })

  return (
    <div ref={listRef} className={`clipboard-list${layout === 'grid' ? ' grid' : ''}`}>
      {rows}
    </div>
  )
}

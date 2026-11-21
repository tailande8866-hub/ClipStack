import type { ReactNode } from 'react'
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
    rows.push(<ClipboardCard key={item.id} item={item} onChanged={onChanged} focused={item.id === focusedId} />)
  })

  return <div className={`clipboard-list${layout === 'grid' ? ' grid' : ''}`}>{rows}</div>
}

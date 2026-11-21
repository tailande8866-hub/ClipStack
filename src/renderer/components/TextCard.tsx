import type { ClipboardItem } from '../types/clipboard'
import { formatTime } from '../utils/time'

interface Props {
  item: ClipboardItem
  onCopy: () => void
}

export default function TextCard({ item, onCopy }: Props) {
  return (
    <div
      className="text-card"
      onClick={onCopy}
      title="点击复制这条内容（也可以直接拖到别的窗口）"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', item.content || '')
        e.dataTransfer.effectAllowed = 'copy'
      }}
    >      <div className="text-card-content">{item.content}</div>
      <div className="text-card-footer">
        {item.is_pinned ? <span className="pin-badge">已置顶</span> : <span />}
        {Number(item.dup_count) > 1 && <span className="dup-badge">×{item.dup_count}</span>}
        <span className="text-card-time">{formatTime(item.created_at)}</span>
      </div>
    </div>
  )
}

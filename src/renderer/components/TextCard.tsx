import type { ClipboardItem } from '../types/clipboard'
import { formatTime } from '../utils/time'

interface Props {
  item: ClipboardItem
  onCopy: () => void
}

export default function TextCard({ item, onCopy }: Props) {
  return (
    <div className="text-card" onClick={onCopy} title="点击复制这条内容">
      <div className="text-card-content">{item.content}</div>
      <div className="text-card-footer">
        {item.is_pinned ? <span className="pin-badge">已置顶</span> : <span />}
        <span className="text-card-time">{formatTime(item.created_at)}</span>
      </div>
    </div>
  )
}

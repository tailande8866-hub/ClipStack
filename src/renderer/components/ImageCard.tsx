import { useState, useEffect } from 'react'
import type { ClipboardItem } from '../types/clipboard'
import { formatTime } from '../utils/time'

interface Props {
  item: ClipboardItem
  onCopy: () => void
}

export default function ImageCard({ item, onCopy }: Props) {
  const [src, setSrc] = useState('')

  useEffect(() => {
    if (item.image_path) {
      window.electronAPI.readImageData(item.image_path).then((dataUrl) => {
        if (dataUrl) setSrc(dataUrl)
      })
    }
  }, [item.image_path])

  return (
    <div className="image-card" onClick={onCopy} title="点击复制这张图片">
      {src ? (
        <img className="image-card-thumb" src={src} alt="" />
      ) : (
        <div className="image-card-placeholder" />
      )}
      <div className="text-card-footer">
        {item.is_pinned ? <span className="pin-badge">已置顶</span> : <span />}
        <span className="text-card-time">{formatTime(item.created_at)}</span>
      </div>
    </div>
  )
}

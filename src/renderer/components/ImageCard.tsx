import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { ClipboardItem } from '../types/clipboard'
import { formatTime } from '../utils/time'

interface Props {
  item: ClipboardItem
  onCopy: () => void
}

export default function ImageCard({ item, onCopy }: Props) {
  const [src, setSrc] = useState('')
  const [preview, setPreview] = useState(false)
  const cardRef = useRef<HTMLDivElement | null>(null)

  // 懒加载：卡片滚进可视范围（前后多留 300px 余量）才去读图，
  // 几十上百张图时不会一次性全读进内存，滚动不卡
  useEffect(() => {
    const el = cardRef.current
    const path = item.image_path
    if (!el || !path) return
    let started = false
    const start = () => {
      if (started) return
      started = true
      window.electronAPI.readImageData(path).then((dataUrl) => {
        if (dataUrl) setSrc(dataUrl)
      })
    }
    if (typeof IntersectionObserver === 'undefined') {
      start()
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) start()
        }
      },
      { rootMargin: '300px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [item.image_path])

  return (
    <>
    <div
      ref={cardRef}
      className="image-card"
      onClick={onCopy}
      title="单击复制这张图片（右上看大图，也可以直接拖到别的窗口）"
      draggable
      onDragStart={(e) => {
        if (!item.image_path) return
        // 图片走系统级拖拽：拖出去就是原始文件，能直接落进微信/Word/文件夹
        e.preventDefault()
        window.electronAPI.startDrag(item.image_path)
      }}
    >
      {src ? (
        <img className="image-card-thumb" src={src} alt="" />
      ) : (
        <div className="image-card-placeholder" />
      )}
      {src && (
        <button
          className="image-card-zoom"
          title="看大图"
          onClick={(e) => {
            // 别让它冒泡成"复制"，看大图就只是看大图
            e.stopPropagation()
            setPreview(true)
          }}
        >
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <path
              d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
      <div className="text-card-footer">
        {item.is_pinned ? <span className="pin-badge">已置顶</span> : <span />}
        {Number(item.dup_count) > 1 && <span className="dup-badge">×{item.dup_count}</span>}
        <span className="text-card-time">{formatTime(item.created_at)}</span>
      </div>
    </div>
    {preview && src &&
      createPortal(
        <div className="img-preview-mask" onClick={() => setPreview(false)}>
          <div className="img-preview-box" onClick={(e) => e.stopPropagation()}>
            <img className="img-preview-img" src={src} alt="" />
            <div className="img-preview-bar">
              <button
                className="img-preview-copy"
                onClick={() => {
                  onCopy()
                  setPreview(false)
                }}
              >
                复制这张图
              </button>
              <button className="img-preview-close" onClick={() => setPreview(false)}>
                关闭
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

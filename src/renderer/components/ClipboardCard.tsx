import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ClipboardItem } from '../types/clipboard'
import TextCard from './TextCard'
import ImageCard from './ImageCard'
import { showToast } from '../toast'

interface Props {
  item: ClipboardItem
  onChanged: () => void
}

type Feedback = null | 'copied' | 'pinned' | 'unpinned'

const BADGE_TEXT: Record<Exclude<Feedback, null>, string> = {
  copied: '已复制',
  pinned: '已置顶',
  unpinned: '已取消置顶',
}

export default function ClipboardCard({ item, onChanged }: Props) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [deleting, setDeleting] = useState(false)
  // 粒子层要脱离卡片（卡片会整体淡出、还会位移，挂里面会被一起糊掉），
  // 所以删除时按卡片当前屏幕位置另外起一层 fixed 层
  const [dissolveRect, setDissolveRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const feedbackTimer = useRef<number | null>(null)

  // 删除粒子：卡片外框先淡掉，里面的东西化成细沙一样的白色微粒飘散
  // 单色、细小、密集；一次性算好随机位置/方向，避免每次 render 都重排
  const particles = useMemo(
    () =>
      Array.from({ length: 450 }, () => ({
        px: 3 + Math.random() * 94, // 撒满整张卡片
        py: 3 + Math.random() * 94,
        tx: 4 + Math.random() * 44, // 轻微往右上飘
        ty: -4 - Math.random() * 32,
        delay: 150 + Math.random() * 320,
        dur: 820 + Math.random() * 480,
        size: 1 + Math.random() * 1.7,
        hue: Math.random() < 0.82 ? 'rgba(255, 255, 255, 0.92)' : 'rgba(214, 232, 252, 0.9)',
      })),
    [],
  )

  function flashCard(kind: 'copy' | 'pin' = 'copy') {
    const el = cardRef.current
    if (!el) return
    const cls = kind === 'pin' ? 'pinned-flash' : 'copied-flash'
    el.classList.add(cls)
    window.setTimeout(() => el.classList.remove(cls), 1400)
  }

  function setFeedbackOnce(next: Exclude<Feedback, null>) {
    if (feedbackTimer.current) window.clearTimeout(feedbackTimer.current)
    setFeedback(next)
    feedbackTimer.current = window.setTimeout(() => setFeedback(null), 1400)
  }

  async function handleCopy() {
    try {
      ;(window as any).electronAPI.diagLog?.('点击复制 id=' + item.id + ' type=' + item.type)
      const ok = await window.electronAPI.copyToClipboard(item.id)
      if (ok) {
        flashCard('copy')
        setFeedbackOnce('copied')
      } else {
        showToast('复制失败')
      }
    } catch (e) {
      ;(window as any).electronAPI.diagLog?.('复制异常 ' + String(e))
      showToast('复制失败')
    }
  }

  async function handlePin() {
    try {
      await window.electronAPI.pinItem(item.id, !item.is_pinned)
      flashCard('pin')
      setFeedbackOnce(item.is_pinned ? 'unpinned' : 'pinned')
      onChanged()
    } catch {
      showToast('操作失败')
    }
  }

  async function handleDelete() {
    if (deleting) return
    const el = cardRef.current
    if (el) {
      const r = el.getBoundingClientRect()
      setDissolveRect({ left: r.left, top: r.top, width: r.width, height: r.height })
    }
    setDeleting(true)
    // 卡片高度跟粒子一起往下收，下面的内容是一路被“顶上来”的，不是最后一跳
    window.setTimeout(async () => {
      try {
        await window.electronAPI.deleteItem(item.id)
        onChanged()
      } catch {
        setDeleting(false)
        setDissolveRect(null)
        showToast('删除失败')
      }
    }, 1900)
  }

  return (
    <div
      ref={cardRef}
      className={`clipboard-card${deleting ? ' deleting' : ''}`}
      data-item-id={item.id}
      data-item-type={item.type}
      data-item-pin={item.is_pinned ? '1' : '0'}
      style={dissolveRect ? ({ ['--dh' as string]: `${dissolveRect.height}px` } as React.CSSProperties) : undefined}
    >
      {item.type === 'text' ? <TextCard item={item} onCopy={handleCopy} /> : <ImageCard item={item} onCopy={handleCopy} />}

      {feedback && (
        <span className={`copy-badge${feedback === 'copied' ? '' : ' badge-pin'}`}>
          {feedback === 'copied' ? (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <polyline points="4 12.5 9.5 18 20 6.5" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6">
              <path d="M12 2.6L14.6 8.8H9.4L12 2.6Z" />
              <line x1="12" y1="8.8" x2="12" y2="16" />
            </svg>
          )}
          {BADGE_TEXT[feedback]}
        </span>
      )}

      {deleting && dissolveRect &&
        createPortal(
          <div
            className="dissolve-layer"
            aria-hidden="true"
            style={{ left: dissolveRect.left, top: dissolveRect.top, width: dissolveRect.width, height: dissolveRect.height }}
          >
            {particles.map((p, i) => (
              <span
                key={i}
                className="dissolve-dot"
                style={{
                  ['--px' as string]: `${p.px.toFixed(1)}%`,
                  ['--py' as string]: `${p.py.toFixed(1)}%`,
                  ['--tx' as string]: `${p.tx.toFixed(1)}px`,
                  ['--ty' as string]: `${p.ty.toFixed(1)}px`,
                  ['--delay' as string]: `${p.delay.toFixed(0)}ms`,
                  ['--dur' as string]: `${p.dur.toFixed(0)}ms`,
                  ['--dot' as string]: `${p.size.toFixed(1)}px`,
                  ['--dot-hue' as string]: p.hue,
                }}
              />
            ))}
          </div>,
          document.body,
        )}

      <div className="card-actions">
        <button
          className={`action-btn ${feedback === 'copied' ? 'action-btn-copied' : ''}`}
          title={feedback === 'copied' ? '已复制' : '复制'}
          onClick={handleCopy}
        >
          {feedback === 'copied' ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
              <polyline points="4 12.5 9.5 18 20 6.5" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
        </button>
        <button
          className={`action-btn ${item.is_pinned ? 'action-btn-active' : ''}`}
          title={item.is_pinned ? '取消置顶' : '置顶'}
          onClick={handlePin}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2L15 9H9L12 2Z" />
            <line x1="12" y1="9" x2="12" y2="22" />
          </svg>
        </button>
        <button className="action-btn action-btn-danger" title="删除" onClick={handleDelete}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      </div>
    </div>
  )
}

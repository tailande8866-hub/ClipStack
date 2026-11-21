import { useRef, useState } from 'react'
import type { ClipboardItem } from '../types/clipboard'
import TextCard from './TextCard'
import ImageCard from './ImageCard'
import { showToast } from '../toast'
import { burstDissolve } from '../dissolve'

interface Props {
  item: ClipboardItem
  onChanged: () => void
  focused?: boolean
  /** 双排（grid）里删除要快、不要收高度，否则卡片会长时间占着格子 */
  layout?: 'list' | 'grid'
}

type Feedback = null | 'copied' | 'pinned' | 'unpinned'

const BADGE_TEXT: Record<Exclude<Feedback, null>, string> = {
  copied: '已复制',
  pinned: '已置顶',
  unpinned: '已取消置顶',
}

export default function ClipboardCard({ item, onChanged, focused = false, layout = 'list' }: Props) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [deleting, setDeleting] = useState(false)
  // 列表视图删除时卡片要一边散一边把高度收掉，这里记住它原来的高度
  const [cardH, setCardH] = useState<number | null>(null)
  const feedbackTimer = useRef<number | null>(null)

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
        // 设置里开了「复制后自动粘贴」就切回刚才那个窗口把内容贴进去（只有文字才贴，图片别抢焦点）
        if (item.type === 'text') {
          window.electronAPI.pasteBackToPrevious?.(item.type).catch(() => { /* 忽略 */ })
        }
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
    const isGrid = layout === 'grid'
    // 粒子层单独挂在 body 上，卡片什么时候移除都不影响它飘完
    if (el) {
      const r = el.getBoundingClientRect()
      burstDissolve({ left: r.left, top: r.top, width: r.width, height: r.height })
      if (!isGrid) setCardH(r.height)
    }
    setDeleting(true)
    // 列表视图：卡片高度跟粒子一起往下收，下面的内容是一路被“顶上来”的
    // 双排视图：格子高度固定，收高度只会留个空洞，所以先快速淡掉，再把空洞交给列表的补位动画
    const delay = isGrid ? 210 : 1900
    window.setTimeout(async () => {
      try {
        await window.electronAPI.deleteItem(item.id)
        onChanged()
      } catch {
        setDeleting(false)
        showToast('删除失败')
      }
    }, delay)
  }

  return (
    <div
      ref={cardRef}
      className={`clipboard-card${deleting ? ' deleting' : ''}${focused ? ' card-focused' : ''}`}
      data-item-id={item.id}
      data-item-type={item.type}
      data-item-pin={item.is_pinned ? '1' : '0'}
      style={cardH ? ({ ['--dh' as string]: `${cardH}px` } as React.CSSProperties) : undefined}
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

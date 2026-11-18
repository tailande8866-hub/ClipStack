import { useState } from 'react'
import type { ClipboardItem } from '../types/clipboard'
import TextCard from './TextCard'
import ImageCard from './ImageCard'

interface Props {
  item: ClipboardItem
  onChanged: () => void
}

export default function ClipboardCard({ item, onChanged }: Props) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    const ok = await window.electronAPI.copyToClipboard(item.id)
    if (ok) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    }
  }

  async function handlePin() {
    await window.electronAPI.pinItem(item.id, !item.is_pinned)
    onChanged()
  }

  async function handleDelete() {
    await window.electronAPI.deleteItem(item.id)
    onChanged()
  }

  return (
    <div className="clipboard-card">
      {item.type === 'text' ? <TextCard item={item} onCopy={handleCopy} /> : <ImageCard item={item} onCopy={handleCopy} />}

      <div className="card-actions">
        {copied && <span className="copy-toast">已复制</span>}
        <button className="action-btn" title="复制" onClick={handleCopy}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
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

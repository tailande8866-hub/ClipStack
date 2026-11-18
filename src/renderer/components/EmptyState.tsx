export default function EmptyState() {
  return (
    <div className="empty-state">
      <svg width="92" height="92" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.4">
        <rect x="10" y="18" width="30" height="30" rx="7" opacity="0.4" />
        <rect x="17" y="11" width="30" height="30" rx="7" />
        <line x1="23" y1="21" x2="41" y2="21" opacity="0.8" />
        <line x1="23" y1="28" x2="35" y2="28" opacity="0.6" />
        <circle cx="49" cy="14" r="2" opacity="0.85" />
      </svg>
      <p className="empty-state-text">复制一次，随手取回</p>
      <p className="empty-state-hint">复制过的文字和图片，都会轻轻浮现在这里</p>
    </div>
  )
}

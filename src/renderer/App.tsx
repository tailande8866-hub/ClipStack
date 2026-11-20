import { useState, useCallback, useEffect, useRef } from 'react'
import './App.css'
import { useClipboardHistory } from './hooks/useClipboardHistory'
import SearchBar from './components/SearchBar'
import RetentionSelector from './components/RetentionSelector'
import ClipboardList from './components/ClipboardList'
import EmptyState from './components/EmptyState'
import { subscribeToast } from './toast'

const IconGear = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
)

export default function App() {
  const [search, setSearch] = useState('')
  const { items, refresh } = useClipboardHistory(search)
  const probeRef = useRef<HTMLButtonElement>(null)
  const aliveRef = useRef(false)
  const [toastMsg, setToastMsg] = useState('')
  const toastTimer = useRef(0)

  // 新版本提示：新版本发布后，第一次启动会在面板顶部弹一张"更新内容"卡
  type UpdateInfo = {
    hasUpdate: boolean
    seen: boolean
    current: string
    latest: string | null
    notes: string | null
    url: string | null
    publishedAt?: string | null
  }
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [installing, setInstalling] = useState(false)
  const [progress, setProgress] = useState<{ phase: string; percent?: number; received?: number; total?: number } | null>(null)

  useEffect(() => {
    const api = window.electronAPI as unknown as {
      getUpdateStatus?: () => Promise<UpdateInfo | null>
      onUpdateAvailable?: (cb: (info: UpdateInfo) => void) => () => void
      dismissUpdate?: (v: string) => Promise<boolean>
      openExternal?: (url: string) => Promise<unknown>
      installUpdate?: () => Promise<{ ok: boolean; message: string }>
      onUpdateProgress?: (cb: (p: { phase: string; percent?: number }) => void) => () => void
    }
    api.getUpdateStatus?.().then((u) => {
      if (u && u.hasUpdate && !u.seen) setUpdateInfo(u)
    }).catch(() => { /* 静默 */ })
    const off = api.onUpdateAvailable?.((u) => {
      if (u && u.hasUpdate) setUpdateInfo(u)
    })
    const offProgress = api.onUpdateProgress?.((p) => setProgress(p))
    return () => { off?.(); offProgress?.() }
  }, [])

  const progressPercent = progress?.percent ?? 0
  const progressText = (() => {
    if (!progress) return '准备中…'
    if (progress.phase === 'download') {
      const mb = (n: number) => (n / 1024 / 1024).toFixed(1)
      return progress.total
        ? `正在下载 ${progressPercent}%（${mb(progress.received || 0)} / ${mb(progress.total)} MB）`
        : `正在下载 ${mb(progress.received || 0)} MB`
    }
    if (progress.phase === 'extract') return '正在解压…'
    return '正在替换文件，马上重启…'
  })()

  async function handleInstall() {
    const api = window.electronAPI as unknown as {
      installUpdate?: () => Promise<{ ok: boolean; message: string }>
    }
    setInstalling(true)
    setProgress(null)
    const r = await api.installUpdate?.()
    if (!r) {
      setInstalling(false)
      return
    }
    if (!r.ok) {
      setInstalling(false)
      setProgress(null)
      setToastMsg('更新失败：' + r.message)
      window.clearTimeout(toastTimer.current)
      toastTimer.current = window.setTimeout(() => setToastMsg(''), 4000)
    }
    // ok 时主进程会在几百毫秒后自行退出并重启，这里不做额外处理
  }

  function dismissUpdate() {
    const v = updateInfo?.latest
    setUpdateInfo(null)
    if (v) (window.electronAPI as unknown as { dismissUpdate?: (v: string) => void }).dismissUpdate?.(v)
  }

  // 操作反馈统一走全局提示，卡片因为列表刷新重排而丢 state 也不会漏提示
  useEffect(() => {
    return subscribeToast((msg) => {
      setToastMsg(msg)
      window.clearTimeout(toastTimer.current)
      toastTimer.current = window.setTimeout(() => setToastMsg(''), 2200)
    })
  }, [])

  // 自愈探针：长时间运行后 React 事件可能莫名失效（点哪都没反应），
  // 每 20 秒用一次隐藏按钮点击验证，失效就自动重载页面把事件重新挂上。
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.hidden) return
      aliveRef.current = false
      probeRef.current?.click()
      window.setTimeout(() => {
        if (aliveRef.current) return
        const last = Number(sessionStorage.getItem('ui-reload-at') || 0)
        if (Date.now() - last < 60000) return
        sessionStorage.setItem('ui-reload-at', String(Date.now()))
        console.warn('[self-heal] 检测到点击无响应，自动重载界面')
        location.reload()
      }, 400)
    }, 20000)
    return () => window.clearInterval(timer)
  }, [])

  const handleSearch = useCallback((query: string) => {
    setSearch(query)
  }, [])

  // 卡片靠近发光（跟随的光斑层已移除）
  useEffect(() => {
    let raf = 0

    const update = (x: number, y: number) => {
      document.querySelectorAll<HTMLElement>('.clipboard-card').forEach((card) => {
        const r = card.getBoundingClientRect()
        // 只有指针真的落在卡片上（含 4px 容差）才亮，避免"没碰到也有反应"
        const inside = x >= r.left - 4 && x <= r.right + 4 && y >= r.top - 4 && y <= r.bottom + 4
        card.classList.toggle('near', inside)
      })
    }

    const onMove = (e: MouseEvent) => {
      const x = e.clientX
      const y = e.clientY
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        update(x, y)
      })
    }
    const onLeave = () => {
      document.querySelectorAll('.clipboard-card').forEach((c) => c.classList.remove('near'))
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseleave', onLeave)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseleave', onLeave)
    }
  }, [])

  return (
    <>
      <div className="ambient" aria-hidden="true">
        <span className="blob b1" />
        <span className="blob b2" />
        <span className="blob b3" />
        <span className="blob b4" />
      </div>
      <div className="dust" aria-hidden="true" />
      <div className="sheen" aria-hidden="true" />
      <div className="dot-veil" aria-hidden="true" />


      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">
            <svg viewBox="0 0 24 24" fill="none" stroke="#F4FAFF" strokeWidth="1.7" strokeLinecap="round">
              <rect x="3.6" y="6.6" width="12" height="12" rx="3" opacity="0.55" />
              <rect x="7.6" y="3.6" width="12" height="12" rx="3" fill="rgba(255,255,255,0.35)" stroke="none" />
              <line x1="11" y1="8.6" x2="17" y2="8.6" stroke="#25406B" strokeWidth="1.5" />
              <line x1="11" y1="11.6" x2="15" y2="11.6" stroke="#25406B" strokeWidth="1.5" opacity="0.8" />
            </svg>
          </span>
          <div className="brand-text">
            <h1>剪贴栈</h1>
            <span className="brand-sub">复制截图历史仓库</span>
          </div>
        </div>

        <div className="header-actions">
          <RetentionSelector />
          <button className="header-btn" title="设置" onClick={() => window.electronAPI.openSettings()}>
            <IconGear />
          </button>
          <button className="header-btn" title="收起到悬浮球" onClick={() => window.electronAPI.collapseToFloat()}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
      </header>

      <SearchBar onSearch={handleSearch} />

      {updateInfo && (
        <div className="update-card">
          <div className="update-head">
            <span className="update-dot" aria-hidden="true" />
            <strong>发现新版本 v{updateInfo.latest}</strong>
            <span className="update-cur">当前 v{updateInfo.current}</span>
            <button className="update-close" title="关闭" onClick={dismissUpdate}>×</button>
          </div>
          <div className="update-notes">
            {(updateInfo.notes || '（这次更新没有写说明，可以直接下载新版）')
              .replace(/\r/g, '')
              .split('\n')
              .filter((line) => line.trim())
              .slice(0, 12)
              .map((line, i) => (
                <p key={i}>{line.replace(/^#+\s*/, '').replace(/\*\*/g, '').replace(/^[-*]\s*/, '· ')}</p>
              ))}
          </div>
          <div className="update-actions">
            {!installing && (
              <button className="update-btn" onClick={handleInstall}>
                {'一键更新'}
              </button>
            )}
            {installing && (
              <div className="update-progress">
                <div className="update-progress-bar">
                  <span style={{ width: `${progressPercent}%` }} />
                </div>
                <div className="update-progress-text">{progressText}</div>
              </div>
            )}
            <button className="update-btn ghost" onClick={dismissUpdate}>
              知道了
            </button>
          </div>
        </div>
      )}
      <div className="list-area">
        {items.length === 0 ? <EmptyState /> : <ClipboardList items={items} onChanged={refresh} />}
      </div>

      {toastMsg && <div className="global-toast">{toastMsg}</div>}

      <button
        ref={probeRef}
        aria-hidden="true"
        tabIndex={-1}
        className="event-probe"
        onClick={() => {
          aliveRef.current = true
          document.documentElement.dataset.uiAlive = String(Date.now())
        }}
      />
    </>
  )
}

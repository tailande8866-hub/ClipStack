import { useState, useCallback, useEffect, useRef } from 'react'
import './App.css'
import { useClipboardHistory } from './hooks/useClipboardHistory'
import SearchBar from './components/SearchBar'
import RetentionSelector from './components/RetentionSelector'
import ClipboardList from './components/ClipboardList'
import EmptyState from './components/EmptyState'
import type { HistoryFilter } from './types/clipboard'
import { subscribeToast } from './toast'

const FILTERS: { key: HistoryFilter; label: string }[] = [
  { key: '', label: '全部' },
  { key: 'image', label: '图片' },
  { key: 'text', label: '文字' },
  { key: 'link', label: '链接' },
  { key: 'pinned', label: '置顶' },
]

const IconGear = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
)

export default function App() {
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<HistoryFilter>('')
  const { items, refresh } = useClipboardHistory(search, filter)
  const [focusIndex, setFocusIndex] = useState(-1)
  const [sources, setSources] = useState<{ app: string; count: number }[]>([])

  // 来源筛选：最近从哪几个程序复制的（动态 chip，按条数排）
  useEffect(() => {
    let alive = true
    const load = () => {
      window.electronAPI
        .getTopSources()
        .then((list) => { if (alive) setSources(list || []) })
        .catch(() => { /* 忽略 */ })
    }
    load()
    const off = window.electronAPI.onDataChanged(load)
    return () => { alive = false; off() }
  }, [])
  const probeRef = useRef<HTMLButtonElement>(null)
  const aliveRef = useRef(false)
  const [toastMsg, setToastMsg] = useState('')
  const toastTimer = useRef(0)
  const listRef = useRef<HTMLDivElement>(null)
  const [showToTop, setShowToTop] = useState(false)
  // 视图：单列 / 网格（网格一屏能看十几张图）
  const [layout, setLayout] = useState<'list' | 'grid'>(() =>
    localStorage.getItem('clipstack-layout') === 'grid' ? 'grid' : 'list',
  )
  const toggleLayout = useCallback(() => {    setLayout((prev) => {
      const next = prev === 'grid' ? 'list' : 'grid'
      localStorage.setItem('clipstack-layout', next)
      const el = listRef.current
      if (el) el.scrollTop = 0
      return next
    })
  }, [])

  // 搜索防抖：输入停 300ms 再查
  useEffect(() => {
    const t = window.setTimeout(() => setSearch(query), 300)
    return () => window.clearTimeout(t)
  }, [query])

  // 键盘操作：↑↓ 选卡片、Enter 复制、Esc 先把搜索清空、再按收起
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl+F：直接把光标送进搜索框，随手就能筛
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        const input = document.querySelector<HTMLInputElement>('.search-input')
        if (input) {
          e.preventDefault()
          input.focus()
          input.select()
        }
        return
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (items.length === 0) return
        e.preventDefault()
        setFocusIndex((prev) => {
          if (e.key === 'ArrowDown') return prev < 0 ? 0 : Math.min(items.length - 1, prev + 1)
          return prev < 0 ? 0 : Math.max(0, prev - 1)
        })
        return
      }
      if (e.key === 'Enter' && focusIndex >= 0) {
        const it = items[focusIndex]
        if (!it) return
        e.preventDefault()
        window.electronAPI.copyToClipboard(it.id).then((ok) => {
          if (ok) {
            setToastMsg('已复制')
            window.clearTimeout(toastTimer.current)
            toastTimer.current = window.setTimeout(() => setToastMsg(''), 1600)
          }
        }).catch(() => { /* 忽略 */ })
        return
      }
      if (e.key === 'Escape') {
        if (query) setQuery('')
        else window.electronAPI.collapseToFloat()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [items, focusIndex, query])

  // 选中的卡片自动滚进视野
  useEffect(() => {
    if (focusIndex < 0) return
    const id = items[focusIndex]?.id
    if (!id) return
    document
      .querySelector(`.clipboard-card[data-item-id="${id}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focusIndex, items])

  // 换搜索词 / 换筛选时清掉选中
  useEffect(() => {
    setFocusIndex(-1)
  }, [search, filter])

  // 往下翻找老图片时，右下角出现一个小箭头，点一下平滑回到顶部
  useEffect(() => {
    const tick = () => {
      const el = listRef.current
      if (el) setShowToTop(el.scrollTop > 160)
    }
    tick()
    const timer = window.setInterval(tick, 250)
    return () => window.clearInterval(timer)
  }, [])

  const backToTop = useCallback(() => {
    const el = listRef.current
    if (!el) return
    setShowToTop(false)
    el.scrollTo({ top: 0, behavior: 'smooth' })
    // 兜底：窗口被遮挡时浏览器可能不跑平滑动画，500ms 后还没回去就直接跳
    window.setTimeout(() => {
      if (listRef.current && listRef.current.scrollTop > 2) listRef.current.scrollTop = 0
    }, 500)
  }, [])

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
  useEffect(() => {
    const api = window.electronAPI as unknown as {
      getUpdateStatus?: () => Promise<UpdateInfo | null>
      openSettings?: () => Promise<unknown>
    }
    // 有新版本时不再在主面板里塞卡片，而是直接把设置窗的更新说明弹窗弹出来
    const pop = (u: UpdateInfo | null) => {
      if (!u || !u.hasUpdate) return
      api.openSettings?.().catch(() => { /* 静默 */ })
    }
    api.getUpdateStatus?.().then((u) => pop(u)).catch(() => { /* 静默 */ })
  }, [])


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

      <div className="search-row">
        <SearchBar value={query} onChange={setQuery} />
        <button
          className="layout-toggle"
          title={layout === 'grid' ? '切成单列' : '切成网格（图片看得更多）'}
          onClick={toggleLayout}
        >
          {layout === 'grid' ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="3.5" y="4.5" width="17" height="6" rx="2" />
              <rect x="3.5" y="13.5" width="17" height="6" rx="2" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="3.5" y="4" width="7.5" height="7.5" rx="2" />
              <rect x="13" y="4" width="7.5" height="7.5" rx="2" />
              <rect x="3.5" y="13" width="7.5" height="7.5" rx="2" />
              <rect x="13" y="13" width="7.5" height="7.5" rx="2" />
            </svg>
          )}
        </button>
      </div>

      <div className="filter-chips" data-src-count={sources.length}>
        {FILTERS.map((f) => (
          <button
            key={f.key || 'all'}
            className={`chip${filter === f.key ? ' chip-on' : ''}`}
            onClick={() => {
              setFilter(f.key)
              if (listRef.current) listRef.current.scrollTop = 0
            }}
          >
            {f.label}
          </button>
        ))}
        {sources.map((s) => {
          const key = `src:${s.app}` as HistoryFilter
          return (
            <button
              key={key}
              className={`chip chip-src${filter === key ? ' chip-on' : ''}`}
              title={`只看从 ${s.app} 复制的（${s.count} 条）`}
              onClick={() => {
                setFilter(filter === key ? '' : key)
                if (listRef.current) listRef.current.scrollTop = 0
              }}
            >
              {s.app}
            </button>
          )
        })}
      </div>

      <div className="list-area" ref={listRef}>
        {items.length === 0 ? (
          <EmptyState />
        ) : (
          <ClipboardList
            items={items}
            onChanged={refresh}
            layout={layout}
            focusedId={items[focusIndex]?.id ?? null}
          />
        )}
      </div>

      <button
        className={`to-top${showToTop ? ' show' : ''}`}
        title="回到顶部"
        aria-hidden={!showToTop}
        tabIndex={showToTop ? 0 : -1}
        onClick={backToTop}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M12 19V6" />
          <path d="M6 12l6-6 6 6" />
        </svg>
      </button>

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

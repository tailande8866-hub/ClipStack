import { useState, useEffect, useCallback, useRef } from 'react'
import type { ClipboardItem, HistoryFilter } from '../types/clipboard'

/** 统一排序：置顶的永远在最上面，其余按时间倒序 */
function sortItems(list: ClipboardItem[]): ClipboardItem[] {
  const timeOf = (it: ClipboardItem) => {
    const raw = it.created_at as unknown
    if (typeof raw === 'number') return raw
    const t = new Date(String(raw)).getTime()
    return Number.isFinite(t) ? t : 0
  }
  return [...list].sort((a, b) => {
    const pinnedDiff = (Number(b.is_pinned) || 0) - (Number(a.is_pinned) || 0)
    if (pinnedDiff !== 0) return pinnedDiff
    return timeOf(b) - timeOf(a)
  })
}

export function useClipboardHistory(search?: string, filter: HistoryFilter = '') {
  const [items, setItems] = useState<ClipboardItem[]>([])
  const [loading, setLoading] = useState(true)
  const searchRef = useRef(search)
  const filterRef = useRef<HistoryFilter>(filter)

  const refresh = useCallback(async () => {
    const result = await window.electronAPI.getHistory(
      searchRef.current || undefined,
      100,
      0,
      filterRef.current || undefined,
    )
    setItems(sortItems(result))
    setLoading(false)
  }, [])

  useEffect(() => {
    searchRef.current = search
    filterRef.current = filter
    refresh()
  }, [search, filter, refresh])

  useEffect(() => {
    const unsubscribe = window.electronAPI.onNewItem((item) => {
      if (searchRef.current || filterRef.current) return
      const id = Number((item as { id?: unknown } | null)?.id)
      // 兜底：万一收到的 id 无效（0/NaN），不插假卡片，直接回库重查
      if (!Number.isFinite(id) || id <= 0) {
        refresh()
        return
      }
      // 同一条被再次复制时 id 不变、时间变新：先按 id 摘掉旧的再插到最前，
      // 否则会出现两张一模一样的卡片
      setItems((prev) => sortItems([item, ...prev.filter((it) => it.id !== id)]))
    })
    const unsubscribeData = window.electronAPI.onDataChanged(() => {
      refresh()
    })
    return () => {
      unsubscribe()
      unsubscribeData()
    }
  }, [refresh])

  return { items, loading, refresh }
}

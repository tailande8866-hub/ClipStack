import { useState, useEffect, useCallback, useRef } from 'react'
import type { ClipboardItem } from '../types/clipboard'

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

export function useClipboardHistory(search?: string) {
  const [items, setItems] = useState<ClipboardItem[]>([])
  const [loading, setLoading] = useState(true)
  const searchRef = useRef(search)

  const refresh = useCallback(async () => {
    const result = await window.electronAPI.getHistory(searchRef.current || undefined, 100, 0)
    setItems(sortItems(result))
    setLoading(false)
  }, [])

  useEffect(() => {
    searchRef.current = search
    refresh()
  }, [search, refresh])

  useEffect(() => {
    const unsubscribe = window.electronAPI.onNewItem((item) => {
      if (!searchRef.current) {
        setItems((prev) => sortItems([item, ...prev]))
      }
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

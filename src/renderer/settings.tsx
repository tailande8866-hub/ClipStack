import { useState, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './settings.css'
import appIcon from './assets/app-icon.png'
import heroArt from './assets/hero-aurora.jpg'
import type { SettingsInfo, UpdateProgress, ClipboardItem } from './types/clipboard'
import { formatTime } from './utils/time'
import { initTheme, setThemeClass } from './theme'

type TabKey = 'general' | 'storage' | 'feedback' | 'about'

const RETENTION_OPTIONS = [
  { value: '24', label: '1 天' },
  { value: '72', label: '3 天' },
  { value: '168', label: '7 天' },
  { value: '720', label: '30 天' },
  { value: '0', label: '永久' },
]

function retentionLabel(v: string): string {
  const hours = parseInt(v, 10)
  if (!Number.isFinite(hours) || hours <= 0) return '永久'
  if (hours < 24) return `${hours} 小时`
  const days = hours / 24
  return Number.isInteger(days) ? `${days} 天` : `${hours} 小时`
}

function formatReleaseDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 把 Release 正文拆成可渲染的行：标题 / 要点 / 段落 */function notesBlocks(notes: string | null | undefined): Array<{ kind: 'h' | 'li' | 'p'; text: string }> {
  if (!notes) return []
  const out: Array<{ kind: 'h' | 'li' | 'p'; text: string }> = []
  for (const raw of notes.replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd()
    if (!line.trim()) continue
    if (/^[-*_]{3,}$/.test(line.trim())) continue
    const clean = line
      .replace(/\*\*/g, '')
      .replace(/`/g, '')
      .replace(/\[(.+?)\]\(.+?\)/g, '$1')
      .trim()
    if (/^#{1,6}\s/.test(clean)) {
      out.push({ kind: 'h', text: clean.replace(/^#{1,6}\s*/, '') })
    } else if (/^[-*+]\s/.test(clean)) {
      out.push({ kind: 'li', text: clean.replace(/^[-*+]\s+/, '') })
    } else if (line.startsWith('    ') || line.startsWith('\t')) {
      out.push({ kind: 'p', text: clean })
    } else {
      out.push({ kind: 'p', text: clean })
    }
  }
  return out
}

const IconGear = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
)

const IconFolder = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
)

const IconBug = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <rect x="8" y="6" width="8" height="14" rx="4" />
    <path d="M12 6V3M9 3h6M4 10h4M16 10h4M5 16h3M16 16h3M6 20l2-2M18 20l-2-2" />
  </svg>
)

const IconInfo = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
)

const IconGitHub = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="6" cy="6" r="3" />
    <path d="M18 9v3a3 3 0 0 1-3 3h-6a3 3 0 0 1-3-3V6" />
  </svg>
)

const IconChat = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.7 9.7 0 0 1-3.8-.8L3 21l1.9-4.6a8.4 8.4 0 0 1-1.4-4.9 8.4 8.4 0 0 1 9-8.4 8.4 8.4 0 0 1 8.5 8.4z" />
  </svg>
)

const IconDoc = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="9" y1="13" x2="15" y2="13" />
    <line x1="9" y1="17" x2="13" y2="17" />
  </svg>
)

const IconMail = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
    <polyline points="3.5 7 12 13 20.5 7" />
  </svg>
)

const IconRefresh = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <polyline points="21 3 21 9 15 9" />
    <path d="M3 13a9 9 0 0 1 15-6.4L21 9" />
    <polyline points="3 21 3 15 9 15" />
    <path d="M21 11a9 9 0 0 1-15 6.4L3 15" />
  </svg>
)

const IconDown = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
)

const IconExt = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
)

const IconChev = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="9 18 15 12 9 6" />
  </svg>
)

const NAV: { key: TabKey; label: string; icon: ReactNode }[] = [
  { key: 'general', label: '通用', icon: <IconGear /> },
  { key: 'storage', label: '存储位置', icon: <IconFolder /> },
  { key: 'feedback', label: 'Bug 反馈', icon: <IconBug /> },
  { key: 'about', label: '关于', icon: <IconInfo /> },
]

type Notice = { type: string; text: string } | null

interface ItemRowProps {
  icon: ReactNode
  title: string
  subtitle?: ReactNode
  right?: ReactNode
  onClick?: () => void
}

function ItemRow({ icon, title, subtitle, right, onClick }: ItemRowProps) {
  return (
    <div className={`item-row ${onClick ? 'clickable' : ''}`} onClick={onClick}>
      <div className="icon-box">{icon}</div>
      <div className="row-main">
        <div className="row-title">{title}</div>
        {subtitle && <div className="row-sub">{subtitle}</div>}
      </div>
      {right !== undefined && <div className="row-right">{right}</div>}
    </div>
  )
}

function App() {
  const [tab, setTab] = useState<TabKey>('general')
  const [info, setInfo] = useState<SettingsInfo | null>(null)
  const [days, setDays] = useState('24')
  const [pending, setPending] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)

  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<SettingsInfo['updateCheck']>(null)
  const [autoUpdate, setAutoUpdate] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [backupBusy, setBackupBusy] = useState(false)
  // 回收站
  const [trashItems, setTrashItems] = useState<ClipboardItem[]>([])
  const [trashCount, setTrashCount] = useState(0)
  const [trashBusy, setTrashBusy] = useState(false)
  const [emptyConfirm, setEmptyConfirm] = useState(false)
  const [trashKeep, setTrashKeep] = useState('30')
  // 隐私
  const [sensitiveSkip, setSensitiveSkip] = useState(true)
  const [sensitiveExtra, setSensitiveExtra] = useState('')
  // 复制后自动粘贴
  const [pasteBack, setPasteBack] = useState(false)
  // 外观
  const [themeMode, setThemeMode] = useState<'dark' | 'light' | 'auto'>('dark')
  const [installing, setInstalling] = useState(false)
  const [progress, setProgress] = useState<UpdateProgress | null>(null)
  const [notesOpen, setNotesOpen] = useState(false)
  const [installError, setInstallError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const i = await window.electronAPI.getSettingsInfo()
    setInfo(i)
    if (i.updateCheck) setCheckResult(i.updateCheck)
    setAutoUpdate(i.autoCheckUpdate)
  }, [])

  useEffect(() => {
    load()
    window.electronAPI.getSetting('retention_hours').then((v) => {
      if (v) setDays(v)
    })
    window.electronAPI.getUpdateStatus().then((s) => {
      if (s) setCheckResult(s)
    })
    loadTrash()
    window.electronAPI.getSetting('sensitive_skip').then((v) => {
      if (v !== null) setSensitiveSkip(v !== '0')
    })
    window.electronAPI.getSetting('sensitive_extra').then((v) => {
      if (v) setSensitiveExtra(v)
    })
    window.electronAPI.getSetting('paste_after_copy').then((v) => {
      setPasteBack(v === '1')
    })
    window.electronAPI.getSetting('theme').then((v) => {
      setThemeMode(v === 'light' || v === 'auto' ? v : 'dark')
    })
    const off = window.electronAPI.onUpdateAvailable((u) => {
      setCheckResult(u)
      if (u && u.hasUpdate) {
        setTab('about')
        setNotesOpen(true)
      }
    })
    const offProgress = window.electronAPI.onUpdateProgress((p) => {
      setProgress(p)
    })
    return () => {
      off()
      offProgress()
    }
  }, [load])

  function switchTab(k: TabKey) {
    setTab(k)
    setNotice(null)
    if (k === 'storage') loadTrash()
  }

  async function loadTrash() {
    try {
      const [list, count, keep] = await Promise.all([
        window.electronAPI.getTrash(''),
        window.electronAPI.getTrashCount(),
        window.electronAPI.getSetting('trash_keep_days'),
      ])
      setTrashItems(list)
      setTrashCount(count)
      if (keep) setTrashKeep(keep)
    } catch {
      /* 读取失败不影响其它设置 */
    }
  }

  async function restoreOne(id: number) {
    setTrashBusy(true)
    try {
      await window.electronAPI.restoreItem(id)
      setNotice({ type: 'ok', text: '已恢复到列表最上面。' })
    } catch {
      setNotice({ type: 'err', text: '恢复失败。' })
    }
    await loadTrash()
    setTrashBusy(false)
  }

  async function purgeOne(id: number) {
    setTrashBusy(true)
    try {
      await window.electronAPI.purgeItem(id)
      setNotice({ type: 'ok', text: '已彻底删除。' })
    } catch {
      setNotice({ type: 'err', text: '删除失败。' })
    }
    await loadTrash()
    setTrashBusy(false)
  }

  async function emptyAll() {
    if (!emptyConfirm) {
      setEmptyConfirm(true)
      setNotice({ type: 'warn', text: '再点一次「清空回收站」才会真的删掉，删除后不可恢复。' })
      return
    }
    setEmptyConfirm(false)
    setTrashBusy(true)
    try {
      const n = await window.electronAPI.emptyTrash()
      setNotice({ type: 'ok', text: `已清空回收站，共删掉 ${n} 项。` })
    } catch {
      setNotice({ type: 'err', text: '清空失败。' })
    }
    await loadTrash()
    setTrashBusy(false)
  }

  async function changeTrashKeep(v: string) {
    setTrashKeep(v)
    await window.electronAPI.setSetting('trash_keep_days', v)
    setNotice({ type: 'ok', text: `回收站保留 ${v} 天，超期自动彻底清空。` })
  }

  async function togglePasteBack() {
    const next = !pasteBack
    setPasteBack(next)
    await window.electronAPI.setSetting('paste_after_copy', next ? '1' : '0')
    setNotice({
      type: 'ok',
      text: next
        ? '已开启：点卡片复制后会自动切回刚才的窗口并粘贴。'
        : '已关闭：复制后仍留在存贴屋面板，需要自己切窗口粘贴。',
    })
  }

  async function chooseTheme(next: 'dark' | 'light' | 'auto') {
    setThemeMode(next)
    await window.electronAPI.setSetting('theme', next)
    if (next === 'auto') {
      const sys = await window.electronAPI.resolveTheme?.()
      setThemeClass(sys === 'light' ? 'light' : 'dark')
      setNotice({ type: 'ok', text: '已跟随系统：Windows 切深浅色时这里会自动变。' })
      return
    }
    setThemeClass(next)
    setNotice({ type: 'ok', text: next === 'light' ? '已切换为浅色主题。' : '已切换为深色主题。' })
  }

  async function toggleSensitiveSkip() {
    const next = !sensitiveSkip
    setSensitiveSkip(next)
    await window.electronAPI.setSetting('sensitive_skip', next ? '1' : '0')
    setNotice({
      type: 'ok',
      text: next ? '已开启：像密码/密钥/卡号的文本不再进历史。' : '已关闭：所有复制的文本都会记录（含密码类内容）。',
    })
  }

  async function saveSensitiveExtra() {
    await window.electronAPI.setSetting('sensitive_extra', sensitiveExtra.trim())
    setNotice({ type: 'ok', text: '屏蔽词已保存，之后复制的内容会按新规则过滤。' })
  }

  async function changeRetention(v: string) {
    setDays(v)
    await window.electronAPI.setSetting('retention_hours', v)
    const label = retentionLabel(v)
    setNotice({
      type: 'ok',
      text: label === '永久'
        ? '已设为永久保留，记录不会被自动清理。'
        : `已设为 ${label}，从现在开始计时：之后复制的内容满 ${label} 自动移进回收站（图片文件不会删，随时能恢复）。`,
    })
  }

  async function toggleAutostart() {
    if (!info) return
    const next = await window.electronAPI.setAutostart(!info.autostart)
    setInfo({ ...info, autostart: next })
  }

  async function chooseDir() {
    const p = await window.electronAPI.chooseDataDir()
    if (!p) return
    setPending(p)
    setNotice(null)
  }

  async function applyPending() {
    if (!pending) return
    setBusy(true)
    const r = await window.electronAPI.applyDataDir(pending)
    setBusy(false)
    if (r.ok) {
      setPending(null)
      await load()
      setNotice({ type: 'ok', text: '存放目录已切换，现有复制记录和图片已迁移过去。' })
    } else {
      setNotice({ type: 'err', text: '切换失败：' + (r.message || '未知错误') })
    }
  }

  async function resetDir() {
    setBusy(true)
    const r = await window.electronAPI.resetDataDir()
    setBusy(false)
    if (r.ok) {
      setPending(null)
      await load()
      setNotice({ type: 'ok', text: '已恢复为默认存放目录，记录已迁移。' })
    } else {
      setNotice({ type: 'err', text: '恢复失败：' + (r.message || '未知错误') })
    }
  }

  async function openDir() {
    const target = pending || info?.dataDir
    if (!target) return
    const err = await window.electronAPI.openDataDir(target)
    if (err) setNotice({ type: 'err', text: '无法打开目录：' + err })
  }

  async function copyQQ() {
    const group = info?.qqGroup || '913838378'
    await window.electronAPI.copyText(group)
    setNotice({ type: 'ok', text: `QQ 号已复制：${group}，打开 QQ 搜索加我即可。` })
  }

  async function copyEmail() {
    const mail = info?.email || 'duanmwsj@qq.com'
    await window.electronAPI.copyText(mail)
    setNotice({ type: 'ok', text: `邮箱已复制：${mail}，可直接发送问题与建议。` })
  }

  async function copyDiag() {
    const text = await window.electronAPI.getDiagnosticsText()
    await window.electronAPI.copyText(text)
    setNotice({ type: 'ok', text: '诊断信息已复制到剪贴板，可直接粘贴发给开发者。' })
  }

  async function exportDiag() {
    setExporting(true)
    const r = await window.electronAPI.exportDiagnostics()
    setExporting(false)
    if (r.ok) {
      setNotice({ type: 'ok', text: '诊断信息已导出：' + r.path })
    } else if (!r.canceled) {
      setNotice({ type: 'err', text: '导出失败：' + (r.message || '未知错误') })
    }
  }

  async function doExportBackup() {
    setBackupBusy(true)
    try {
      const r = await window.electronAPI.exportBackup()
      if (r?.ok) setNotice({ type: 'ok', text: '备份已导出：' + r.path })
      else if (!r?.canceled) setNotice({ type: 'err', text: '导出失败：' + (r?.message || '未知错误') })
    } finally {
      setBackupBusy(false)
    }
  }

  async function doRestoreBackup() {
    setBackupBusy(true)
    try {
      const r = await window.electronAPI.restoreBackup()
      if (r?.ok) setNotice({ type: 'ok', text: '备份已恢复，正在重启…' })
      else if (!r?.canceled) setNotice({ type: 'err', text: '恢复失败：' + (r?.message || '未知错误') })
    } finally {
      setBackupBusy(false)
    }
  }

  async function doCheckUpdate() {
    setChecking(true)
    setNotice(null)
    const r = await window.electronAPI.checkUpdate()
    setChecking(false)
    setCheckResult(r)
    if (!r.ok) {
      setNotice({ type: 'warn', text: r.message })
    } else if (r.hasUpdate) {
      setNotesOpen(true)
    } else {
      setNotice({ type: 'ok', text: r.message })
    }
  }

  async function closeNotes() {
    setNotesOpen(false)
    // 用户点了关闭/×，就记成"已提示过"，下次启动不再打扰
    if (checkResult?.latest) {
      await window.electronAPI.dismissUpdate(checkResult.latest)
      setCheckResult({ ...checkResult, seen: true })
    }
  }

  async function doInstallUpdate() {
    if (installing) return
    setInstalling(true)
    setInstallError(null)
    setProgress(null)
    setNotice(null)
    const r = await window.electronAPI.installUpdate()
    setInstalling(false)
    if (r.ok) {
      setNotesOpen(false)
      setNotice({ type: 'ok', text: r.message })
    } else {
      setInstallError(r.message)
      setNotice({ type: 'err', text: '更新失败：' + r.message })
    }
  }

  async function toggleAutoUpdate() {
    const next = await window.electronAPI.setAutoCheckUpdate(!autoUpdate)
    setAutoUpdate(next)
  }

  const lastCheckText = (() => {
    if (!checkResult) return '尚未检查过更新'
    const t = new Date(checkResult.time)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `上次检查 ${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())} · ${checkResult.message}`
  })()

  const progressText = (() => {
    if (!progress) return '准备中…'
    if (progress.phase === 'download') {
      const mb = (n: number) => (n / 1024 / 1024).toFixed(1)
      const total = progress.total ? ` / ${mb(progress.total)} MB` : ''
      const suffix = progress.message ? ` · ${progress.message}` : ''
      return `正在下载 ${progress.percent ?? 0}%（${mb(progress.received ?? 0)}${total}）${suffix}`
    }
    if (progress.phase === 'extract') return '正在解压并校验文件…'
    return '文件已就绪，正在替换并重启…'
  })()

  return (
    <>
      <div className="ambient" aria-hidden="true">
        <span className="blob b1" />
        <span className="blob b2" />
        <span className="blob b3" />
      </div>
      <div className="dust" aria-hidden="true" />
      <div className="sheen" aria-hidden="true" />

      <div className="titlebar">
        <div className="titlebar-title">
          <span className="dot">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <rect x="3.6" y="6.6" width="12" height="12" rx="3" opacity="0.55" />
              <rect x="7.6" y="3.6" width="12" height="12" rx="3" fill="rgba(255,255,255,0.4)" stroke="none" />
              <line x1="10.8" y1="8.6" x2="16.6" y2="8.6" stroke="#2A4777" strokeWidth="1.4" />
              <line x1="10.8" y1="11.4" x2="14.6" y2="11.4" stroke="#2A4777" strokeWidth="1.4" />
            </svg>
          </span>
          <span>设置 · 存贴屋</span>
        </div>
        <div className="win-btns">
          <button className="win-btn" title="最小化" onClick={() => window.electronAPI.minimizeSettings()}>
            <svg width="12" height="12" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none">
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <button className="win-btn close" title="关闭" onClick={() => window.electronAPI.closeSettings()}>
            <svg width="12" height="12" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      <div className="body-wrap">
        <aside className="sidebar">
          <h2>设置</h2>
          {NAV.map((n) => (
            <button
              key={n.key}
              className={`nav-item ${tab === n.key ? 'active' : ''}`}
              onClick={() => switchTab(n.key)}
            >
              {n.icon}
              <span>{n.label}</span>
            </button>
          ))}
        </aside>

        <main className="content">
          {tab === 'general' && (
            <>
              <div className="page-title">通用</div>
              <div className="page-desc">控制复制记录的保留时长和启动方式。</div>

              <div className="section-label">记录</div>
              <div className="card">
                <div className="row">
                  <div>
                    <div className="row-label">保留时长</div>
                    <div className="row-hint">超过该时长的复制记录会自动清理，置顶记录不删除；选「永久」则永不清理。</div>
                  </div>
                  <select value={days} onChange={(e) => changeRetention(e.target.value)}>
                    {RETENTION_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="section-label">启动</div>
              <div className="card">
                <div className="row">
                  <div>
                    <div className="row-label">开机自动启动</div>
                    <div className="row-hint">登录 Windows 后自动在后台运行，随时按 Ctrl+Shift+V 呼出。</div>
                  </div>
                  <button
                    className={`switch ${info?.autostart ? 'on' : ''}`}
                    onClick={toggleAutostart}
                    aria-label="开机自动启动"
                  />
                </div>

                <div className="row">
                  <div>
                    <div className="row-label">复制后自动粘贴回去</div>
                    <div className="row-hint">
                      点卡片复制后，自动切回你刚才在用的窗口按一次 Ctrl+V。默认关闭：打开后每次复制都会把焦点交还给那个窗口。
                    </div>
                  </div>
                  <button
                    className={`switch ${pasteBack ? 'on' : ''}`}
                    onClick={togglePasteBack}
                    aria-label="复制后自动粘贴回去"
                  />
                </div>
              </div>

              {notice && <div className={`notice notice-${notice.type}`}>{notice.text}</div>}

              <div className="section-label">外观</div>
              <div className="card">
                <div className="row">
                  <div>
                    <div className="row-label">主题</div>
                    <div className="row-hint">
                      面板、设置页和悬浮球一起换。跟随系统会按 Windows 的深浅色自动切换。
                    </div>
                  </div>
                  <div className="theme-seg">
                    {([
                      ['dark', '深色'],
                      ['light', '浅色'],
                      ['auto', '跟随系统'],
                    ] as const).map(([value, label]) => (
                      <button
                        key={value}
                        className={`theme-seg-btn ${themeMode === value ? 'on' : ''}`}
                        onClick={() => chooseTheme(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="section-label">隐私</div>
              <div className="card">
                <div className="row">
                  <div>
                    <div className="row-label">跳过敏感内容</div>
                    <div className="row-hint">
                      密码管理器标了「不记录」的内容、看起来像密码/密钥/卡号的长串，直接不进历史。
                    </div>
                  </div>
                  <button
                    className={`switch ${sensitiveSkip ? 'on' : ''}`}
                    onClick={toggleSensitiveSkip}
                    aria-label="跳过敏感内容"
                  />
                </div>

                <div className="row" style={{ alignItems: 'flex-start' }}>
                  <div style={{ flex: '1 1 auto' }}>
                    <div className="row-label">额外屏蔽词</div>
                    <div className="row-hint">每行一个，复制的内容里带这些词就不入库（比如自己公司名、客户名）。</div>
                    <textarea
                      className="sensitive-input"
                      value={sensitiveExtra}
                      onChange={(e) => setSensitiveExtra(e.target.value)}
                      onBlur={saveSensitiveExtra}
                      placeholder={'一行一个词，留空表示不额外屏蔽'}
                      rows={4}
                    />
                  </div>
                </div>
              </div>
            </>
          )}

          {tab === 'storage' && (
            <>
              <div className="page-title">存储位置</div>
              <div className="page-desc">最近复制的文本和图片保存在这里，可以换到其他磁盘。</div>

              <div className="section-label">当前存放目录</div>
              <div className="card">
                <div className="row">
                  <div className="row-label">复制记录目录</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span className={`badge ${info?.isCustom ? '' : 'badge-default'}`}>
                      {info?.isCustom ? '自定义' : '默认'}
                    </span>
                    <span className="badge badge-default">占用 {info?.sizeMB ?? 0} MB</span>
                  </div>
                </div>

                <div className="path-box">
                  <span className="path-text">{info?.dataDir || '读取中…'}</span>
                </div>

                <div className="actions">
                  <button className="btn" onClick={openDir}>打开目录</button>
                  <button className="btn" onClick={chooseDir} disabled={busy}>更改目录…</button>
                  <button className="btn" onClick={resetDir} disabled={busy || !info?.isCustom}>恢复默认</button>
                </div>

                <div className="notice notice-info">
                  <span>
                    文本记录存放在 <b>data.db</b>，图片存放在 <b>images</b> 子目录。
                    更改目录后会自动把现有记录迁移过去，原目录中的文件不会删除。
                  </span>
                </div>
              </div>

              {pending && (
                <>
                  <div className="section-label">待应用的更改</div>
                  <div className="card">
                    <div className="row">
                      <div>
                        <div className="row-label">新的存放目录</div>
                        <div className="row-hint">点击下方按钮后立即迁移现有记录。</div>
                      </div>
                    </div>
                    <div className="path-box">
                      <span className="path-text">{pending}</span>
                    </div>
                    <div className="actions">
                      <button className="btn-primary" onClick={applyPending} disabled={busy}>
                        {busy ? '迁移中…' : '应用并迁移'}
                      </button>
                      <button className="btn" onClick={() => setPending(null)} disabled={busy}>取消</button>
                    </div>
                  </div>
                </>
              )}

              {notice && <div className={`notice notice-${notice.type}`}>{notice.text}</div>}

              <div className="section-label">回收站</div>
              <div className="card">
                <div className="row">
                  <div>
                    <div className="row-label">回收站里 {trashCount} 条</div>
                    <div className="row-hint">
                      到期和手动删除的记录先放这里，图片文件都还留着；超过保留天数才彻底清空。
                    </div>
                  </div>
                  <div className="trash-head">
                    <select
                      className="retention-select"
                      value={trashKeep}
                      onChange={(e) => changeTrashKeep(e.target.value)}
                      disabled={trashBusy}
                    >
                      <option value="3">保留 3 天</option>
                      <option value="7">保留 7 天</option>
                      <option value="30">保留 30 天</option>
                      <option value="90">保留 90 天</option>
                    </select>
                    <button className="btn" onClick={loadTrash} disabled={trashBusy}>刷新</button>
                    <button
                      className="btn"
                      onClick={emptyAll}
                      disabled={trashBusy || trashCount === 0}
                      style={emptyConfirm ? { borderColor: '#E08A8A', color: '#FFB4B4' } : undefined}
                    >
                      {emptyConfirm ? '确认清空？' : '清空回收站'}
                    </button>
                  </div>
                </div>

                <div className="trash-list">
                  {trashItems.length === 0 && <div className="trash-empty">回收站是空的</div>}
                  {trashItems.map((it) => (
                    <div className="trash-row" key={it.id}>
                      {it.type === 'image' ? (
                        <span className="trash-tag">图片</span>
                      ) : (
                        <span className="trash-tag trash-tag-text">文字</span>
                      )}
                      <div className="trash-main">
                        <div className="trash-text">
                          {it.type === 'image' ? (it.ocr_text || '（截图，识别不到文字）') : (it.content || '')}
                        </div>
                        <div className="trash-meta">
                          {formatTime(it.archived_at || it.created_at)} 移入
                          {it.source_app ? ` · 来自 ${it.source_app}` : ''}
                        </div>
                      </div>
                      <button className="btn" onClick={() => restoreOne(it.id)} disabled={trashBusy}>恢复</button>
                      <button className="btn" onClick={() => purgeOne(it.id)} disabled={trashBusy}>彻底删除</button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {tab === 'feedback' && (
            <>
              <div className="page-title">Bug 反馈</div>
              <div className="page-desc">遇到问题或有功能建议，从这里告诉我。</div>

              <div className="section-label">问题与建议</div>
              <div className="card card-list">
                <ItemRow
                  icon={<IconGitHub />}
                  title="GitHub Issues"
                  subtitle="提交问题或功能建议"
                  right={<span className="mini-icon">{<IconExt />}</span>}
                  onClick={() => window.electronAPI.openExternal(info?.issuesUrl || 'https://github.com/tailande8866-hub/ClipStack/issues')}
                />
                <ItemRow
                  icon={<IconMail />}
                  title="联系邮箱"
                  subtitle={`${info?.email || 'duanmwsj@qq.com'} · 点击复制邮箱`}
                  right={<span className="mini-icon">{<IconChev />}</span>}
                  onClick={copyEmail}
                />
                <ItemRow
                  icon={<IconChat />}
                  title="QQ 交流群"
                  subtitle={`QQ：${info?.qqGroup || '913838378'} · 点击复制号码`}
                  right={<span className="mini-icon">{<IconChev />}</span>}
                  onClick={copyQQ}
                />
              </div>

              <div className="section-label">数据备份</div>
              <div className="card card-list">
                <ItemRow
                  icon={<IconDoc />}
                  title="导出备份"
                  subtitle="把数据库和所有图片打成一个 zip，换电脑/重装前先存一份"
                  right={
                    <button className="btn" onClick={doExportBackup} disabled={backupBusy}>
                      {backupBusy ? '处理中…' : '导出…'}
                    </button>
                  }
                />
                <ItemRow
                  icon={<IconDoc />}
                  title="从备份恢复"
                  subtitle="选一个备份 zip 覆盖当前数据，旧数据会自动留在旁边一份"
                  right={
                    <button className="btn" onClick={doRestoreBackup} disabled={backupBusy}>
                      {backupBusy ? '处理中…' : '选择文件…'}
                    </button>
                  }
                />
              </div>

              <div className="section-label">本地诊断</div>
              <div className="card card-list">
                <ItemRow
                  icon={<IconDoc />}
                  title="导出诊断信息"
                  subtitle="生成一份只含运行状态的 txt（不含任何复制内容），便于排查问题"
                  right={
                    <>
                      <button className="btn" onClick={copyDiag}>复制</button>
                      <button className="btn" onClick={exportDiag} disabled={exporting}>
                        {exporting ? '导出中…' : '导出…'}
                      </button>
                    </>
                  }
                />
              </div>

              {notice && <div className={`notice notice-${notice.type}`}>{notice.text}</div>}
            </>
          )}

          {tab === 'about' && (
            <>
              <div className="page-title">关于</div>

              <div className="about-hero">
                <div className="hero-art" style={{ backgroundImage: `url(${heroArt})` }} aria-hidden="true" />
                <div className="hero-shade" aria-hidden="true" />
                <div className="hero-gloss" aria-hidden="true" />
                <div className="hero-inner">
                  <div className="about-logo">
                    <img src={appIcon} alt="存贴屋" />
                  </div>
                  <div className="hero-text">
                    <div className="about-name">存贴屋</div>
                    <div className="about-sub">你的复制截图历史仓库</div>
                    <div className="about-ver">存贴屋 · v{info?.version || '1.1.0'} · Windows</div>
                  </div>
                </div>
              </div>

              <div className="section-label">软件更新</div>
              <div className="card card-list">
                <ItemRow
                  icon={<IconRefresh />}
                  title="检查更新"
                  subtitle={lastCheckText}
                  right={
                    <button className="btn" onClick={doCheckUpdate} disabled={checking || installing}>
                      {checking ? '检查中…' : '检查更新…'}
                    </button>
                  }
                />

                {checkResult && checkResult.ok && checkResult.hasUpdate && (
                  <div className="update-panel update-panel-quiet">
                    <span className="uv-dot uv-dot-new" />
                    发现新版本 v{checkResult.latest}
                    <button className="link-btn" onClick={() => setNotesOpen(true)}>查看更新说明</button>
                  </div>
                )}

                {checkResult && checkResult.ok && !checkResult.hasUpdate && (
                  <div className="update-panel update-panel-quiet">
                    <span className="uv-dot" />已是最新版本 v{checkResult.current}
                  </div>
                )}

                <ItemRow
                  icon={<IconDown />}
                  title="自动检查更新"
                  subtitle="启动后自动向 GitHub 查询是否有新版本"
                  right={
                    <button
                      className={`switch ${autoUpdate ? 'on' : ''}`}
                      onClick={toggleAutoUpdate}
                      aria-label="自动检查更新"
                    />
                  }
                />
              </div>

              <div className="section-label">项目</div>
              <div className="card card-list">
                <ItemRow
                  icon={<IconGitHub />}
                  title="源代码与说明"
                  subtitle="github.com/tailande8866-hub/ClipStack"
                  right={<span className="mini-icon">{<IconExt />}</span>}
                  onClick={() => window.electronAPI.openExternal(info?.repoUrl || 'https://github.com/tailande8866-hub/ClipStack')}
                />
                <ItemRow
                  icon={<IconDoc />}
                  title="开源许可"
                  subtitle="MIT License"
                  right={<span className="mini-icon">{<IconExt />}</span>}
                  onClick={() => window.electronAPI.openExternal((info?.repoUrl || 'https://github.com/tailande8866-hub/ClipStack') + '/blob/master/LICENSE')}
                />
              </div>

              <div className="section-label">运行信息</div>
              <div className="card">
                <div className="kv">
                  <span className="kv-k">呼出快捷键</span>
                  <span className="kv-v">Ctrl + Shift + V</span>
                </div>
                <div className="kv">
                  <span className="kv-k">复制记录</span>
                  <span className="kv-v">
                    共 {info?.stats?.total ?? 0} 条（文本 {info?.stats?.textCount ?? 0} / 图片 {info?.stats?.imageCount ?? 0}）
                  </span>
                </div>
                <div className="kv">
                  <span className="kv-k">数据目录</span>
                  <span className="kv-v">{info?.dataDir}</span>
                </div>
                <div className="kv">
                  <span className="kv-k">程序位置</span>
                  <span className="kv-v">{info?.exePath}</span>
                </div>
              </div>

              {notice && <div className={`notice notice-${notice.type}`}>{notice.text}</div>}
            </>
          )}
        </main>
      </div>

      {notesOpen && checkResult && (
        <div className="notes-overlay" onClick={closeNotes}>
          <div className="notes-modal" onClick={(e) => e.stopPropagation()}>
            <div className="notes-head">
              <div className="notes-head-text">
                <div className="notes-title">v{checkResult.latest} 更新说明</div>
                <div className="notes-sub">
                  当前 v{checkResult.current}
                  {checkResult.publishedAt ? ` · ${formatReleaseDate(checkResult.publishedAt)}` : ''}
                </div>
              </div>
              <button className="notes-close" title="关闭" onClick={closeNotes}>
                ×
              </button>
            </div>

            <div className="notes-body">
              {notesBlocks(checkResult.notes).length === 0 ? (
                <p className="notes-empty">这次发布没有写更新说明，可以直接更新。</p>
              ) : (
                notesBlocks(checkResult.notes).map((b, i) =>
                  b.kind === 'h' ? (
                    <div className="notes-h" key={i}>{b.text}</div>
                  ) : b.kind === 'li' ? (
                    <div className="notes-li" key={i}>
                      <span className="notes-dot" />
                      <span>{b.text}</span>
                    </div>
                  ) : (
                    <p className="notes-p" key={i}>{b.text}</p>
                  )
                )
              )}
            </div>

            <div className="notes-foot">
              <button className="btn btn-ghost" onClick={closeNotes} disabled={installing}>
                关闭
              </button>
              <button
                className="btn btn-primary"
                onClick={() => { doInstallUpdate() }}
                disabled={installing || !checkResult.assetUrl}
              >
                {installing ? '更新中…' : '更新'}
              </button>
            </div>
            {installing && (
              <div className="notes-progress">
                <div className="update-progress-bar">
                  <span style={{ width: `${progress?.percent ?? 0}%` }} />
                </div>
                <div className="update-progress-text">{progressText}</div>
              </div>
            )}
            {!installing && installError && (
              <div className="notes-error">{installError}</div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

initTheme()

createRoot(document.getElementById('root')!).render(<App />)


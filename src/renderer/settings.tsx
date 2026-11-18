import { useState, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './settings.css'
import appIcon from './assets/app-icon.png'
import heroArt from './assets/hero-aurora.jpg'
import type { SettingsInfo } from './types/clipboard'

type TabKey = 'general' | 'storage' | 'feedback' | 'about'

const RETENTION_OPTIONS = [
  { value: '2', label: '2 小时' },
  { value: '4', label: '4 小时' },
  { value: '6', label: '6 小时' },
  { value: '24', label: '1 天' },
  { value: '72', label: '3 天' },
  { value: '168', label: '7 天' },
  { value: '0', label: '永久' },
]

function retentionLabel(v: string): string {
  const hours = parseInt(v, 10)
  if (!Number.isFinite(hours) || hours <= 0) return '永久'
  if (hours < 24) return `${hours} 小时`
  const days = hours / 24
  return Number.isInteger(days) ? `${days} 天` : `${hours} 小时`
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
  const [days, setDays] = useState('3')
  const [pending, setPending] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)

  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<SettingsInfo['updateCheck']>(null)
  const [autoUpdate, setAutoUpdate] = useState(true)
  const [exporting, setExporting] = useState(false)

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
    const off = window.electronAPI.onUpdateAvailable((u) => {
      setCheckResult(u)
    })
    return off
  }, [load])

  function switchTab(k: TabKey) {
    setTab(k)
    setNotice(null)
  }

  async function changeRetention(v: string) {
    setDays(v)
    await window.electronAPI.setSetting('retention_hours', v)
    const label = retentionLabel(v)
    setNotice({
      type: 'ok',
      text: label === '永久'
        ? '已设为永久保留，记录不会被自动清理。'
        : `保留时长已设为 ${label}，超期记录会自动清理。`,
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

  async function doCheckUpdate() {
    setChecking(true)
    setNotice(null)
    const r = await window.electronAPI.checkUpdate()
    setChecking(false)
    setCheckResult(r)
    if (!r.ok) {
      setNotice({ type: 'warn', text: r.message })
    } else if (r.hasUpdate) {
      setNotice({ type: 'ok', text: r.message + '，可到 GitHub 仓库下载新版本。' })
    } else {
      setNotice({ type: 'ok', text: r.message })
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
          <span>设置 · 剪贴栈</span>
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
              </div>

              {notice && <div className={`notice notice-${notice.type}`}>{notice.text}</div>}
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
                    <img src={appIcon} alt="剪贴栈" />
                  </div>
                  <div className="hero-text">
                    <div className="about-name">剪贴栈</div>
                    <div className="about-sub">你的复制截图历史仓库</div>
                    <div className="about-ver">ClipStack · v{info?.version || '1.1.0'} · Windows</div>
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
                    <button className="btn" onClick={doCheckUpdate} disabled={checking}>
                      {checking ? '检查中…' : '检查更新…'}
                    </button>
                  }
                />
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
    </>
  )
}

createRoot(document.getElementById('root')!).render(<App />)

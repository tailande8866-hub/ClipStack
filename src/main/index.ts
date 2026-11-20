import {
  app,
  BrowserWindow,
  protocol,
  net,
  screen,
  Tray,
  Menu,
  globalShortcut,
  nativeImage,
  ipcMain,
  dialog,
  shell,
  clipboard,
  powerMonitor,
} from 'electron'
import { isAbsolute, join, resolve, dirname, basename } from 'path'
import fs from 'fs'
import { createHash } from 'crypto'
import { spawn, execFileSync } from 'child_process'
import {
  initDatabase,
  closeDatabase,
  getImagesDir,
  remapImagePaths,
  getStats,
  getSetting,
  setSetting,
  getDbPath,
} from './database'
import { startMonitoring, stopMonitoring, onNewItem } from './clipboard-monitor'
import { registerIpcHandlers, setMainWindow, notifyNewItem } from './ipc-handlers'
import { startCleanupScheduler, stopCleanupScheduler } from './cleanup-scheduler'
import {
  getDataDir,
  defaultDataDir,
  saveDataDir,
  resetDataDir,
  isCustomDataDir,
  dirSizeMB,
  ensureDirWritable,
  copyDirContents,
} from './data-dir'

let mainWindow: BrowserWindow | null = null
let floatWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let blurHideReady = false
// 主面板被"收起"时不是 hide()，而是挪到屏幕外；用它记录这个状态
let panelParked = false

const MAIN_W = 320
const MAIN_H = 440
const FLOAT_SIZE = 128  // 窗口留出光圈渐隐空间，球体本体 46px
const FLOAT_MARGIN = 8
const EDGE_MARGIN = 16

// 改名后仍沿用原来的数据目录，避免历史记录"丢失"
app.setPath('userData', join(app.getPath('appData'), 'clipboard-history'))

// 反馈 / 更新相关常量
const REPO = 'tailande8866-hub/ClipStack'
const REPO_URL = `https://github.com/${REPO}`
const ISSUES_URL = `${REPO_URL}/issues`
const LICENSE_URL = `${REPO_URL}/blob/master/LICENSE`
const QQ_GROUP = '913838378'
const CONTACT_EMAIL = 'duanmwsj@qq.com'

// 保留时长：以小时为单位，0 表示永久
function legacyRetentionHours(): string {
  const legacyDays = getSetting('retention_days')
  if (legacyDays) {
    const h = parseInt(legacyDays, 10) * 24
    if (Number.isFinite(h) && h >= 0) return String(h)
  }
  return '24'
}

function formatRetentionLabel(hoursStr: string): string {
  const hours = parseInt(hoursStr, 10)
  if (!Number.isFinite(hours) || hours <= 0) return '永久保留'
  if (hours < 24) return `${hours} 小时`
  const days = hours / 24
  return Number.isInteger(days) ? `${days} 天` : `${hours} 小时`
}
const UPDATE_CHECK_TIMEOUT = 10000
/** 一键更新用的计划任务名：启动时顺手清掉，避免残留 */
const UPDATE_TASK_NAME = 'ClipStackUpdate'

interface UpdateResult {
  time: number
  ok: boolean
  hasUpdate: boolean
  current: string
  latest: string | null
  message: string
  notes: string | null
  url: string | null
  publishedAt: string | null
  seen: boolean
  assetUrl: string | null
  assetName: string | null
  assetSize: number | null
  assetDigest: string | null
}

let lastUpdateCheck: UpdateResult | null = null

function getWindowPosition(): { x: number; y: number } {
  const display = screen.getPrimaryDisplay()
  const { width, height } = display.workArea
  return {
    x: width - MAIN_W - EDGE_MARGIN,
    y: height - MAIN_H - EDGE_MARGIN,
  }
}

const FLOAT_POS_FILE = 'float-pos.json'

function readFloatPos(): { x: number; y: number } | null {
  try {
    const raw = fs.readFileSync(join(app.getPath('userData'), FLOAT_POS_FILE), 'utf-8')
    const obj = JSON.parse(raw) as { x?: unknown; y?: unknown }
    const x = Number(obj.x)
    const y = Number(obj.y)
    if (Number.isFinite(x) && Number.isFinite(y) && x > 0 && y > 0) return { x, y }
  } catch {
    /* 没存过就算了 */
  }
  return null
}

function getFloatPosition(): { x: number; y: number } {
  const display = screen.getPrimaryDisplay()
  const { width, height } = display.workArea
  // 用户拖动过悬浮球就把位置记下来，下次开机/重开还在原处
  const saved = readFloatPos()
  if (saved) {
    const maxX = width - FLOAT_SIZE
    const maxY = height - FLOAT_SIZE
    return {
      x: Math.min(Math.max(saved.x, 0), maxX),
      y: Math.min(Math.max(saved.y, 0), maxY),
    }
  }
  return {
    x: width - FLOAT_SIZE - FLOAT_MARGIN,
    y: height - FLOAT_SIZE - FLOAT_MARGIN,
  }
}

/** 拖动悬浮球（按增量移动，拖动时窗口跟手） */
function dragFloatBy(dx: number, dy: number): void {
  if (!floatWindow || floatWindow.isDestroyed()) return
  const b = floatWindow.getBounds()
  const display = screen.getDisplayNearestPoint({ x: b.x, y: b.y })
  const wa = display.workArea
  // 只移动位置，不动尺寸：高 DPI 下 setBounds 改尺寸会把窗口越拖越大
  const nx = Math.min(Math.max(b.x + dx, wa.x), wa.x + wa.width - FLOAT_SIZE)
  const ny = Math.min(Math.max(b.y + dy, wa.y), wa.y + wa.height - FLOAT_SIZE)
  // 尺寸一律显式钉成 FLOAT_SIZE：高 DPI 下 getBounds 的取值范围和 setBounds 的单位不一致，
  // 若把读到的尺寸回填进去，窗口会越拖越大
  floatWindow.setBounds({ x: Math.round(nx), y: Math.round(ny), width: FLOAT_SIZE, height: FLOAT_SIZE }, false)
}

/** 松手后记住悬浮球位置（写独立小文件，不依赖数据库） */
function saveFloatPosition(): void {
  if (!floatWindow || floatWindow.isDestroyed()) return
  const b = floatWindow.getBounds()
  try {
    fs.writeFileSync(
      join(app.getPath('userData'), FLOAT_POS_FILE),
      JSON.stringify({ x: Math.round(b.x), y: Math.round(b.y) }),
      'utf-8',
    )
  } catch {
    /* 忽略 */
  }
}

// 拖动期间由主进程直接读鼠标屏幕坐标来移动窗口：
// screen.getCursorScreenPoint() 与 setBounds 用的是同一套 DIP 坐标，
// 比在渲染层用 screenX 增量算更准（不会出现"球比鼠标快半拍"）
let floatDragOrigin: { cx: number; cy: number; wx: number; wy: number } | null = null
let floatDragTimer: NodeJS.Timeout | null = null

function dragDbg(line: string): void {
  try {
    fs.appendFileSync(join('E:/浮贴', '_preview', 'drag.log'), `[${new Date().toISOString()}] ${line}\n`)
  } catch {
    /* 忽略 */
  }
}

function startFloatDrag(): void {
  if (!floatWindow || floatWindow.isDestroyed() || floatDragTimer) return
  const b = floatWindow.getBounds()
  const p = screen.getCursorScreenPoint()
  floatDragOrigin = { cx: p.x, cy: p.y, wx: b.x, wy: b.y }
  let ticks = 0
  floatDragTimer = setInterval(() => {
    if (!floatWindow || floatWindow.isDestroyed() || !floatDragOrigin) return
    // 安全阀：万一系统吞掉了 mouseup，最多跟 30 秒就自己停下
    if (++ticks > 1900) {
      endFloatDrag()
      return
    }
    const cur = screen.getCursorScreenPoint()
    const wa = screen.getDisplayNearestPoint(cur).workArea
    const nx = Math.min(Math.max(floatDragOrigin.wx + (cur.x - floatDragOrigin.cx), wa.x), wa.x + wa.width - FLOAT_SIZE)
    const ny = Math.min(Math.max(floatDragOrigin.wy + (cur.y - floatDragOrigin.cy), wa.y), wa.y + wa.height - FLOAT_SIZE)
    floatWindow.setBounds({ x: Math.round(nx), y: Math.round(ny), width: FLOAT_SIZE, height: FLOAT_SIZE }, false)
  }, 16)
}

/** 松手：位移够大就精确落位并记住位置；几乎没动就当作单击，球放回原处并展开 */
function endFloatDrag(): void {
  if (floatDragTimer) {
    clearInterval(floatDragTimer)
    floatDragTimer = null
  }
  const origin = floatDragOrigin
  floatDragOrigin = null
  if (!floatWindow || floatWindow.isDestroyed()) return
  const cur = screen.getCursorScreenPoint()
  if (!origin) {
    saveFloatPosition()
    return
  }
  const dist = Math.hypot(cur.x - origin.cx, cur.y - origin.cy)
  if (dist < 6) {
    // 单击：复位到按下时的位置再展开
    floatWindow.setBounds({ x: origin.wx, y: origin.wy, width: FLOAT_SIZE, height: FLOAT_SIZE }, false)
    expandFromFloat()
    return
  }
  const wa = screen.getDisplayNearestPoint(cur).workArea
  const nx = Math.min(Math.max(origin.wx + (cur.x - origin.cx), wa.x), wa.x + wa.width - FLOAT_SIZE)
  const ny = Math.min(Math.max(origin.wy + (cur.y - origin.cy), wa.y), wa.y + wa.height - FLOAT_SIZE)
  floatWindow.setBounds({ x: Math.round(nx), y: Math.round(ny), width: FLOAT_SIZE, height: FLOAT_SIZE }, false)
  saveFloatPosition()
}

/** 按下但没挪动 → 当作点击：把球放回原处并展开面板 */
function cancelFloatDrag(): void {
  if (floatDragTimer) {
    clearInterval(floatDragTimer)
    floatDragTimer = null
  }
  if (floatWindow && !floatWindow.isDestroyed() && floatDragOrigin) {
    const { wx, wy } = floatDragOrigin
    floatWindow.setBounds({ x: wx, y: wy, width: FLOAT_SIZE, height: FLOAT_SIZE }, false)
  }
  floatDragOrigin = null
  expandFromFloat()
}

function createWindow(): void {
  const { x, y } = getWindowPosition()

  mainWindow = new BrowserWindow({
    width: MAIN_W,
    height: MAIN_H,
    x,
    y,
    frame: false,
    icon: appIconPath(),
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    roundedCorners: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  setMainWindow(mainWindow)

  mainWindow.on('blur', () => {
    if (isQuitting) return
    // 以前这里会在失焦时自动隐藏，但透明无边框窗口隐藏后偶尔会在屏幕上留下残影：
    // 面板看着还在，鼠标点上去却落到桌面，表现为“点什么都没反应”。
    // 现在不自动隐藏，只在用户主动收起（悬浮球按钮/快捷键/托盘）时才隐藏。
  })

  mainWindow.on('closed', () => {
    setMainWindow(null)
    mainWindow = null
  })

  // 页面卡住/渲染进程崩溃时自动重载，避免面板变成“点不动的空壳”
  mainWindow.on('unresponsive', () => {
    if (isQuitting) return
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload()
  })
  mainWindow.webContents.on('render-process-gone', () => {
    if (isQuitting) return
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload()
  })
  // 每次显示都重新压到最上层，防止系统唤醒/切换后窗口被别的窗口盖住导致点击落空
  mainWindow.on('show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(true, 'floating')
      mainWindow.setIgnoreMouseEvents(false)
    }
  })

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function createFloatWindow(): void {
  const { x, y } = getFloatPosition()

  floatWindow = new BrowserWindow({
    width: FLOAT_SIZE,
    height: FLOAT_SIZE,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  floatWindow.on('closed', () => {
    floatWindow = null
  })

  // 启动后要能看到悬浮球（主面板不自动弹出）
  floatWindow.once('ready-to-show', () => {
    showFloat()
  })

  if (process.env.NODE_ENV === 'development') {
    floatWindow.loadURL('http://localhost:5173/float.html')
  } else {
    floatWindow.loadFile(join(__dirname, '../renderer/float.html'))
  }
}

function createSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show()
    settingsWindow.focus()
    return
  }

  settingsWindow = new BrowserWindow({
    width: 780,
    height: 600,
    icon: appIconPath(),
    minWidth: 780,
    minHeight: 600,
    frame: false,
    transparent: false,
    backgroundColor: '#12161F',
    resizable: false,
    maximizable: false,
    skipTaskbar: false,
    show: false,
    title: '设置 · 剪贴栈',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  settingsWindow.on('closed', () => {
    settingsWindow = null
  })

  settingsWindow.once('ready-to-show', () => {
    settingsWindow?.show()
    settingsWindow?.focus()
  })

  if (process.env.NODE_ENV === 'development') {
    settingsWindow.loadURL('http://localhost:5173/settings.html')
  } else {
    settingsWindow.loadFile(join(__dirname, '../renderer/settings.html'))
  }
}

/** 收起主面板，只留下右下角悬浮小球 */
function hideMainPanel(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  // 不能用 hide()：透明无边框窗口 hide() 后 Windows 会在屏幕上留残影，
  // 看着还在、其实点不到。也不能把窗口挪到超远负坐标：Chromium 的屏幕坐标缓存
  // 不会跟着更新，鼠标事件会错位（表现同样也是"按钮点不到"）。
  // 这里用透明度归零的方式收起：画面是真的没了，窗口位置不变，坐标始终正确。
  panelParked = true
  try {
    mainWindow.setIgnoreMouseEvents(true)
    mainWindow.setOpacity(0)
  } catch {
    if (!mainWindow.isDestroyed()) mainWindow.hide()
  }
}

/** 面板此刻是否真的在屏幕上（而不是被挪到屏幕外） */
function isPanelShown(): boolean {
  if (!mainWindow || mainWindow.isDestroyed()) return false
  if (panelParked) return false
  return mainWindow.isVisible()
}

function collapseToFloat(): void {
  if (isQuitting) return
  if (isPanelShown()) {
    hideMainPanel()
  }
  showFloat()
}

function showFloat(): void {
  if (!floatWindow || floatWindow.isDestroyed()) return
  const { x, y } = getFloatPosition()
  floatWindow.setPosition(x, y)
  if (!floatWindow.isVisible()) {
    floatWindow.showInactive()
  }
}

function hideFloat(): void {
  if (!floatWindow || floatWindow.isDestroyed()) return
  if (floatWindow.isVisible()) floatWindow.hide()
}

/** 由悬浮小球展开主面板 */
function expandFromFloat(): void {
  hideFloat()
  if (!mainWindow || mainWindow.isDestroyed()) return
  const { x, y } = getWindowPosition()
  panelParked = false
  // 位置、透明度、鼠标穿透都在 show 之前就设好，避免"刚打开那一下"状态没齐
  mainWindow.setPosition(x, y)
  mainWindow.setIgnoreMouseEvents(false)
  mainWindow.show()
  mainWindow.setOpacity(1)
  // Windows 会限制后台程序抢前台，导致面板刚弹出时第一下点击只用来"激活窗口"
  // （表现就是"刚打开那一瞬间点不动"）。steal 强制把应用拉前台，show 后立即聚焦。
  app.focus({ steal: true })
  mainWindow.focus()
  mainWindow.webContents.focus()
  blurHideReady = false
  setTimeout(() => { blurHideReady = true }, 1500)
}

function toggleWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (isPanelShown()) {
    collapseToFloat()
  } else {
    expandFromFloat()
  }
}
function createTray(): void {
  tray = new Tray(createTrayIcon())
  const menu = Menu.buildFromTemplate([
    { label: '显示/隐藏', click: toggleWindow },
    { label: '设置', click: createSettingsWindow },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit() } },
  ])
  tray.setToolTip('剪贴栈 · 你的复制截图历史仓库')
  tray.setContextMenu(menu)
  tray.on('click', toggleWindow)
}

function appIconPath(): string {
  const paths = [
    join(__dirname, '../../resources/icon.png'),
    join(process.resourcesPath, 'icon.png'),
  ]
  for (const p of paths) if (fs.existsSync(p)) return p
  return paths[0]
}

function createTrayIcon(): Electron.NativeImage {
  // 优先用专门给小尺寸优化的 tray 图标，16px 下更清晰，避免发灰模糊
  const paths = [
    join(__dirname, '../../resources/tray.ico'),
    join(process.resourcesPath, 'tray.ico'),
    join(__dirname, '../../resources/tray.png'),
    join(process.resourcesPath, 'tray.png'),
    join(__dirname, '../../resources/icon.png'),
    join(process.resourcesPath, 'icon.png'),
  ]
  for (const p of paths) {
    try {
      const img = nativeImage.createFromPath(p)
      if (!img.isEmpty()) return img
    } catch { /* try next */ }
  }
  return nativeImage.createFromPath(join(process.resourcesPath, 'icon.png'))
}

function dataDirInfo(): Record<string, unknown> {
  const dataDir = getDataDir()
  const dbPath = join(dataDir, 'data.db')
  let dbSizeMB = 0
  try {
    if (fs.existsSync(dbPath)) dbSizeMB = Number((fs.statSync(dbPath).size / 1048576).toFixed(2))
  } catch { /* ignore */ }
  const imagesDir = getImagesDir() || join(dataDir, 'images')
  let imageFileCount = 0
  try {
    if (fs.existsSync(imagesDir)) imageFileCount = fs.readdirSync(imagesDir).length
  } catch { /* ignore */ }

  return {
    dataDir,
    defaultDir: defaultDataDir(),
    isCustom: isCustomDataDir(),
    sizeMB: dirSizeMB(dataDir),
    dbPath,
    dbSizeMB,
    imagesDir,
    imageFileCount,
    version: app.getVersion(),
    exePath: app.getPath('exe'),
    appPath: app.getAppPath(),
    autostart: app.getLoginItemSettings().openAtLogin,
    stats: getStats(),
    retentionHours: getSetting('retention_hours') || legacyRetentionHours(),
    autoCheckUpdate: getSetting('auto_check_update') !== '0',
    updateCheck: lastUpdateCheck,
    qqGroup: QQ_GROUP,
    email: CONTACT_EMAIL,
    repoUrl: REPO_URL,
    issuesUrl: ISSUES_URL,
  }
}

/** a 是否比 b 新 */
function isNewerVersion(a: string, b: string): boolean {
  const norm = (v: string) => v.replace(/^v/i, '').split(/[.\-+]/).filter((s) => /^\d+$/.test(s)).map(Number)
  const pa = norm(a)
  const pb = norm(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0
    const y = pb[i] || 0
    if (x > y) return true
    if (x < y) return false
  }
  return false
}

async function fetchLatestVersion(): Promise<{
  ok: boolean
  latest?: string
  message?: string
  notes?: string | null
  url?: string | null
  publishedAt?: string | null
  assetUrl?: string | null
  assetName?: string | null
  assetSize?: number | null
  assetDigest?: string | null
}> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), UPDATE_CHECK_TIMEOUT)
  const headers = { 'User-Agent': 'xiaoming-clipboard', Accept: 'application/vnd.github+json' }
  try {
    try {
      const rel = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
        headers,
        signal: ac.signal,
      })
      if (rel.ok) {
        const data = (await rel.json()) as {
          tag_name?: string
          body?: string
          html_url?: string
          published_at?: string
          assets?: Array<{ name?: string; size?: number; browser_download_url?: string; digest?: string }>
        }
        if (data.tag_name) {
          const zip = (data.assets || []).find((a) => (a.name || '').toLowerCase().endsWith('.zip'))
          return {
            ok: true,
            latest: String(data.tag_name).replace(/^v/i, ''),
            notes: data.body || null,
            url: data.html_url || null,
            publishedAt: data.published_at || null,
            assetUrl: zip?.browser_download_url || null,
            assetName: zip?.name || null,
            assetSize: zip?.size ?? null,
            assetDigest: zip?.digest || null,
          }
        }
      }
    } catch { /* 继续尝试 tags */ }

    const tags = await net.fetch(`https://api.github.com/repos/${REPO}/tags`, { headers, signal: ac.signal })
    if (tags.ok) {
      const data = (await tags.json()) as Array<{ name?: string }>
      if (Array.isArray(data) && data.length > 0 && data[0]?.name) {
        return {
          ok: true,
          latest: String(data[0].name).replace(/^v/i, ''),
          notes: null,
          url: `https://github.com/${REPO}/tags`,
          publishedAt: null,
          assetUrl: null,
          assetName: null,
          assetSize: null,
          assetDigest: null,
        }
      }
      return { ok: true, latest: null, message: '仓库暂无发布版本' }
    }
    return { ok: false, message: `更新服务器返回 ${tags.status}` }
  } catch (err) {
    return { ok: false, message: (err as Error).message || '无法连接更新服务器' }
  } finally {
    clearTimeout(timer)
  }
}

async function runUpdateCheck(): Promise<Omit<UpdateResult, 'time'>> {
  const current = app.getVersion()
  const remote = await fetchLatestVersion()

  let hasUpdate = false
  let message: string
  if (!remote.ok) {
    message = '检查失败：' + (remote.message || '无法连接更新服务器')
  } else if (remote.latest && isNewerVersion(remote.latest, current)) {
    hasUpdate = true
    message = `发现新版本 v${remote.latest}`
  } else {
    message = remote.latest ? `检查完成，已是最新版本（v${current}）` : '检查完成，暂无已发布的更新'
  }

  const seenVersion = getSetting('update_seen_version')
  const result: Omit<UpdateResult, 'time'> = {
    ok: remote.ok,
    hasUpdate,
    current,
    latest: remote.latest || null,
    message,
    notes: remote.notes ?? null,
    url: remote.url ?? null,
    publishedAt: remote.publishedAt ?? null,
    seen: !!remote.latest && seenVersion === remote.latest,
    assetUrl: remote.assetUrl ?? null,
    assetName: remote.assetName ?? null,
    assetSize: remote.assetSize ?? null,
    assetDigest: remote.assetDigest ?? null,
  }
  lastUpdateCheck = { time: Date.now(), ...result }

  // 有新版本就先弹窗：直接打开设置窗，把更新说明弹窗弹出来（不再在主面板塞卡片）
  if (hasUpdate && !result.seen) {
    if (!settingsWindow || settingsWindow.isDestroyed()) {
      createSettingsWindow()
    } else {
      settingsWindow.show()
      settingsWindow.focus()
    }
    const push = () => {
      if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.webContents.send('update:available', lastUpdateCheck)
      }
    }
    if (settingsWindow && settingsWindow.webContents.isLoading()) {
      settingsWindow.webContents.once('did-finish-load', () => setTimeout(push, 300))
    } else {
      setTimeout(push, 600)
    }
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:available', lastUpdateCheck)
  }
  return result
}

type UpdateProgress = {
  phase: 'download' | 'extract' | 'apply'
  received?: number
  total?: number
  percent?: number
  message?: string
}

function sendUpdateProgress(payload: UpdateProgress): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:progress', payload)
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

async function sha256OfFile(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk as Buffer)
  return hash.digest('hex').toLowerCase()
}

/**
 * 便携版一键更新：下载 → 解压 → 等本进程退出后覆盖安装目录 → 自动重启
 * 之所以要外部脚本，是因为 Windows 无法覆盖正在运行的 exe
 */
async function installUpdate(): Promise<{ ok: boolean; message: string }> {
  const info = lastUpdateCheck
  if (!info || !info.hasUpdate) return { ok: false, message: '当前没有可安装的新版本' }
  if (!info.assetUrl) return { ok: false, message: '这个版本没附带 zip 包，只能去 Release 页手动下载' }

  const stamp = Date.now()
  const zipPath = join(app.getPath('temp'), `ClipStack-${info.latest}-x64-${stamp}.zip`)
  const workDir = join(app.getPath('temp'), `clipstack-update-${info.latest}-${stamp}`)
  let payloadDir = join(workDir, 'payload')

  try {
    // 旧目录可能被占用（杀毒、残留句柄）删不掉，直接换一个全新目录，不让它挡住更新
    await fs.promises.rm(workDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }).catch(() => undefined)
    await fs.promises.mkdir(workDir, { recursive: true })

    sendUpdateProgress({ phase: 'download', received: 0, total: info.assetSize || 0, percent: 0 })
    // GitHub 直连在国内又慢又容易断，先走加速镜像，镜像都不行再回退直连
    const mirrors = ['https://gh-proxy.com/', 'https://ghproxy.net/']
    const sources: Array<{ url: string; label: string }> = [
      ...mirrors.map((m) => ({ url: m + info.assetUrl, label: '加速通道' })),
      { url: info.assetUrl, label: 'GitHub 直连' },
    ]
    const tarExe = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
    if (!fs.existsSync(tarExe)) throw new Error('系统里找不到 tar.exe，无法解压更新包')
    const exeName = basename(app.getPath('exe'))
    const expectedSha = String(info.assetDigest || '').replace(/^sha256:/i, '').toLowerCase()
    let lastErr: Error | null = null
    let usedSource = ''
    // 下载 + 校验 + 解压绑在同一个源里：某个源传坏包就换下一个源，不再直接判失败
    for (const source of sources) {
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          let received = 0
          usedSource = source.label
          const res = await net.fetch(source.url, { headers: { 'User-Agent': 'xiaoming-clipboard' } })
          if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
          const total = Number(res.headers.get('content-length') || info.assetSize || 0)
          const ws = fs.createWriteStream(zipPath)
          const reader = (res.body as any).getReader()
          let writeErr: Error | null = null
          ws.on('error', (e: Error) => { writeErr = e })
          try {
            for (;;) {
              const { done, value } = await reader.read()
              if (done) break
              if (!value || value.length === 0) continue
              received += value.length
              const percent = total ? Math.min(98, Math.round((received / total) * 100)) : 0
              sendUpdateProgress({ phase: 'download', received, total, percent, message: source.label })
              if (!ws.write(value)) await new Promise<void>((r) => ws.once('drain', () => r()))
              if (writeErr) throw writeErr
            }
          } finally {
            await new Promise<void>((r) => ws.end(() => r()))
            reader.releaseLock?.()
          }
          if (writeErr) throw writeErr
          if (received === 0) throw new Error('下载到的文件是空的')
          if (info.assetSize && received < info.assetSize * 0.99) throw new Error('下载不完整')
          // GitHub 会给出资产的 sha256，下完先校验，防止镜像传了坏包
          if (expectedSha) {
            const actual = await sha256OfFile(zipPath)
            if (actual !== expectedSha) throw new Error('文件校验没通过，拿到的包是坏的')
          }

          sendUpdateProgress({ phase: 'extract', percent: 99, message: usedSource })
          // 每轮换一个全新解压目录，避免上一次残留（被占用删不掉）把这一轮也带崩
          payloadDir = join(workDir, `payload-${attempt}-${Date.now()}`)
          await fs.promises.mkdir(payloadDir, { recursive: true })
          await new Promise<void>((resolveP, rejectP) => {
            const proc = spawn(tarExe, ['-xf', zipPath, '-C', payloadDir], { windowsHide: true })
            let errText = ''
            proc.stderr?.on('data', (chunk: Buffer) => { errText += chunk.toString() })
            proc.on('error', rejectP)
            proc.on('close', (code) =>
              code === 0 ? resolveP() : rejectP(new Error(`解压失败（退出码 ${code}）${errText ? '：' + errText.trim() : ''}`))
            )
          })
          if (!fs.existsSync(join(payloadDir, exeName))) throw new Error(`解压后没找到 ${exeName}`)
          lastErr = null
          break
        } catch (e) {
          lastErr = e as Error
          await fs.promises.rm(zipPath, { force: true }).catch(() => undefined)
          await new Promise((r) => setTimeout(r, 1200 * attempt))
        }
      }
      if (!lastErr) break
    }
    if (lastErr) {
      throw new Error(
        `更新包准备失败（直连和加速通道都试过了）：${lastErr.message}。可以在设置里点「查看更新说明」手动下载。`
      )
    }

    const appDir = dirname(app.getPath('exe'))
    const ps1Path = join(workDir, 'apply-update.ps1')
    const script = [
      `$appDir = ${psQuote(appDir)}`,
      `$src = ${psQuote(payloadDir)}`,
      `$exe = ${psQuote(exeName)}`,
      `$oldPid = ${process.pid}`,
      `while (Get-Process -Id $oldPid -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 400 }`,
      `Start-Sleep -Seconds 1`,
      `$rc = Join-Path $env:SystemRoot 'System32\\robocopy.exe'`,
      `& $rc $src $appDir /MIR /NFL /NDL /NJH /NJS | Out-Null`,
      `Start-Process -FilePath (Join-Path $appDir $exe) -WorkingDirectory $appDir`,
      `Start-Sleep -Seconds 2`,
      `Remove-Item -LiteralPath $src -Recurse -Force -ErrorAction SilentlyContinue`,
      `Remove-Item -LiteralPath ${psQuote(zipPath)} -Force -ErrorAction SilentlyContinue`,
      `Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue`,
    ].join('\r\n')
    await fs.promises.writeFile(ps1Path, '\ufeff' + script, 'utf-8')

    sendUpdateProgress({ phase: 'apply', percent: 100 })
    const psExe = join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe'
    )
    if (!fs.existsSync(psExe)) throw new Error('系统里找不到 powershell.exe')
    // 直接 spawn 一个子进程，主进程退出时会被一起清掉（所以之前脚本根本没跑起来）。
    // 交给计划任务服务执行，才能真正脱离本进程存活下去。
    const schtasks = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'schtasks.exe')
    if (!fs.existsSync(schtasks)) throw new Error('系统里找不到 schtasks.exe')
    const taskArgs = `"${psExe}" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${ps1Path}"`
    try {
      execFileSync(schtasks, ['/create', '/f', '/tn', UPDATE_TASK_NAME, '/tr', taskArgs, '/sc', 'once', '/sd', '2000-01-01', '/st', '00:00'], { windowsHide: true })
      execFileSync(schtasks, ['/run', '/tn', UPDATE_TASK_NAME], { windowsHide: true })
    } catch (err) {
      throw new Error('启动更新任务失败：' + ((err as Error).message || ''))
    }
    setTimeout(() => app.quit(), 1200)
    return { ok: true, message: '已下载完成，正在后台替换文件，几秒后会自动重启' }
  } catch (err) {
    try {
      await fs.promises.rm(zipPath, { force: true })
    } catch { /* ignore */ }
    try {
      await fs.promises.rm(workDir, { recursive: true, force: true })
    } catch { /* ignore */ }
    return { ok: false, message: (err as Error).message || '更新失败' }
  }
}

function buildDiagnosticsText(): string {
  const dataDir = getDataDir()
  const stats = getStats()
  const dbPath = getDbPath() || join(dataDir, 'data.db')
  let dbBytes = 0
  try {
    if (fs.existsSync(dbPath)) dbBytes = fs.statSync(dbPath).size
  } catch { /* ignore */ }
  const imagesDir = getImagesDir() || join(dataDir, 'images')
  let imageFiles = 0
  try {
    if (fs.existsSync(imagesDir)) imageFiles = fs.readdirSync(imagesDir).length
  } catch { /* ignore */ }

  const fmt = (t: number | null) => (t ? new Date(t).toLocaleString('zh-CN') : '无')

  const lines = [
    '===== 小明剪贴板 诊断信息 =====',
    `生成时间      : ${new Date().toLocaleString('zh-CN')}`,
    `程序版本      : ${app.getVersion()}`,
    `运行方式      : ${app.isPackaged ? '已安装（打包运行）' : '开发模式'}`,
    `安装路径      : ${app.getPath('exe')}`,
    `平台          : Windows ${process.arch} / Electron ${process.versions.electron} / Chromium ${process.versions.chrome} / Node ${process.versions.node}`,
    '',
    '----- 数据 -----',
    `数据目录      : ${dataDir}`,
    `是否自定义    : ${isCustomDataDir() ? '是' : '否（默认目录）'}`,
    `默认目录      : ${defaultDataDir()}`,
    `目录占用      : ${dirSizeMB(dataDir)} MB`,
    `数据库文件    : ${dbPath}`,
    `数据库大小    : ${(dbBytes / 1024).toFixed(1)} KB`,
    `图片目录      : ${imagesDir}`,
    `图片文件数    : ${imageFiles}`,
    `记录总数      : ${stats.total}（文本 ${stats.textCount} / 图片 ${stats.imageCount} / 置顶 ${stats.pinnedCount}）`,
    `最早记录      : ${fmt(stats.oldest)}`,
    `最新记录      : ${fmt(stats.newest)}`,
    '',
    '----- 设置 -----',
    `保留时长      : ${formatRetentionLabel(getSetting('retention_hours') || legacyRetentionHours())}`,
    `开机自启      : ${app.getLoginItemSettings().openAtLogin ? '开' : '关'}`,
    `自动检查更新  : ${getSetting('auto_check_update') !== '0' ? '开' : '关'}`,
    `呼出快捷键    : Ctrl+Shift+V`,
    `主面板可见    : ${isPanelShown() ? '是' : '否'}`,
    `悬浮球可见    : ${floatWindow && !floatWindow.isDestroyed() && floatWindow.isVisible() ? '是' : '否'}`,
    `设置窗打开    : ${settingsWindow && !settingsWindow.isDestroyed() ? '是' : '否'}`,
    '',
    `代码仓库      : ${REPO_URL}`,
    '提示：本文件只包含程序运行状态，不含任何复制内容。',
  ]
  return lines.join('\r\n')
}

async function exportDiagnostics(): Promise<{ ok: boolean; canceled?: boolean; path?: string; message?: string }> {
  const win = settingsWindow && !settingsWindow.isDestroyed() ? settingsWindow : null
  const stamp = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const name = `小明剪贴板-诊断-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}.txt`
  const options: Electron.SaveDialogOptions = {
    title: '导出诊断信息',
    defaultPath: join(app.getPath('documents'), name),
    filters: [{ name: '文本文件', extensions: ['txt'] }],
  }
  const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return { ok: false, canceled: true }
  try {
    fs.writeFileSync(result.filePath, buildDiagnosticsText(), 'utf8')
    return { ok: true, path: result.filePath }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
}

function notifyDataChanged(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('data:changed')
  }
}

/** 切换数据目录：复制现有记录与图片，然后在新目录重新初始化 */
async function applyDataDir(target: string): Promise<{ ok: boolean; message?: string }> {
  const oldDir = getDataDir()
  const trimmed = (target || '').trim()
  if (!trimmed) return { ok: false, message: '目录不能为空' }
  // 必须是完整的绝对路径（带盘符和分隔符），否则会生成“E:浮贴剪贴历史”这种怪异目录
  if (!isAbsolute(trimmed) || !/[\\/]/.test(trimmed)) {
    return { ok: false, message: '请选择完整路径，例如 D:\\剪贴历史' }
  }

  const check = ensureDirWritable(trimmed)
  if (!check.ok) return { ok: false, message: '目录不可写：' + (check.message || '') }

  if (resolve(trimmed).toLowerCase() === resolve(oldDir).toLowerCase()) {
    saveDataDir(trimmed)
    return { ok: true }
  }

  const oldDb = join(oldDir, 'data.db')
  const newDb = join(trimmed, 'data.db')
  const oldImg = join(oldDir, 'images')
  const newImg = join(trimmed, 'images')

  stopMonitoring()
  stopCleanupScheduler()
  closeDatabase()

  try {
    if (fs.existsSync(newDb)) {
      fs.copyFileSync(newDb, `${newDb}.bak-${Date.now()}`)
    }
    if (fs.existsSync(oldDb)) {
      fs.copyFileSync(oldDb, newDb)
    }
    copyDirContents(oldImg, newImg)

    if (resolve(trimmed).toLowerCase() === resolve(defaultDataDir()).toLowerCase()) {
      resetDataDir()
    } else {
      saveDataDir(trimmed)
    }
    await initDatabase(trimmed)
    remapImagePaths(oldImg, newImg)
  } catch (err) {
    // 失败则回滚到原目录，避免数据不可用
    try {
      saveDataDir(oldDir)
      await initDatabase(oldDir)
    } catch { /* ignore */ }
    startMonitoring()
    startCleanupScheduler()
    return { ok: false, message: (err as Error).message }
  }

  startMonitoring()
  startCleanupScheduler()
  notifyDataChanged()
  // 切换目录后强制刷新渲染层：旧渲染进程在换库后会残留失效的事件绑定，导致点按钮没反应
  for (const win of [mainWindow, settingsWindow]) {
    if (win && !win.isDestroyed()) win.webContents.reload()
  }
  return { ok: true }
}

async function resetToDefaultDir(): Promise<{ ok: boolean; message?: string }> {
  const def = resetDataDir()
  return applyDataDir(def)
}

function registerWindowHandlers(): void {
  ipcMain.on('window:collapse', () => collapseToFloat())
  ipcMain.on('float:ignore', (_e, ignore: boolean) => {
    if (!floatWindow || floatWindow.isDestroyed()) return
    floatWindow.setIgnoreMouseEvents(!!ignore, { forward: true })
  })
  ipcMain.on('float:drag', (_e, dx: number, dy: number) => {
    dragFloatBy(dx, dy)
  })
  ipcMain.on('float:drag-start', () => {
    startFloatDrag()
  })
  ipcMain.on('float:drag-end', () => {
    endFloatDrag()
  })
  ipcMain.on('float:drag-cancel', () => {
    cancelFloatDrag()
  })
  ipcMain.on('float:save-pos', () => {
    saveFloatPosition()
  })
  ipcMain.on('window:expand', () => expandFromFloat())
  ipcMain.on('window:settings', () => createSettingsWindow())
  ipcMain.on('window:menu', () => {
    if (!floatWindow || floatWindow.isDestroyed()) return
    const menu = Menu.buildFromTemplate([
      { label: '展开剪贴栈', click: expandFromFloat },
      { label: '设置', click: createSettingsWindow },
      { label: '隐藏悬浮球', click: hideFloat },
      { type: 'separator' },
      { label: '退出', click: () => { isQuitting = true; app.quit() } },
    ])
    menu.popup({ window: floatWindow })
  })
  ipcMain.on('app:quit', () => { isQuitting = true; app.quit() })

  ipcMain.on('settings:minimize', () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.minimize()
  })
  ipcMain.on('settings:close', () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close()
  })

  ipcMain.handle('settings:info', () => dataDirInfo())

  ipcMain.handle('settings:choose-dir', async () => {
    const win = settingsWindow && !settingsWindow.isDestroyed() ? settingsWindow : null
    const options: Electron.OpenDialogOptions = {
      title: '选择复制记录存放目录',
      defaultPath: getDataDir(),
      properties: ['openDirectory', 'createDirectory'],
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('settings:apply-dir', (_e, dir: string) => applyDataDir(dir))

  ipcMain.handle('settings:reset-dir', () => resetToDefaultDir())

  ipcMain.handle('settings:open-dir', async (_e, dir?: string) => {
    const target = dir || getDataDir()
    const err = await shell.openPath(target)
    return err
  })

  ipcMain.handle('settings:set-autostart', (_e, enabled: boolean) => {
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled) })
    return app.getLoginItemSettings().openAtLogin
  })

  // 打开外部链接（仓库、Issues 等）
  ipcMain.handle('settings:open-external', async (_e, url: string) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false
    try {
      await shell.openExternal(url)
      return true
    } catch {
      return false
    }
  })

  // 复制一段文字到剪贴板（例如 QQ 群号）
  ipcMain.handle('settings:copy-text', (_e, text: string) => {
    if (typeof text !== 'string') return false
    clipboard.writeText(text)
    return true
  })

  ipcMain.handle('settings:export-diagnostics', () => exportDiagnostics())

  ipcMain.handle('settings:diagnostics-text', () => buildDiagnosticsText())

  ipcMain.handle('settings:check-update', async () => {
    const result = await runUpdateCheck()
    return { ...result, time: lastUpdateCheck?.time ?? Date.now() }
  })

  ipcMain.handle('settings:update-status', () => lastUpdateCheck)

  ipcMain.handle('update:dismiss', (_e, version: string) => {
    if (version) setSetting('update_seen_version', String(version))
    if (lastUpdateCheck && lastUpdateCheck.latest === version) lastUpdateCheck.seen = true
    return true
  })

  // 一键静默更新：下载 zip → 解压 → 退出后覆盖安装目录 → 自动重启
  ipcMain.handle('update:install', async () => installUpdate())

  ipcMain.handle('settings:set-auto-update', (_e, enabled: boolean) => {
    // 与渲染进程的 settings:set 写同一张 settings 表
    setSetting('auto_check_update', enabled ? '1' : '0')
    return enabled
  })
}

app.setAppUserModelId('com.floatpaste.app')

// 单实例锁：避免重复启动时注册出第二个托盘图标（Windows 会因此弹出托盘溢出面板）
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    expandFromFloat()
  })
}

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return
  protocol.handle('clipboard-image', (request) => {
    const filePath = request.url.slice('clipboard-image://'.length).replace(/\\/g, '/')
    return net.fetch('file:///' + filePath)
  })

  await initDatabase(getDataDir())
  // 上次一键更新用过的计划任务，启动后清掉
  try {
    const schtasks = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'schtasks.exe')
    execFileSync(schtasks, ['/delete', '/f', '/tn', UPDATE_TASK_NAME], { windowsHide: true })
  } catch { /* 没有残留任务就算了 */ }
  registerIpcHandlers()
  registerWindowHandlers()
  onNewItem(notifyNewItem)
  startMonitoring()
  startCleanupScheduler()

  app.setLoginItemSettings({ openAtLogin: true })

  createWindow()
  createFloatWindow()
  createTray()

  // 启动时只保留悬浮球，不再自动弹出主面板（避免开机/重开时"自己弹出来"）
  setTimeout(() => { blurHideReady = true }, 1500)

  globalShortcut.register('Ctrl+Shift+V', toggleWindow)

  // 系统睡眠/锁屏唤醒后：窗口容易失去置顶并被"冻住"，这里把它重新拉回可交互状态
  const recoverAfterWake = () => {
    if (isQuitting) return
    if (isPanelShown()) {
      mainWindow.setAlwaysOnTop(true, 'floating')
      mainWindow.setIgnoreMouseEvents(false)
      mainWindow.webContents.reload()
    }
  }
  powerMonitor.on('resume', recoverAfterWake)
  powerMonitor.on('unlock-screen', recoverAfterWake)

  // 开机后若开启"自动检查更新"，延迟静默检查一次
  if (getSetting('auto_check_update') !== '0') {
    setTimeout(() => { runUpdateCheck().catch(() => { /* 静默失败 */ }) }, 8000)
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  isQuitting = true
  stopMonitoring()
  stopCleanupScheduler()
  closeDatabase()
  if (floatWindow && !floatWindow.isDestroyed()) floatWindow.destroy()
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.destroy()
})

app.on('activate', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setOpacity(1)
    mainWindow.show()
  }
})

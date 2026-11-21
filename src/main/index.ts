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
  nativeTheme,
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
import { startMonitoring, stopMonitoring, onNewItem, runOcrBackfill } from './clipboard-monitor'
import { runImageCompaction } from './image-compact'
import {
  captureForegroundWindow,
  pasteBackToWindow,
  warmUpForegroundHelper,
  readForeground,
  isOwnProcess,
} from './previous-window'
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
// 呼出面板之前的前台窗口句柄，复制后可以粘贴回去
let lastForegroundHwnd = ''

const MAIN_W = 320
const MAIN_H = 440
// 面板实际尺寸（用户拖过边缘就沿用上次的）
let panelW = MAIN_W
let panelH = MAIN_H
const PANEL_MIN_W = 300
const PANEL_MIN_H = 420
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

// 国内更新通道：Gitee 上的同名仓库，国内直连不用代理
const GITEE_REPO = 'mingweisj/cuntiewu'
const GITEE_REPO_URL = `https://gitee.com/${GITEE_REPO}`
const GITEE_RELEASES_API = `https://gitee.com/api/v5/repos/${GITEE_REPO}/releases`
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
    x: width - panelW - EDGE_MARGIN,
    y: height - panelH - EDGE_MARGIN,
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

  // 上次调整过的面板尺寸
  const saved = getSetting('panel_size')
  const m = saved ? /^(\d{3,4})\s*[x×*]\s*(\d{3,4})$/.exec(saved) : null
  if (m) {
    panelW = Math.max(PANEL_MIN_W, parseInt(m[1], 10))
    panelH = Math.max(PANEL_MIN_H, parseInt(m[2], 10))
    const area = screen.getPrimaryDisplay().workArea
    panelW = Math.min(panelW, area.width - 40)
    panelH = Math.min(panelH, area.height - 40)
  }

  mainWindow = new BrowserWindow({
    width: panelW,
    height: panelH,
    x,
    y,
    frame: false,
    icon: appIconPath(),
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    roundedCorners: false,
    resizable: true,
    minWidth: PANEL_MIN_W,
    minHeight: PANEL_MIN_H,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // 拖边缘改过大小就记下来（防抖，别每移动一像素写一次库）
  let sizeTimer: ReturnType<typeof setTimeout> | null = null
  // 只在「用户自己拖边缘」时才写库。无边框透明窗建成后实际尺寸比设定值大几像素，
  // 启动时按实际尺寸回写会一轮轮变大（334 → 340 → 348 …），宽度就守不住了。
  let userResizing = false
  mainWindow.on('will-resize', () => {
    userResizing = true
  })
  mainWindow.on('resize', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (!userResizing) return
    if (sizeTimer) clearTimeout(sizeTimer)
    sizeTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      userResizing = false
      const [w, h] = mainWindow.getSize()
      panelW = w
      panelH = h
      setSetting('panel_size', `${w}x${h}`)
    }, 400)
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

  // 开机自启：只露一颗悬浮球；手动双击启动：直接给面板，球先收着（面板一收起球自己会回来）
  floatWindow.once('ready-to-show', () => {
    if (isAutostart) showFloat()
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

  // 设置窗的宽高按用户画的红线来：默认 1150×760，拖过之后记住，下次还是这个尺寸
  const savedSettingsSize = getSetting('settings_size')
  let settingsW = 1150
  let settingsH = 760
  const sm = savedSettingsSize ? /^(\d{3,4})\s*[x×*]\s*(\d{3,4})$/.exec(savedSettingsSize) : null
  if (sm) {
    const area = screen.getPrimaryDisplay().workAreaSize
    settingsW = Math.min(Math.max(980, parseInt(sm[1], 10)), area.width - 24)
    settingsH = Math.min(Math.max(640, parseInt(sm[2], 10)), area.height - 24)
  }

  settingsWindow = new BrowserWindow({
    width: settingsW,
    height: settingsH,
    icon: appIconPath(),
    minWidth: 980,
    minHeight: 640,
    frame: false,
    transparent: false,
    backgroundColor: '#12161F',
    resizable: true,
    maximizable: false,
    skipTaskbar: false,
    show: false,
    title: '设置 · 存贴屋',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  settingsWindow.on('closed', () => {
    settingsWindow = null
  })

  // 拖动边缘改过大小就记下来（同样只在用户拖的时候写，别被启动时的自动尺寸污染）
  let settingsSizeTimer: ReturnType<typeof setTimeout> | null = null
  let settingsUserResizing = false
  settingsWindow.on('will-resize', () => {
    settingsUserResizing = true
  })
  settingsWindow.on('resize', () => {
    if (!settingsUserResizing) return
    if (settingsSizeTimer) clearTimeout(settingsSizeTimer)
    settingsSizeTimer = setTimeout(() => {
      if (!settingsWindow || settingsWindow.isDestroyed()) return
      settingsUserResizing = false
      const [w, h] = settingsWindow.getSize()
      setSetting('settings_size', `${w}x${h}`)
    }, 400)
  })

  settingsWindow.once('ready-to-show', () => {
    settingsWindow?.show()
    settingsWindow?.focus()
  })

  // 兜底：个别情况下 ready-to-show 不触发（主面板是隐藏状态、渲染进程复用缓存等），
  // 窗口会一直挂在屏幕外不可见。所以页面加载完成时、以及加载后 1.5 秒各再 show 一次。
  settingsWindow.webContents.once('did-finish-load', () => {
    settingsWindow?.show()
    settingsWindow?.focus()
  })
  for (const delay of [800, 1500]) {
    setTimeout(() => {
      if (!settingsWindow || settingsWindow.isDestroyed()) return
      if (!settingsWindow.isVisible()) {
        settingsWindow.show()
        settingsWindow.focus()
      }
    }, delay)
  }

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
  // 主面板或设置窗正开着的时候别再冒出悬浮球
  if (isPanelShown()) return
  if (settingsWindow && !settingsWindow.isDestroyed() && settingsWindow.isVisible()) return
  const { x, y } = getFloatPosition()
  floatWindow.setPosition(x, y)
  if (!floatWindow.isVisible()) {
    floatWindow.showInactive()
  }
}

function hideFloat(): void {
  if (!floatWindow || floatWindow.isDestroyed()) return
  // 别用 isVisible() 判断：无边框 + focusable:false 的透明窗，isVisible() 有时会报 false，
  // 结果 hide() 根本不执行，悬浮球就一直挂在屏幕上。hide() 本身是幂等的，直接调。
  floatWindow.hide()
}

/** 由悬浮小球展开主面板 */
function expandFromFloat(): void {
  hideFloat()
  if (!mainWindow || mainWindow.isDestroyed()) return
  const { x, y } = getWindowPosition()
  let shown = false
  const showPanel = () => {
    if (shown) return
    shown = true
    if (!mainWindow || mainWindow.isDestroyed()) return
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
  // 抢焦点之前先记下用户刚才所在的窗口。
  // 助手是常驻进程（10ms 级响应），但万一没准备好也绝不等：直接弹面板，
  // 用后台轮询（startForegroundWatcher）已经记下的那个句柄兜底。
  captureForegroundWindow(260)
    .then((h) => { if (h) lastForegroundHwnd = h })
    .catch(() => { /* 拿不到就算了 */ })
    .finally(showPanel)
  setTimeout(showPanel, 220)
}

function toggleWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (isPanelShown()) {
    collapseToFloat()
  } else {
    expandFromFloat()
  }
}

/**
 * 后台记住"用户正在哪个窗口"：面板收起时每 700ms 问一次常驻助手。
 * 这样呼出面板那一刻不需要抢时间——哪怕助手刚好没响应，也有上一轮记下的句柄兜底。
 */
function startForegroundWatcher(): void {
  let busy = false
  setInterval(() => {
    if (busy) return
    if (isPanelShown() || panelParked === false) return
    busy = true
    readForeground(300)
      .then((info) => {
        if (!info || !info.hwnd || info.hwnd === '0') return
        if (isOwnProcess(info.proc)) return
        lastForegroundHwnd = info.hwnd
      })
      .catch(() => { /* 忽略 */ })
      .finally(() => { busy = false })
  }, 700)
}
function createTray(): void {
  tray = new Tray(createTrayIcon())
  const menu = Menu.buildFromTemplate([
    { label: '显示/隐藏', click: toggleWindow },
    { label: '设置', click: createSettingsWindow },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit() } },
  ])
  tray.setToolTip('存贴屋 · 你的复制截图历史仓库')
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
    // 先问 Gitee：国内直连，包也放在那边，下载快
    try {
      const gRes = await net.fetch(`${GITEE_RELEASES_API}?per_page=5&direction=desc`, {
        headers: { 'User-Agent': 'xiaoming-clipboard' },
        signal: ac.signal,
      })
      if (gRes.ok) {
        const list = (await gRes.json()) as Array<{
          tag_name?: string
          body?: string
          html_url?: string
          created_at?: string
          prerelease?: boolean
          assets?: Array<{ name?: string; browser_download_url?: string }>
        }>
        const rel = (Array.isArray(list) ? list : []).find((r) => r?.tag_name && !r.prerelease)
        if (rel?.tag_name) {
          const assets = rel.assets || []
          // 优先 7z（瘦身包），其次 zip
          const pkg =
            assets.find((a) => /\.7z$/i.test(a.name || '')) ||
            assets.find((a) => /\.zip$/i.test(a.name || ''))
          return {
            ok: true,
            latest: String(rel.tag_name).replace(/^v/i, ''),
            notes: rel.body || null,
            url: rel.html_url || `${GITEE_REPO_URL}/releases`,
            publishedAt: rel.created_at || null,
            assetUrl: pkg?.browser_download_url || null,
            assetName: pkg?.name || null,
            assetSize: null,
            assetDigest: null,
          }
        }
      }
    } catch { /* Gitee 不通再问 GitHub */ }

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

  // 有新版本只在主面板里提示，绝不在启动时自己弹设置窗
  // （以前这里会 createSettingsWindow，用户双击图标一打开先看见设置面板，像“打开一片黑”）
  if (hasUpdate && !result.seen) {
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
    // Gitee 的包国内直连就够快，不再绕加速镜像；GitHub 的包才走镜像
    const giteeAsset = /gitee\.com/i.test(String(info.assetUrl))
    const mirrors = ['https://gh-proxy.com/', 'https://ghproxy.net/']
    const sources: Array<{ url: string; label: string }> = giteeAsset
      ? [{ url: info.assetUrl, label: 'Gitee 国内直连' }]
      : [
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

// ============ 备份 / 恢复 ============
const PS_EXE = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')

async function exportBackup(): Promise<{ ok: boolean; canceled?: boolean; path?: string; message?: string }> {
  const win = settingsWindow && !settingsWindow.isDestroyed() ? settingsWindow : null
  const stamp = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const name = `存贴屋备份-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}.zip`
  const options: Electron.SaveDialogOptions = {
    title: '导出备份',
    defaultPath: join(app.getPath('documents'), name),
    filters: [{ name: 'Zip 压缩包', extensions: ['zip'] }],
  }
  const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return { ok: false, canceled: true }
  try {
    const src = join(getDataDir(), '*')
    execFileSync(PS_EXE, [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `Compress-Archive -Path ${psQuote(src)} -DestinationPath ${psQuote(result.filePath)} -Force`,
    ], { windowsHide: true, timeout: 120000 })
    return { ok: true, path: result.filePath }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
}

async function restoreBackup(): Promise<{ ok: boolean; canceled?: boolean; message?: string }> {
  const win = settingsWindow && !settingsWindow.isDestroyed() ? settingsWindow : null
  const options: Electron.OpenDialogOptions = {
    title: '从备份恢复',
    properties: ['openFile'],
    filters: [{ name: 'Zip 压缩包', extensions: ['zip'] }],
  }
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true }

  const zip = result.filePaths[0]
  const tmp = join(app.getPath('temp'), `clipstack-restore-${Date.now()}`)
  try {
    execFileSync(PS_EXE, [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `Expand-Archive -Path ${psQuote(zip)} -DestinationPath ${psQuote(tmp)} -Force`,
    ], { windowsHide: true, timeout: 120000 })

    let dbFile = join(tmp, 'data.db')
    if (!fs.existsSync(dbFile)) {
      // 兼容直接压缩了数据目录文件夹的情况
      const sub = fs.readdirSync(tmp, { withFileTypes: true }).find((d) => d.isDirectory())
      if (sub) dbFile = join(tmp, sub.name, 'data.db')
    }
    if (!fs.existsSync(dbFile)) return { ok: false, message: '这个压缩包里没有 data.db，不像是存贴屋的备份。' }

    const root = dirname(dbFile)
    const dataDir = getDataDir()
    // 先把现在的数据整体挪到一边，坏了还能找回来
    const keep = `${dataDir}-恢复前-${Date.now()}`
    try {
      fs.mkdirSync(keep, { recursive: true })
      const curDb = getDbPath()
      if (fs.existsSync(curDb)) fs.copyFileSync(curDb, join(keep, 'data.db'))
      const curImages = getImagesDir()
      if (fs.existsSync(curImages)) fs.cpSync(curImages, join(keep, 'images'), { recursive: true })
    } catch { /* 兜底拷贝失败不阻断恢复 */ }

    closeDatabase()
    if (fs.existsSync(dbFile)) fs.copyFileSync(dbFile, getDbPath())
    const newImages = join(root, 'images')
    if (fs.existsSync(newImages)) {
      fs.rmSync(getImagesDir(), { recursive: true, force: true })
      fs.mkdirSync(getImagesDir(), { recursive: true })
      for (const f of fs.readdirSync(newImages)) {
        fs.copyFileSync(join(newImages, f), join(getImagesDir(), f))
      }
    }
    fs.rmSync(tmp, { recursive: true, force: true })

    // 数据已经换好了，重启让新库生效
    setTimeout(() => {
      app.relaunch()
      app.exit(0)
    }, 600)
    return { ok: true }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
}

async function exportDiagnostics(): Promise<{ ok: boolean; canceled?: boolean; path?: string; message?: string }> {  const win = settingsWindow && !settingsWindow.isDestroyed() ? settingsWindow : null
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

  // 从卡片拖出去：用系统级拖拽把图片文件本身拖到别的窗口
  ipcMain.on('drag:start', (event, filePath: string) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win || !filePath || !fs.existsSync(filePath)) return
      win.webContents.startDrag({ file: filePath, icon: filePath })
    } catch { /* 拖拽失败不影响复制 */ }
  })
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

  // 复制完把内容粘回刚才那个窗口（设置里默认关闭）
  ipcMain.handle('clipboard:paste-back', async (_e, type?: string) => {
    if (type && type !== 'text') return false
    if (getSetting('paste_after_copy') !== '1') return false
    if (!lastForegroundHwnd) return false
    return pasteBackToWindow(lastForegroundHwnd)
  })
  ipcMain.on('window:settings', () => createSettingsWindow())
  ipcMain.on('window:menu', () => {
    if (!floatWindow || floatWindow.isDestroyed()) return
    const menu = Menu.buildFromTemplate([
      { label: '展开存贴屋', click: expandFromFloat },
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
  ipcMain.handle('backup:export', async () => exportBackup())
  ipcMain.handle('backup:restore', async () => restoreBackup())

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

// 开机自启时带这个参数：只留悬浮球，不自动弹主面板
const AUTOSTART_ARG = '--autostart'
const isAutostart = process.argv.includes(AUTOSTART_ARG)

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
  // 跟随系统主题：Windows 切换深浅色时自动通知三个窗口
  try {
    nativeTheme.on('updated', () => {
      if (getSetting('theme') !== 'auto') return
      const next = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('theme:changed', next)
      }
    })
  } catch { /* 忽略 */ }
  registerIpcHandlers()
  registerWindowHandlers()
  onNewItem(notifyNewItem)
  startMonitoring()
  startCleanupScheduler()
  // 前台窗口助手先热起来，之后查"刚才在哪个窗口"不用等 PowerShell 启动
  try { warmUpForegroundHelper() } catch { /* 忽略 */ }
  startForegroundWatcher()
  setInterval(() => { try { runOcrBackfill() } catch { /* 忽略 */ } }, 60000)
  // 历史大图慢慢压：每 90 秒处理 2 张，不抢前台体验
  setInterval(() => { try { runImageCompaction(2) } catch { /* 忽略 */ } }, 90000)

  app.setLoginItemSettings({ openAtLogin: true, args: [AUTOSTART_ARG] })

  createWindow()
  createFloatWindow()
  createTray()

  // 双击桌面图标 = 手动启动：直接把主面板弹出来。
  // 以前这里只留一颗悬浮球，用户看到的像“打开了但一片黑/什么都没出来”；
  // 开机自启（带 --autostart）才安静地只留悬浮球，不打扰。
  if (!isAutostart) {
    const openPanelOnStart = () => {
      if (!isPanelShown()) expandFromFloat()
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.once('did-finish-load', () => setTimeout(openPanelOnStart, 150))
    }
    setTimeout(openPanelOnStart, 1200)
    // 悬浮球的 ready-to-show 可能比面板晚到，这里多扫几次，面板开着就把球收起来
    for (const d of [1500, 2500, 4000, 6000]) {
      setTimeout(() => {
        if (isPanelShown()) hideFloat()
      }, d)
    }
  }

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

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
import { isAbsolute, join, resolve } from 'path'
import fs from 'fs'
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

interface UpdateResult {
  time: number
  ok: boolean
  hasUpdate: boolean
  current: string
  latest: string | null
  message: string
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

function getFloatPosition(): { x: number; y: number } {
  const display = screen.getPrimaryDisplay()
  const { width, height } = display.workArea
  return {
    x: width - FLOAT_SIZE - FLOAT_MARGIN,
    y: height - FLOAT_SIZE - FLOAT_MARGIN,
  }
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
  // 透明无边框窗口直接 hide() 后，Windows 合成层有时会在屏幕上留下残影：
  // 面板看着还在，但鼠标点上去其实落在桌面（表现为“点什么都没反应”）。
  // 先把透明度压到 0 再隐藏，强制 DWM 重新合成，然后恢复透明度供下次显示使用。
  try {
    mainWindow.setOpacity(0)
    mainWindow.hide()
    mainWindow.setOpacity(1)
  } catch {
    if (!mainWindow.isDestroyed()) mainWindow.hide()
  }
}

function collapseToFloat(): void {
  if (isQuitting) return
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
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
  mainWindow.setPosition(x, y)
  mainWindow.setOpacity(1)
  mainWindow.setIgnoreMouseEvents(false)
  mainWindow.show()
  mainWindow.focus()
  blurHideReady = false
  setTimeout(() => { blurHideReady = true }, 1500)
}

function toggleWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isVisible()) {
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

async function fetchLatestVersion(): Promise<{ ok: boolean; latest?: string; message?: string }> {
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
        const data = (await rel.json()) as { tag_name?: string }
        if (data.tag_name) return { ok: true, latest: String(data.tag_name).replace(/^v/i, '') }
      }
    } catch { /* 继续尝试 tags */ }

    const tags = await net.fetch(`https://api.github.com/repos/${REPO}/tags`, { headers, signal: ac.signal })
    if (tags.ok) {
      const data = (await tags.json()) as Array<{ name?: string }>
      if (Array.isArray(data) && data.length > 0 && data[0]?.name) {
        return { ok: true, latest: String(data[0].name).replace(/^v/i, '') }
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

  const result: Omit<UpdateResult, 'time'> = {
    ok: remote.ok,
    hasUpdate,
    current,
    latest: remote.latest || null,
    message,
  }
  lastUpdateCheck = { time: Date.now(), ...result }

  if (hasUpdate && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update:available', lastUpdateCheck)
  }
  return result
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
    `主面板可见    : ${mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() ? '是' : '否'}`,
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
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
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

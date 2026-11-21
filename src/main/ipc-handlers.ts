import { ipcMain, clipboard, BrowserWindow, nativeImage, nativeTheme } from 'electron'
import { getHistory, getItemById, pinItem, archiveItem, getArchived, getArchivedCount, restoreItem, deleteItem, emptyTrash, getSetting, setSetting, getTopSources, ClipboardItem } from './database'
import { markTextAsHandled, markImageAsHandled } from './clipboard-monitor'
import { existsSync, unlinkSync, readFileSync, appendFileSync } from 'fs'
import { createHash } from 'crypto'
import { join } from 'path'

// 把复制链路每一步写进日志，出问题时能直接看出是"点击没到"还是"执行失败"
const DIAG_LOG = join('E:\\浮贴', '_preview', 'copy.log')
function diag(line: string): void {
  try {
    appendFileSync(DIAG_LOG, `[${new Date().toISOString()}] ${line}\n`)
  } catch {
    /* 日志失败不影响功能 */
  }
}

let mainWindow: BrowserWindow | null = null

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindow = win
}

// 主窗口列表要跟着刷新（比如在设置页把记录从回收站恢复回来）
function notifyChanged(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('data:changed')
  }
}

export function registerIpcHandlers(): void {
  ipcMain.handle('history:get', (_event, search?: string, limit?: number, offset?: number, filter?: string) => {
    return getHistory(search, limit, offset, (filter || '') as any)
  })

  ipcMain.handle('history:sources', () => getTopSources(4))

  ipcMain.handle('diag:log', (_event, msg: string) => {
    diag('renderer: ' + msg)
  })

  ipcMain.handle('clipboard:copy', (_event, id: number) => {
    diag(`copy 收到请求 id=${id} type=${typeof id}`)
    const item = getItemById(id)
    if (!item) {
      diag(`copy 失败：找不到记录 id=${id}`)
      return false
    }

    if (item.type === 'text' && item.content) {
      markTextAsHandled(item.content)
      clipboard.writeText(item.content)
      diag(`copy 成功 文本 id=${id} len=${item.content.length}`)
    } else if (item.type === 'image' && item.image_path && existsSync(item.image_path)) {
      const img = nativeImage.createFromPath(item.image_path)
      markImageAsHandled(createHash('md5').update(img.toPNG()).digest('hex'))
      clipboard.writeImage(img)
      diag(`copy 成功 图片 id=${id}`)
    } else {
      diag(`copy 失败：${item.type} 文件不存在或为空 id=${id} path=${item.image_path}`)
      return false
    }
    return true
  })

  ipcMain.handle('history:pin', (_event, id: number, pinned: boolean) => {
    pinItem(id, pinned)
  })

  // 删除 = 进回收站（记录和图片文件都保留，能恢复）
  ipcMain.handle('history:delete', (_event, id: number) => {
    archiveItem(id)
  })

  ipcMain.handle('trash:list', (_event, search?: string) => getArchived(200, search))
  ipcMain.handle('trash:count', () => getArchivedCount())

  ipcMain.handle('trash:restore', (_event, id: number) => {
    restoreItem(id)
    notifyChanged()
  })

  // 彻底删除单条：这时才删图片文件
  ipcMain.handle('trash:purge', (_event, id: number) => {
    const item = deleteItem(id)
    if (item?.image_path && existsSync(item.image_path)) {
      try {
        unlinkSync(item.image_path)
      } catch {
        /* 文件占用，忽略 */
      }
    }
    notifyChanged()
  })

  ipcMain.handle('trash:empty', () => {
    const paths = emptyTrash()
    for (const p of paths) {
      try {
        if (existsSync(p)) unlinkSync(p)
      } catch {
        /* 忽略 */
      }
    }
    notifyChanged()
    return paths.length
  })

  ipcMain.handle('settings:get', (_event, key: string) => {
    return getSetting(key)
  })

  // 只有文字记录才自动粘贴回上一个窗口；图片一律只复制不抢焦点
  ipcMain.handle('theme:resolve', () => {
    const stored = getSetting('theme')
    if (stored === 'light' || stored === 'dark') return stored
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  })

  ipcMain.handle('image:read', (_event, imagePath: string) => {
    if (!existsSync(imagePath)) return null
    const buf = readFileSync(imagePath)
    const mime = /\.jpe?g$/i.test(imagePath) ? 'image/jpeg' : 'image/png'
    return `data:${mime};base64,` + buf.toString('base64')
  })

  ipcMain.handle('settings:set', (_event, key: string, value: string) => {
    setSetting(key, value)
    if (key === 'retention_hours') {
      const hours = parseInt(value, 10)
      // 重新计时：从改设置的这一刻开始算，满这么久之后才开始清（老记录也一样）
      if (Number.isFinite(hours) && hours > 0) {
        setSetting('retention_started_at', String(Date.now()))
      } else {
        setSetting('retention_started_at', '0')
      }
    }
    if (key === 'theme') {
      // 三个窗口（面板 / 悬浮球 / 设置）一起换肤
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('theme:changed', value)
      }
    }
  })
}

export function notifyNewItem(item: ClipboardItem): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('clipboard:new-item', item)
  }
}

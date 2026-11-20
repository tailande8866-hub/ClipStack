import { ipcMain, clipboard, BrowserWindow, nativeImage } from 'electron'
import { getHistory, getItemById, pinItem, deleteItem, getSetting, setSetting, cleanupExpired, ClipboardItem } from './database'
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

export function registerIpcHandlers(): void {
  ipcMain.handle('history:get', (_event, search?: string, limit?: number, offset?: number) => {
    return getHistory(search, limit, offset)
  })

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

  ipcMain.handle('history:delete', (_event, id: number) => {
    const item = deleteItem(id)
    if (item && item.image_path && existsSync(item.image_path)) {
      unlinkSync(item.image_path)
    }
  })

  ipcMain.handle('settings:get', (_event, key: string) => {
    return getSetting(key)
  })

  ipcMain.handle('image:read', (_event, imagePath: string) => {
    if (!existsSync(imagePath)) return null
    const buf = readFileSync(imagePath)
    return 'data:image/png;base64,' + buf.toString('base64')
  })

  ipcMain.handle('settings:set', (_event, key: string, value: string) => {
    setSetting(key, value)
    if (key === 'retention_hours') {
      const hours = parseInt(value, 10)
      if (Number.isFinite(hours) && hours > 0) {
        const paths = cleanupExpired(hours)
        for (const p of paths) {
          if (existsSync(p)) unlinkSync(p)
        }
      }
    }
  })
}

export function notifyNewItem(item: ClipboardItem): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('clipboard:new-item', item)
  }
}

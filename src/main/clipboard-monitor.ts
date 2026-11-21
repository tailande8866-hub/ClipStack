import { clipboard, nativeImage } from 'electron'
import { createHash } from 'crypto'
import { writeFileSync } from 'fs'
import { join } from 'path'
import {
  addText,
  addImage,
  getLatestTextItem,
  getItemByImageHash,
  getItemById,
  updateItemTime,
  setOcrText,
  getImagesWithoutOcr,
  getImagesDir,
  getSetting,
} from './database'
import { ocrImage } from './ocr'
import { getForegroundApp } from './source-app'

import type { ClipboardItem } from './database'

let lastTextHash: string | null = null
let lastImageHash: string | null = null
let intervalId: ReturnType<typeof setInterval> | null = null
let onNewItemCallback: ((item: ClipboardItem) => void) | null = null

export function onNewItem(cb: (item: ClipboardItem) => void): void {
  onNewItemCallback = cb
}

/** 从面板里复制一条历史时，把内容标记成"已处理"，避免又当成新剪贴内容记一遍 */
export function markTextAsHandled(text: string): void {
  lastTextHash = hashDjb2(text)
}

export function markImageAsHandled(md5: string): void {
  lastImageHash = md5
}

function hashDjb2(str: string): string {  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i)
    hash = hash & 0xffffffff
  }
  return hash.toString(16)
}

function processImage(): boolean {
  const img = clipboard.readImage()
  if (img.isEmpty()) return false

  let pngBuffer = img.toPNG()
  const md5 = createHash('md5').update(pngBuffer).digest('hex')

  if (md5 === lastImageHash) return true
  lastImageHash = md5

  const existing = getItemByImageHash(md5)
  if (existing) {
    updateItemTime(existing.id)
    // 重复复制：把这条的发布时间推到最新，界面按 id 原地刷新（显示 ×N）
    const refreshed = getItemById(existing.id)
    if (refreshed && onNewItemCallback) onNewItemCallback(refreshed)
    return true
  }

  const size = img.getSize()
  let out = img
  if (size.width > 1920) {
    const ratio = 1920 / size.width
    out = img.resize({ width: 1920, height: Math.round(size.height * ratio) })
  }

  // 大图别占硬盘：PNG 超过 1.4MB 就转 JPEG 存，肉眼几乎看不出差别
  let buf = out.toPNG()
  let ext = 'png'
  if (buf.length > 1_400_000) {
    buf = out.toJPEG(82)
    ext = 'jpg'
  }

  const filename = `${md5}.${ext}`
  const filepath = join(getImagesDir(), filename)
  writeFileSync(filepath, buf)

  getForegroundApp().then((src) => {
    const item = addImage(filepath, md5, src)
    ocrInBackground(item.id, filepath)
    if (onNewItemCallback) onNewItemCallback(item)
  }).catch(() => {
    const item = addImage(filepath, md5, null)
    ocrInBackground(item.id, filepath)
    if (onNewItemCallback) onNewItemCallback(item)
  })
  return true
}

// 截图落下后台就去识别文字，搜索就能按图里的内容命中
function ocrInBackground(id: number, path: string): void {
  ocrImage(path)
    .then((text) => {
      if (text) setOcrText(id, text)
    })
    .catch(() => { /* 识别失败就当没有，不影响主流程 */ })
}

/** 老图片补扫：每次取 2 张没识别过的，慢慢跑，不抢资源 */
export function runOcrBackfill(): void {
  const pending = getImagesWithoutOcr(2)
  for (const item of pending) {
    if (!item.image_path) continue
    ocrInBackground(item.id, item.image_path)
  }
}

/**
 * 密码类内容不进历史：密码管理器会主动标 Exclude，另外按形态兜底
 * （长 hex、sk-/ghp_ 之类密钥、16 位以上纯数字卡号、无空格的混合大小写数字长串）
 */
function isSensitiveText(text: string): boolean {
  // 设置里能关掉；还能自己加屏蔽词（每行一个，命中就不入库）
  const enabled = getSetting('sensitive_skip')
  if (enabled === '0') return false

  try {
    const formats = clipboard.availableFormats() || []
    if (formats.some((f) => /excludeclipboardcontent/i.test(f))) return true
  } catch { /* 拿不到格式就只走形态判断 */ }

  const extra = (getSetting('sensitive_extra') || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  if (extra.length && extra.some((k) => text.toLowerCase().includes(k.toLowerCase()))) return true

  const t = text.trim()
  if (t.length < 12 || t.length > 400) return false
  if (/\s/.test(t)) return false
  if (/^(https?:|www\.)/i.test(t)) return false
  if (/^[0-9a-f]{32,}$/i.test(t)) return true
  if (/^(sk-|ghp_|gho_|github_pat_|xox[baprs]-|AKIA)[A-Za-z0-9_-]{10,}/.test(t)) return true
  if (/^\d{16,24}$/.test(t)) return true
  // 大小写字母 + 数字混排、无路径符号的长 token，基本是密码或随机密钥
  if (
    /^[A-Za-z0-9!@#$%^&*_\-+=]{16,}$/.test(t) &&
    /[A-Za-z]/.test(t) &&
    /\d/.test(t) &&
    !/[./:\\]/.test(t)
  ) return true
  return false
}

function processText(): void {
  const text = clipboard.readText()
  if (!text) return

  const currentHash = hashDjb2(text)
  if (currentHash === lastTextHash) return
  lastTextHash = currentHash

  // 密码、密钥、卡号这类东西不进库
  if (isSensitiveText(text)) return

  const lastItem = getLatestTextItem()
  if (lastItem && lastItem.content === text) {
    updateItemTime(lastItem.id)
    const refreshed = getItemById(lastItem.id)
    if (refreshed && onNewItemCallback) onNewItemCallback(refreshed)
    return
  }

  getForegroundApp().then((src) => {
    const item = addText(text, src)
    if (onNewItemCallback) onNewItemCallback(item)
  }).catch(() => {
    const item = addText(text, null)
    if (onNewItemCallback) onNewItemCallback(item)
  })
}

function poll(): void {
  if (!processImage()) {
    processText()
  }
}

export function startMonitoring(intervalMs = 500): void {
  lastTextHash = null
  lastImageHash = null
  stopMonitoring()
  intervalId = setInterval(poll, intervalMs)
}

export function stopMonitoring(): void {
  if (intervalId !== null) {
    clearInterval(intervalId)
    intervalId = null
  }
  lastTextHash = null
  lastImageHash = null
}

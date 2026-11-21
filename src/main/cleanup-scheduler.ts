import { existsSync, unlinkSync } from 'fs'
import { cleanupExpired, purgeOldArchived, getSetting, setSetting } from './database'

let intervalId: ReturnType<typeof setInterval> | null = null
// 回收站保留天数（默认 30 天，可在设置页改），超过才真删文件
let lastPurgeAt = 0

// 保留时长以「小时」为单位存储：2 / 4 / 6 / 24 / 72 / 168，0 表示永久保留
function readRetentionHours(): number {
  const stored = getSetting('retention_hours')
  if (stored) {
    const h = parseInt(stored, 10)
    return Number.isFinite(h) && h >= 0 ? h : 24
  }
  // 兼容旧版按「天」存储的设置
  const legacyDays = getSetting('retention_days')
  if (legacyDays) {
    const h = parseInt(legacyDays, 10) * 24
    if (Number.isFinite(h) && h >= 0) {
      setSetting('retention_hours', String(h))
      return h
    }
  }
  return 24
}

function readTrashKeepDays(): number {
  const stored = getSetting('trash_keep_days')
  const d = stored ? parseInt(stored, 10) : NaN
  return Number.isFinite(d) && d > 0 ? d : 30
}

// 回收站里躺太久的，才真正删掉（记录 + 图片文件）
function purgeTrash(): void {
  const paths = purgeOldArchived(readTrashKeepDays())
  for (const p of paths) {
    try {
      if (existsSync(p)) unlinkSync(p)
    } catch {
      /* 文件被占用就下次再删 */
    }
  }
  lastPurgeAt = Date.now()
}

function runCleanup(): void {
  const hours = readRetentionHours()
  if (hours > 0) {
    const graceStart = parseInt(getSetting('retention_started_at') || '0', 10)
    // 到期只移进回收站，不删文件
    cleanupExpired(hours, Number.isFinite(graceStart) ? graceStart : 0)
  }
  // 最多每 6 小时扫一次回收站，别每分钟都折腾磁盘
  if (Date.now() - lastPurgeAt > 6 * 3600000) purgeTrash()
}

export function startCleanupScheduler(): void {
  runCleanup()
  intervalId = setInterval(runCleanup, 60000) // 每分钟扫一次，到点就清，不会晚一小时
}

export function stopCleanupScheduler(): void {
  if (intervalId !== null) {
    clearInterval(intervalId)
    intervalId = null
  }
}

export { runCleanup }

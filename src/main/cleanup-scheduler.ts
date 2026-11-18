import { existsSync, unlinkSync } from 'fs'
import { cleanupExpired, getSetting, setSetting } from './database'

let intervalId: ReturnType<typeof setInterval> | null = null

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

function runCleanup(): void {
  const hours = readRetentionHours()
  if (hours <= 0) return
  const deletedPaths = cleanupExpired(hours)
  for (const p of deletedPaths) {
    if (existsSync(p)) unlinkSync(p)
  }
}

export function startCleanupScheduler(): void {
  runCleanup()
  intervalId = setInterval(runCleanup, 3600000) // hourly
}

export function stopCleanupScheduler(): void {
  if (intervalId !== null) {
    clearInterval(intervalId)
    intervalId = null
  }
}

export { runCleanup }

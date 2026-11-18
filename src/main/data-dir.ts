import { app } from 'electron'
import fs from 'fs'
import { join, resolve } from 'path'

interface AppConfig {
  dataDir?: string
  retentionDays?: string
}

function configPath(): string {
  return join(app.getPath('userData'), 'app-config.json')
}

/** 默认数据目录（跟随 Windows 用户数据目录） */
export function defaultDataDir(): string {
  return app.getPath('userData')
}

function readConfig(): AppConfig {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8')) as AppConfig
  } catch {
    return {}
  }
}

function writeConfig(cfg: AppConfig): void {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true })
    fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf8')
  } catch {
    /* 配置写入失败时退回默认目录 */
  }
}

/** 当前生效的数据目录：自定义目录可用则用它，否则用默认目录 */
export function getDataDir(): string {
  const cfg = readConfig()
  const custom = cfg.dataDir
  if (custom && custom.trim() && fs.existsSync(custom)) return custom
  return defaultDataDir()
}

export function saveDataDir(dir: string): void {
  const cfg = readConfig()
  cfg.dataDir = dir
  writeConfig(cfg)
}

/** 恢复默认目录（清除自定义设置） */
export function resetDataDir(): string {
  const cfg = readConfig()
  delete cfg.dataDir
  writeConfig(cfg)
  return defaultDataDir()
}

export function isCustomDataDir(): boolean {
  const cfg = readConfig()
  if (!cfg.dataDir || !cfg.dataDir.trim()) return false
  // 指向默认目录时不算自定义
  return resolve(cfg.dataDir).toLowerCase() !== resolve(defaultDataDir()).toLowerCase()
}

/** 目录占用（MB，保留一位小数） */
export function dirSizeMB(dir: string): number {
  let total = 0
  const walk = (p: string): void => {
    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(p, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = join(p, e.name)
      try {
        if (e.isDirectory()) walk(full)
        else total += fs.statSync(full).size
      } catch {
        /* 忽略单个文件错误 */
      }
    }
  }
  if (fs.existsSync(dir)) walk(dir)
  return Math.round((total / 1024 / 1024) * 10) / 10
}

/** 确认目录可写 */
export function ensureDirWritable(dir: string): { ok: boolean; message?: string } {
  try {
    fs.mkdirSync(dir, { recursive: true })
    const probe = join(dir, '.write-test')
    fs.writeFileSync(probe, 'ok', 'utf8')
    fs.unlinkSync(probe)
    return { ok: true }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
}

/** 递归复制目录内容（合并，不删除目标已有文件） */
export function copyDirContents(src: string, dst: string): void {
  if (!fs.existsSync(src)) return
  fs.mkdirSync(dst, { recursive: true })
  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const e of entries) {
    const s = join(src, e.name)
    const d = join(dst, e.name)
    if (e.isDirectory()) copyDirContents(s, d)
    else {
      fs.copyFileSync(s, d)
    }
  }
}

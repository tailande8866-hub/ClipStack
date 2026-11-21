import initSqlJs, { Database as SqlJsDatabase } from 'sql.js'
import { app } from 'electron'
import fs from 'fs'
import { join } from 'path'

export interface ClipboardItem {
  id: number
  type: 'text' | 'image'
  content: string | null
  image_path: string | null
  image_hash: string | null
  created_at: number
  is_pinned: number
  dup_count: number
  ocr_text?: string | null
  source_app?: string | null
}

let db: SqlJsDatabase | null = null
let dbPath: string = ''
let imagesDir: string = ''

export function getDbPath(): string {
  return dbPath
}

export function getImagesDir(): string {
  return imagesDir
}

export async function initDatabase(dataDir?: string): Promise<void> {
  const SQL = await initSqlJs()

  const dir = dataDir || join(app.getPath('userData'))
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  dbPath = join(dir, 'data.db')
  imagesDir = join(dir, 'images')
  if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir, { recursive: true })
  }

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath)
    db = new SQL.Database(buffer)
  } else {
    db = new SQL.Database()
  }

  createTables()
  save()
}

function createTables(): void {
  db!.run(`
    CREATE TABLE IF NOT EXISTS clipboard_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN ('text', 'image')),
      content TEXT,
      image_path TEXT,
      image_hash TEXT,
      created_at INTEGER NOT NULL,
      is_pinned INTEGER NOT NULL DEFAULT 0
    )
  `)
  db!.run(`CREATE INDEX IF NOT EXISTS idx_created_at ON clipboard_history(created_at DESC)`)
  db!.run(`CREATE INDEX IF NOT EXISTS idx_pinned ON clipboard_history(is_pinned)`)
  db!.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_image_hash ON clipboard_history(image_hash) WHERE image_hash IS NOT NULL`)

  // 老库补列：重复次数（同一条内容复制了几次）
  const cols = db!.exec('PRAGMA table_info(clipboard_history)')[0].values.map((r) => String(r[1]))
  if (!cols.includes('dup_count')) {
    db!.run('ALTER TABLE clipboard_history ADD COLUMN dup_count INTEGER NOT NULL DEFAULT 1')
  }
  // 截图里识别出来的文字，用来在搜索里命中图片
  if (!cols.includes('ocr_text')) {
    db!.run('ALTER TABLE clipboard_history ADD COLUMN ocr_text TEXT')
  }
  // 复制时前台是哪个程序（chrome / WeChat / Code …），用来按来源筛选
  if (!cols.includes('source_app')) {
    db!.run('ALTER TABLE clipboard_history ADD COLUMN source_app TEXT')
  }
  // 回收站：到期或手动删除的记录不真删，先标记归档，图片文件也留着
  if (!cols.includes('is_archived')) {
    db!.run('ALTER TABLE clipboard_history ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0')
  }
  if (!cols.includes('archived_at')) {
    db!.run('ALTER TABLE clipboard_history ADD COLUMN archived_at INTEGER NOT NULL DEFAULT 0')
  }

  db!.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)
}

function save(): void {
  const data = db!.export()
  fs.writeFileSync(dbPath, Buffer.from(data))
}

function rowToItem(row: Record<string, unknown>): ClipboardItem {
  return {
    id: row.id as number,
    type: row.type as 'text' | 'image',
    content: row.content as string | null,
    image_path: row.image_path as string | null,
    image_hash: row.image_hash as string | null,
    created_at: row.created_at as number,
    is_pinned: row.is_pinned as number,
    dup_count: Number(row.dup_count ?? 1) || 1,
    ocr_text: (row.ocr_text as string | null) ?? null,
    source_app: (row.source_app as string | null) ?? null,
    is_archived: Number(row.is_archived ?? 0) || 0,
    archived_at: Number(row.archived_at ?? 0) || 0,
  }
}

export type HistoryFilter = '' | 'image' | 'text' | 'link' | 'pinned' | string

export function getHistory(search?: string, limit = 50, offset = 0, filter: HistoryFilter | '' = ''): ClipboardItem[] {
  if (!db) return []

  const conds: string[] = ['is_archived = 0']
  const params: (string | number)[] = []

  if (filter === 'image') conds.push(`type = 'image'`)
  else if (filter === 'text') conds.push(`type = 'text'`)
  else if (filter === 'link') {
    conds.push(`type = 'text'`)
    conds.push(`content LIKE ?`)
    params.push('%http%')
  } else if (filter === 'pinned') conds.push('is_pinned = 1')
  else if (filter.startsWith('src:')) {
    conds.push('source_app = ?')
    params.push(filter.slice(4))
  }

  if (search) {
    // 搜索同时命中文字内容和截图里识别出来的文字
    conds.push('(content LIKE ? OR ocr_text LIKE ?)')
    params.push(`%${search}%`, `%${search}%`)
  }

  const sql = `
      SELECT * FROM clipboard_history
      ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''}
      ORDER BY is_pinned DESC, created_at DESC
      LIMIT ? OFFSET ?
    `
  params.push(limit, offset)

  const stmt = db!.prepare(sql)
  stmt.bind(params)
  const results: ClipboardItem[] = []
  while (stmt.step()) {
    results.push(rowToItem(stmt.getAsObject()))
  }
  stmt.free()
  return results
}

export function addText(text: string, source?: string | null): ClipboardItem {
  const now = Date.now()

  // 同一条内容已经在库里：不新增一行，只把它的时间提到最新、次数 +1
  const stmt = db!.prepare(
    "SELECT * FROM clipboard_history WHERE type = 'text' AND is_archived = 0 AND content = ? ORDER BY is_pinned DESC, created_at DESC LIMIT 1",
  )
  stmt.bind([text])
  let existing: ClipboardItem | null = null
  if (stmt.step()) existing = rowToItem(stmt.getAsObject())
  stmt.free()
  if (existing) {
    db!.run('UPDATE clipboard_history SET created_at = ?, dup_count = dup_count + 1 WHERE id = ?', [now, existing.id])
    save()
    return { ...existing, created_at: now, dup_count: existing.dup_count + 1 }
  }

  db!.run('INSERT INTO clipboard_history (type, content, created_at, source_app) VALUES (?, ?, ?, ?)', ['text', text, now, source ?? null])

  // 注意顺序：sql.js 的 export() 会关库重开，必须先取 rowid 再落盘，
  // 否则 last_insert_rowid() 会被重置成 0（新卡片 id=0 导致复制/置顶/删除全部失效）
  const result = db!.exec('SELECT last_insert_rowid() as id')
  const id = result[0].values[0][0] as number
  save()

  return {
    id,
    type: 'text',
    content: text,
    image_path: null,
    image_hash: null,
    created_at: now,
    is_pinned: 0,
    dup_count: 1,
    source_app: source ?? null,
  }
}

export function addImage(imagePath: string, imageHash: string, source?: string | null): ClipboardItem {
  const now = Date.now()
  db!.run(
    'INSERT INTO clipboard_history (type, image_path, image_hash, created_at, source_app) VALUES (?, ?, ?, ?, ?)',
    ['image', imagePath, imageHash, now, source ?? null],
  )

  const result = db!.exec('SELECT last_insert_rowid() as id')
  const id = result[0].values[0][0] as number
  save()

  return {
    id,
    type: 'image',
    content: null,
    image_path: imagePath,
    image_hash: imageHash,
    created_at: now,
    is_pinned: 0,
    dup_count: 1,
    source_app: source ?? null,
  }
}

export function updateItemTime(id: number): void {
  // 重复复制同一条：时间提到最新，次数 +1（列表里显示 ×N）
  // 如果它之前躺在回收站里（比如同一张图重新截了一次），顺手捞回列表
  db!.run(
    'UPDATE clipboard_history SET created_at = ?, dup_count = dup_count + 1, is_archived = 0, archived_at = 0 WHERE id = ?',
    [Date.now(), id],
  )
  save()
}

/** 写入截图的 OCR 文字（搜索用，界面上不直接显示） */
export function setOcrText(id: number, text: string): void {
  db!.run('UPDATE clipboard_history SET ocr_text = ? WHERE id = ?', [text, id])
  save()
}

/** 图片被重新压缩/换了扩展名后，把记录指向新文件 */
export function updateImagePath(id: number, path: string): void {
  db!.run('UPDATE clipboard_history SET image_path = ? WHERE id = ?', [path, id])
  save()
}

/** 最近的复制来源（按条数排序），给筛选条用 */
export function getTopSources(limit = 4): { app: string; count: number }[] {
  if (!db) return []
  const stmt = db!.prepare(
    "SELECT source_app AS app, COUNT(*) AS c FROM clipboard_history WHERE is_archived = 0 AND source_app IS NOT NULL AND source_app <> '' GROUP BY source_app ORDER BY c DESC LIMIT ?",
  )
  stmt.bind([limit])
  const out: { app: string; count: number }[] = []
  while (stmt.step()) {
    const row = stmt.getAsObject()
    out.push({ app: String(row.app), count: Number(row.c) })
  }
  stmt.free()
  return out
}

/** 还没做过 OCR 的图片（补扫时用） */
export function getImagesWithoutOcr(limit = 30): ClipboardItem[] {
  if (!db) return []
  const stmt = db!.prepare(
    "SELECT * FROM clipboard_history WHERE is_archived = 0 AND type = 'image' AND ocr_text IS NULL AND image_path IS NOT NULL ORDER BY created_at DESC LIMIT ?",
  )
  stmt.bind([limit])
  const out: ClipboardItem[] = []
  while (stmt.step()) out.push(rowToItem(stmt.getAsObject()))
  stmt.free()
  return out
}
export function getLatestTextItem(): ClipboardItem | null {
  if (!db) return null
  const stmt = db!.prepare('SELECT * FROM clipboard_history WHERE type = ? ORDER BY created_at DESC LIMIT 1')
  stmt.bind(['text'])
  if (stmt.step()) {
    const item = rowToItem(stmt.getAsObject())
    stmt.free()
    return item
  }
  stmt.free()
  return null
}

export function getItemByImageHash(hash: string): ClipboardItem | null {
  if (!db) return null
  const stmt = db!.prepare('SELECT * FROM clipboard_history WHERE image_hash = ?')
  stmt.bind([hash])
  if (stmt.step()) {
    const item = rowToItem(stmt.getAsObject())
    stmt.free()
    return item
  }
  stmt.free()
  return null
}

export function getItemById(id: number): ClipboardItem | null {
  if (!db) return null
  const stmt = db!.prepare('SELECT * FROM clipboard_history WHERE id = ?')
  stmt.bind([id])
  if (stmt.step()) {
    const item = rowToItem(stmt.getAsObject())
    stmt.free()
    return item
  }
  stmt.free()
  return null
}

export function pinItem(id: number, pinned: boolean): void {
  db!.run('UPDATE clipboard_history SET is_pinned = ? WHERE id = ?', [pinned ? 1 : 0, id])
  save()
}

// 手动删除：只进回收站（图片文件保留），30 天内可恢复
export function archiveItem(id: number): ClipboardItem | null {
  const item = getItemById(id)
  if (!item) return null
  db!.run('UPDATE clipboard_history SET is_archived = 1, archived_at = ? WHERE id = ?', [Date.now(), id])
  save()
  return item
}

// 真删（回收站里点"彻底删除"或自动过期清空时才走这里）
export function deleteItem(id: number): ClipboardItem | null {
  const item = getItemById(id)
  if (!item) return null
  db!.run('DELETE FROM clipboard_history WHERE id = ?', [id])
  save()
  return item
}

export function deleteImageItems(ids: number[]): ClipboardItem[] {
  const items: ClipboardItem[] = []
  for (const id of ids) {
    const item = deleteItem(id)
    if (item && item.image_path) {
      items.push(item)
    }
  }
  return items
}

export function getArchived(limit = 200, search?: string): ClipboardItem[] {
  if (!db) return []
  const conds: string[] = ['is_archived = 1']
  const params: (string | number)[] = []
  if (search) {
    conds.push('(content LIKE ? OR ocr_text LIKE ? OR source_app LIKE ?)')
    params.push(`%${search}%`, `%${search}%`, `%${search}%`)
  }
  params.push(limit)
  const stmt = db!.prepare(
    `SELECT * FROM clipboard_history WHERE ${conds.join(' AND ')} ORDER BY archived_at DESC LIMIT ?`,
  )
  stmt.bind(params)
  const results: ClipboardItem[] = []
  while (stmt.step()) results.push(rowToItem(stmt.getAsObject()))
  stmt.free()
  return results
}

export function getArchivedCount(): number {
  if (!db) return 0
  const r = db!.exec('SELECT COUNT(*) FROM clipboard_history WHERE is_archived = 1')
  const v = r[0]?.values?.[0]?.[0]
  return Number(v ?? 0) || 0
}

// 恢复：时间刷成现在，直接回到列表最上面
export function restoreItem(id: number): void {
  db!.run('UPDATE clipboard_history SET is_archived = 0, archived_at = 0, created_at = ? WHERE id = ?', [Date.now(), id])
  save()
}

// 回收站里躺太久的自动真删，返回要一起删掉的图片文件路径
export function purgeOldArchived(keepDays: number): string[] {
  if (!db) return []
  const days = Number.isFinite(keepDays) && keepDays > 0 ? keepDays : 30
  const cutoff = Date.now() - days * 86400000
  const stmt = db!.prepare('SELECT id, image_path FROM clipboard_history WHERE is_archived = 1 AND archived_at < ?')
  stmt.bind([cutoff])
  const paths: string[] = []
  while (stmt.step()) {
    const row = stmt.getAsObject()
    if (row.image_path) paths.push(row.image_path as string)
  }
  stmt.free()
  db!.run('DELETE FROM clipboard_history WHERE is_archived = 1 AND archived_at < ?', [cutoff])
  save()
  return paths
}

// 清空回收站：返回所有图片路径，由调用方 unlink
export function emptyTrash(): string[] {
  if (!db) return []
  const stmt = db!.prepare('SELECT image_path FROM clipboard_history WHERE is_archived = 1')
  const paths: string[] = []
  while (stmt.step()) {
    const row = stmt.getAsObject()
    if (row.image_path) paths.push(row.image_path as string)
  }
  stmt.free()
  db!.run('DELETE FROM clipboard_history WHERE is_archived = 1')
  save()
  return paths
}

export function getSetting(key: string): string | null {
  if (!db) return null
  const stmt = db!.prepare('SELECT value FROM settings WHERE key = ?')
  stmt.bind([key])
  if (stmt.step()) {
    const val = stmt.getAsObject().value as string
    stmt.free()
    return val
  }
  stmt.free()
  return null
}

export function setSetting(key: string, value: string): void {
  db!.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value])
  save()
}

export function cleanupExpired(retentionHours: number, graceStartAt = 0): number {
  if (!db) return 0
  if (!Number.isFinite(retentionHours) || retentionHours <= 0) return 0 // 0 = 永久保留
  const windowMs = retentionHours * 3600000
  // 设置保留时长的那一刻起重新计时：老记录也活满这一整段才清，
  // 不会「一改成 2 小时就把之前的东西全部抹掉」
  if (graceStartAt > 0 && Date.now() < graceStartAt + windowMs) return 0
  const cutoff = Date.now() - windowMs

  // 到期不再真删：整条移进回收站（is_archived = 1），图片文件原样留在磁盘上，随时能恢复
  const before = getArchivedCount()
  db!.run(
    'UPDATE clipboard_history SET is_archived = 1, archived_at = ? WHERE is_pinned = 0 AND is_archived = 0 AND created_at < ?',
    [Date.now(), cutoff],
  )
  save()
  return getArchivedCount() - before
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}

export interface HistoryStats {
  total: number
  textCount: number
  imageCount: number
  pinnedCount: number
  oldest: number | null
  newest: number | null
}

export function getStats(): HistoryStats {
  const empty: HistoryStats = { total: 0, textCount: 0, imageCount: 0, pinnedCount: 0, oldest: null, newest: null }
  if (!db) return empty
  const res = db.exec(
    `SELECT COUNT(*),
            SUM(CASE WHEN type = 'text' THEN 1 ELSE 0 END),
            SUM(CASE WHEN type = 'image' THEN 1 ELSE 0 END),
            SUM(CASE WHEN is_pinned = 1 THEN 1 ELSE 0 END),
            MIN(created_at),
            MAX(created_at)
       FROM clipboard_history`,
  )
  if (!res.length || !res[0].values.length) return empty
  const row = res[0].values[0]
  return {
    total: Number(row[0] || 0),
    textCount: Number(row[1] || 0),
    imageCount: Number(row[2] || 0),
    pinnedCount: Number(row[3] || 0),
    oldest: row[4] === null ? null : Number(row[4]),
    newest: row[5] === null ? null : Number(row[5]),
  }
}

/** 迁移数据目录后，把历史记录里的图片绝对路径改到新目录 */
export function remapImagePaths(oldImagesDir: string, newImagesDir: string): void {
  if (!db) return
  const oldNorm = oldImagesDir.replace(/\\/g, '/')
  const newNorm = newImagesDir.replace(/\\/g, '/')
  db.run(
    `UPDATE clipboard_history
       SET image_path = REPLACE(REPLACE(image_path, ?, ?), ?, ?)
     WHERE image_path LIKE ?`,
    [oldNorm, newNorm, oldImagesDir, newImagesDir, oldImagesDir + '%'],
  )
  save()
}

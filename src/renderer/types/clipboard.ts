export type HistoryFilter = '' | 'image' | 'text' | 'link' | 'pinned' | `src:${string}`

export interface ClipboardItem {
  id: number
  type: 'text' | 'image'
  content: string | null
  image_path: string | null
  image_hash: string | null
  created_at: number
  is_pinned: number
  dup_count?: number
  ocr_text?: string | null
  source_app?: string | null
}

export interface ElectronAPI {
  getHistory: (search?: string, limit?: number, offset?: number, filter?: HistoryFilter) => Promise<ClipboardItem[]>
  getTopSources: () => Promise<{ app: string; count: number }[]>
  startDrag: (filePath: string) => void
  copyToClipboard: (id: number) => Promise<boolean>
  pinItem: (id: number, pinned: boolean) => Promise<void>
  deleteItem: (id: number) => Promise<void>
  getTrash: (search?: string) => Promise<ClipboardItem[]>
  getTrashCount: () => Promise<number>
  restoreItem: (id: number) => Promise<void>
  purgeItem: (id: number) => Promise<void>
  emptyTrash: () => Promise<number>
  readImageData: (imagePath: string) => Promise<string | null>
  getSetting: (key: string) => Promise<string | null>
  setSetting: (key: string, value: string) => Promise<void>
  onNewItem: (callback: (item: ClipboardItem) => void) => () => void
  collapseToFloat: () => void
  expandFromFloat: () => void
  showFloatMenu: () => void
  setFloatIgnore: (ignore: boolean) => void
  quitApp: () => void
  openSettings: () => void
  getSettingsInfo: () => Promise<SettingsInfo>
  chooseDataDir: () => Promise<string | null>
  applyDataDir: (dir: string) => Promise<{ ok: boolean; message?: string }>
  resetDataDir: () => Promise<{ ok: boolean; message?: string }>
  openDataDir: (dir?: string) => Promise<string>
  setAutostart: (enabled: boolean) => Promise<boolean>
  minimizeSettings: () => void
  closeSettings: () => void
  onDataChanged: (callback: () => void) => () => void
  openExternal: (url: string) => Promise<boolean>
  copyText: (text: string) => Promise<boolean>
  exportDiagnostics: () => Promise<{ ok: boolean; canceled?: boolean; path?: string; message?: string }>
  exportBackup: () => Promise<{ ok: boolean; canceled?: boolean; path?: string; message?: string }>
  restoreBackup: () => Promise<{ ok: boolean; canceled?: boolean; message?: string }>
  getDiagnosticsText: () => Promise<string>
  checkUpdate: () => Promise<UpdateCheckResult>
  getUpdateStatus: () => Promise<UpdateCheckResult | null>
  setAutoCheckUpdate: (enabled: boolean) => Promise<boolean>
  onUpdateAvailable: (callback: (info: UpdateCheckResult) => void) => () => void
  dismissUpdate: (version: string) => Promise<boolean>
  installUpdate: () => Promise<{ ok: boolean; message: string }>
  onUpdateProgress: (callback: (progress: UpdateProgress) => void) => () => void
}

export interface UpdateProgress {
  phase: 'download' | 'extract' | 'apply'
  received?: number
  total?: number
  percent?: number
  message?: string
}

export interface HistoryStats {
  total: number
  textCount: number
  imageCount: number
  pinnedCount: number
  oldest: number | null
  newest: number | null
}

export interface UpdateCheckResult {
  time: number
  ok: boolean
  hasUpdate: boolean
  current: string
  latest: string | null
  message: string
  notes?: string | null
  url?: string | null
  publishedAt?: string | null
  seen?: boolean
  assetUrl?: string | null
  assetName?: string | null
  assetSize?: number | null
  assetDigest?: string | null
}

export interface SettingsInfo {
  dataDir: string
  defaultDir: string
  isCustom: boolean
  sizeMB: number
  dbPath: string
  dbSizeMB: number
  imagesDir: string
  imageFileCount: number
  version: string
  exePath: string
  appPath: string
  autostart: boolean
  stats: HistoryStats
  retentionHours: string
  autoCheckUpdate: boolean
  updateCheck: UpdateCheckResult | null
  qqGroup: string
  email: string
  repoUrl: string
  issuesUrl: string
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

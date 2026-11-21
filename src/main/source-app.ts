import { execFile } from 'child_process'
import { existsSync, writeFileSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// 取当前前台窗口所属进程名（chrome / WeChat / Code …），用来标记"这条是从哪复制的"
const PS = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')

const SCRIPT = String.raw`
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class ClipStackForeground {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
}
"@
$h = [ClipStackForeground]::GetForegroundWindow()
$procId = 0
[void][ClipStackForeground]::GetWindowThreadProcessId($h, [ref]$procId)
if ($procId -gt 0) {
  try { (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { }
}
`

let scriptPath = ''

function ensureScript(): string {
  if (scriptPath && existsSync(scriptPath)) return scriptPath
  const dir = mkdtempSync(join(tmpdir(), 'clipstack-src-'))
  scriptPath = join(dir, 'fg.ps1')
  writeFileSync(scriptPath, '\uFEFF' + SCRIPT, 'utf8')
  return scriptPath
}

const FRIENDLY: Record<string, string> = {
  code: 'VS Code',
  chrome: '浏览器',
  msedge: '浏览器',
  firefox: '浏览器',
  wechat: '微信',
  wechatappex: '微信',
  qq: 'QQ',
  wxwork: '企业微信',
  explorer: '资源管理器',
  notepad: '记事本',
  photoshop: 'PS',
  winword: 'Word',
  excel: 'Excel',
  powerpnt: 'PPT',
  ttime: '剪贴栈',
}

export function getForegroundApp(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      PS,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ensureScript()],
      { timeout: 4000, windowsHide: true },
      (err, stdout) => {
        if (err) return resolve(null)
        const raw = String(stdout || '').trim()
        if (!raw) return resolve(null)
        const name = raw.toLowerCase()
        if (name.startsWith('clipstack') || name.includes('悬浮') || name === 'ttime' || name === '剪贴栈') {
          return resolve(null)
        }
        resolve(FRIENDLY[name] || raw.slice(0, 20))
      },
    )
  })
}

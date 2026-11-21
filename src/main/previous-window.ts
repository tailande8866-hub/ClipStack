import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const PS =
  'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'

/** 我们自己进程的可执行名，捕获到这些就丢弃（说明面板已经抢到前台了） */
const SELF_NAMES = ['剪贴栈', 'ClipStack', 'electron', 'floatpaste']

const WARM_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class FgWarm9 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
}
"@
[Console]::Out.WriteLine('READY')
[Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line.Trim() -eq 'q') { break }
  if ($line.Trim() -ne 'c') { continue }
  $h = [FgWarm9]::GetForegroundWindow()
  $procId = 0
  [void][FgWarm9]::GetWindowThreadProcessId($h, [ref]$procId)
  $name = ''
  try { $name = (Get-Process -Id $procId).ProcessName } catch { }
  [Console]::Out.WriteLine("R|$name|$([IntPtr]$h)")
  [Console]::Out.Flush()
}
`

const PASTE_SCRIPT = `
param([string]$hwnd)
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Paste9 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
}
"@
$target = [IntPtr][long]$hwnd
$wsh = New-Object -ComObject WScript.Shell
# Windows 前台锁：先发一个 Alt 让系统认为我们在用户交互，之后再切窗口才有效
$wsh.SendKeys('%')
Start-Sleep -Milliseconds 60
if ([Paste9]::IsIconic($target)) { [void][Paste9]::ShowWindow($target, 9) }
[void][Paste9]::SetForegroundWindow($target)
Start-Sleep -Milliseconds 260
$wsh.SendKeys('^v')
Start-Sleep -Milliseconds 120
`

let scriptDir = ''
let warmScriptPath = ''
let pasteScriptPath = ''

function ensureScripts(): string {
  if (scriptDir) return scriptDir
  scriptDir = mkdtempSync(join(tmpdir(), 'clipstack-fgwarm-'))
  warmScriptPath = join(scriptDir, 'fgwarm.ps1')
  pasteScriptPath = join(scriptDir, 'fgpaste.ps1')
  writeFileSync(warmScriptPath, WARM_SCRIPT, 'utf8')
  writeFileSync(pasteScriptPath, PASTE_SCRIPT, 'utf8')
  return scriptDir
}

/* ---------------- 常驻助手 ---------------- */

let helper: ChildProcessWithoutNullStreams | null = null
let helperReady = false
let helperBuf = ''
let helperWaiters: Array<(line: string) => void> = []

function startHelper(): void {
  ensureScripts()
  try {
    helper = spawn(
      PS,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', warmScriptPath],
      { windowsHide: true }
    ) as ChildProcessWithoutNullStreams
  } catch {
    helper = null
    return
  }
  helper.stdout.setEncoding('utf8')
  helper.stdout.on('data', (chunk: string) => {
    helperBuf += chunk
    const lines = helperBuf.split(/\r?\n/)
    helperBuf = lines.pop() ?? ''
    for (const raw of lines) {
      const line = raw.trim()
      if (!line) continue
      if (line === 'READY') {
        helperReady = true
        continue
      }
      const waiter = helperWaiters.shift()
      if (waiter) waiter(line)
    }
  })
  helper.on('exit', () => {
    helper = null
    helperReady = false
    helperBuf = ''
    const waiters = helperWaiters
    helperWaiters = []
    for (const w of waiters) w('')
  })
  helper.on('error', () => {
    helper = null
    helperReady = false
  })
}

/** 启动时常驻起来，避免第一次呼出面板要等 PowerShell 冷启动 */
export function warmUpForegroundHelper(): void {
  if (helper) return
  startHelper()
}

function waitReady(timeoutMs: number): Promise<boolean> {
  if (helperReady) return Promise.resolve(true)
  const t0 = Date.now()
  return new Promise((resolve) => {
    const tick = () => {
      if (helperReady) return resolve(true)
      if (!helper) startHelper()
      if (Date.now() - t0 > timeoutMs) return resolve(false)
      setTimeout(tick, 40)
    }
    tick()
  })
}

/** 问助手要一次前台窗口信息；返回 null 表示超时/失败 */
export async function readForeground(
  timeoutMs = 500
): Promise<{ proc: string; hwnd: string } | null> {
  const ready = await waitReady(1200)
  if (!ready || !helper) return null
  const reply = await new Promise<string>((resolve) => {
    let done = false
    const finish = (v: string) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(v)
    }
    const timer = setTimeout(() => finish(''), timeoutMs)
    helperWaiters.push(finish)
    try {
      helper!.stdin.write('c\n')
    } catch {
      finish('')
    }
  })
  if (!reply) return null
  const parts = reply.split('|')
  if (parts.length < 3 || parts[0] !== 'R') return null
  return { proc: parts[1].trim(), hwnd: parts[2].trim() }
}

export function isOwnProcess(proc: string): boolean {
  if (!proc) return false
  const lower = proc.toLowerCase()
  return SELF_NAMES.some((n) => n.toLowerCase() === lower)
}

/** 克隆一份可用的前台窗口 hwnd；捕获到自己是返回空串 */
export async function captureForegroundWindow(
  timeoutMs = 500
): Promise<string> {
  const info = await readForeground(timeoutMs)
  if (!info || !info.hwnd || info.hwnd === '0') return ''
  if (isOwnProcess(info.proc)) return ''
  return info.hwnd
}

/* ---------------- 粘贴回去 ---------------- */

export function pasteBackToWindow(hwnd: string): Promise<boolean> {
  if (!hwnd) return Promise.resolve(false)
  const num = Number.parseInt(hwnd, 10)
  if (!Number.isFinite(num) || num <= 0) return Promise.resolve(false)
  ensureScripts()
  return new Promise((resolve) => {
    let done = false
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(ok)
    }
    const timer = setTimeout(() => finish(true), 3000)
    try {
      const p = spawn(
        PS,
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pasteScriptPath, String(num)],
        { windowsHide: true }
      )
      p.on('exit', (code) => finish(code === 0))
      p.on('error', () => finish(false))
    } catch {
      finish(false)
    }
  })
}

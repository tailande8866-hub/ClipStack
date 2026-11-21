import { execFile } from 'child_process'
import { existsSync, writeFileSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// 用 Windows 自带 OCR（Windows.Media.Ocr）识别截图文字，
// 不联网、不装额外依赖；系统里没有中文 OCR 语言包时会安静失败。
const PS = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')

const SCRIPT = String.raw`
param([Parameter(Mandatory = $true)][string]$Path)
$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and ($_.GetParameters()[0].ParameterType.Name -eq ('IAsyncOperation' + [char]96 + '1'))
  })[0]
function Await($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  $netTask.Result
}
[void][Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
[void][Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
[void][Windows.Storage.StorageFile, Windows.Foundation, ContentType = WindowsRuntime]
[void][Windows.Globalization.Language, Windows.Foundation, ContentType = WindowsRuntime]
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Path)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$lang = New-Object Windows.Globalization.Language 'zh-Hans-CN'
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)
if ($null -eq $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
if ($null -eq $engine) { exit 2 }
$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
$stream.Dispose()
$result.Text
`

let scriptPath = ''

function ensureScript(): string {
  if (scriptPath && existsSync(scriptPath)) return scriptPath
  const dir = mkdtempSync(join(tmpdir(), 'clipstack-ocr-'))
  scriptPath = join(dir, 'ocr.ps1')
  writeFileSync(scriptPath, '\uFEFF' + SCRIPT, 'utf8')
  return scriptPath
}

/** 中文 OCR 会在每个字之间插空格，这里把相邻汉字/标点之间的空格去掉 */
function tidy(text: string): string {
  const cjk = '[\\u4e00-\\u9fff、，。！？；：（）「」『』“”‘’《》—…]'
  const re = new RegExp(`(${cjk})\\s+(?=${cjk})`, 'g')
  return text.replace(re, '$1').replace(/\s+/g, ' ').trim()
}

export function ocrImage(imagePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (!existsSync(imagePath)) return resolve(null)
    execFile(
      PS,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ensureScript(), '-Path', imagePath],
      { timeout: 20000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return resolve(null)
        const text = tidy(String(stdout || ''))
        resolve(text.length >= 2 ? text : null)
      },
    )
  })
}

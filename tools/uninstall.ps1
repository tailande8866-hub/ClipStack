$dir = "E:\浮贴\app"
Stop-Process -Name "剪贴栈","浮贴","小明剪贴板" -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $env:USERPROFILE "Desktop\剪贴栈.lnk") -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $env:USERPROFILE "Desktop\浮贴.lnk") -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\剪贴栈.lnk") -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\浮贴.lnk") -Force -ErrorAction SilentlyContinue
foreach ($n in @("electron.app.剪贴栈","electron.app.浮贴","electron.app.小明剪贴板","剪贴栈","浮贴","clipboard-history","XiaoMingClipboard","FloatPaste")) { Remove-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name $n -ErrorAction SilentlyContinue }
foreach ($k in @("ClipStack","FloatPaste","XiaoMingClipboard")) { Remove-Item "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$k" -Recurse -Force -ErrorAction SilentlyContinue }
Get-ChildItem $dir -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne "uninstall.ps1" } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Start-Process "$env:SystemRoot\System32\cmd.exe" -ArgumentList "/c", "timeout /t 3 >nul & rmdir /s /q `"$dir`"" -WindowStyle Hidden

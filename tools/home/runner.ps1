# מריץ את המשימה הביתית רק אם הקוד שנמשך מ-GitHub מאושר.
# הקובץ הזה מותקן מחוץ לפרויקט (%LOCALAPPDATA%\tv-guide-runner) ו-Task Scheduler מריץ אותו משם,
# כך שקוד חדש מהמאגר לא יכול לשנות את הבדיקה עצמה. אישור קוד חדש: tools\home\trust.ps1 (ידני בלבד).
param([string]$Repo = "C:\Users\eladw\tv-guide")
$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$dir = Join-Path $env:LOCALAPPDATA "tv-guide-runner"
$trustFile = Join-Path $dir "trusted.json"
$log = Join-Path $dir "runner.log"
function Log($m) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm') $m" | Out-File $log -Append -Encoding utf8 }

Set-Location $Repo
& git fetch -q origin main 2>&1 | Out-Null
& git merge --ff-only -q origin/main 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Log "git merge --ff-only failed; not running"; exit 1 }

if (-not (Test-Path $trustFile)) { Log "no trusted.json; not running"; exit 2 }
$trusted = Get-Content $trustFile -Raw -Encoding utf8 | ConvertFrom-Json
$files = @("hot-local.ps1", "tools/home/runner.ps1") + @(Get-ChildItem -File -Filter *.mjs | ForEach-Object { $_.Name })
$bad = @()
foreach ($f in $files) {
  $h = (Get-FileHash -Algorithm SHA256 (Join-Path $Repo $f)).Hash
  $t = $trusted.files.$f
  if (-not $t -or $t -ne $h) { $bad += $f }
}
if ($bad.Count) {
  Log ("BLOCKED: unapproved code: " + ($bad -join ", ") + " @ " + (& git rev-parse --short HEAD))
  exit 3
}
Log ("ok @ " + (& git rev-parse --short HEAD))
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Repo "hot-local.ps1")

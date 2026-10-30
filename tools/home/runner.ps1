# מריץ את המשימה הביתית רק אם הקוד שהיא מריצה מאושר.
# הקובץ הזה ו-closure.ps1 מותקנים מחוץ לפרויקט (%LOCALAPPDATA%\tv-guide-runner) ו-Task Scheduler מריץ אותם משם,
# כך שקוד חדש מהמאגר לא יכול לשנות את הבדיקה עצמה. אישור קוד חדש: tools\home\trust.ps1 (ידני בלבד).
# כשהקוד לא מאושר: לא מריצים כלום, ודוחפים home-status.json כדי שהבקרה תתריע בטלגרם.
param([string]$Repo = "C:\Users\eladw\tv-guide")
$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$dir = Join-Path $env:LOCALAPPDATA "tv-guide-runner"
$trustFile = Join-Path $dir "trusted.json"
$log = Join-Path $dir "runner.log"
function Log($m) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm') $m" | Out-File $log -Append -Encoding utf8 }
. (Join-Path $dir "closure.ps1")

function Report($status, $files) {
  $p = Join-Path $Repo "home-status.json"
  $old = if (Test-Path $p) { Get-Content $p -Raw -Encoding utf8 } else { "" }
  $new = [ordered]@{ status = $status; files = @($files); commit = (& git rev-parse --short HEAD); at = (Get-Date).ToUniversalTime().ToString("s") + "Z" } | ConvertTo-Json -Compress
  if ($old -and ($old | ConvertFrom-Json).status -eq $status -and $status -eq "ok") { return }
  [IO.File]::WriteAllText($p, $new)
  & git add home-status.json 2>&1 | Out-Null
  & git commit -q -m "home: $status" 2>&1 | Out-Null
  & git pull -q --rebase 2>&1 | Out-Null
  & git push -q 2>&1 | Out-Null
}

Set-Location $Repo
& git fetch -q origin main 2>&1 | Out-Null
& git merge --ff-only -q origin/main 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Log "git merge --ff-only failed; not running"; exit 1 }

$files = Get-HomeFiles $Repo
$trusted = if (Test-Path $trustFile) { (Get-Content $trustFile -Raw -Encoding utf8 | ConvertFrom-Json).files } else { $null }
$bad = @()
foreach ($f in $files) {
  $p = Join-Path $Repo $f
  $h = if (Test-Path $p) { (Get-FileHash -Algorithm SHA256 $p).Hash } else { "missing" }
  $t = if ($trusted) { $trusted.$f } else { $null }
  if (-not $t -or $t -ne $h) { $bad += $f }
}
if ($bad.Count) {
  Log ("BLOCKED: needs approval: " + ($bad -join ", ") + " @ " + (& git rev-parse --short HEAD))
  Report "needs-approval" $bad
  exit 3
}
Log ("ok @ " + (& git rev-parse --short HEAD))
Report "ok" @()
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Repo "hot-local.ps1")

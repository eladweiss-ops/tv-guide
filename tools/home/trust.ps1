# אישור ידני של הקוד שהמשימה הביתית מריצה. להריץ רק אחרי שבדקת את השינויים.
# מראה מה השתנה מאז האישור הקודם, שומר טביעת אצבע (SHA-256) לכל קובץ מחוץ לפרויקט,
# ומתקין את runner.ps1 ו-closure.ps1 בתיקייה המוגנת.
param([string]$Repo = "C:\Users\eladw\tv-guide", [switch]$Yes)
$dir = Join-Path $env:LOCALAPPDATA "tv-guide-runner"
$trustFile = Join-Path $dir "trusted.json"
New-Item -ItemType Directory -Force $dir | Out-Null
Set-Location $Repo
& git fetch -q origin main
& git merge --ff-only -q origin/main
$head = (& git rev-parse HEAD)
. (Join-Path $Repo "tools\home\closure.ps1")
$files = Get-HomeFiles $Repo
Write-Host "Files the home task runs:" ($files -join ", ")
if (Test-Path $trustFile) {
  $prev = (Get-Content $trustFile -Raw -Encoding utf8 | ConvertFrom-Json).commit
  Write-Host "Changes since last approval ($($prev.Substring(0,7))):"
  & git --no-pager diff --stat $prev $head -- $files
}
if (-not $Yes) {
  $a = Read-Host "Approve these files at $($head.Substring(0,7))? (yes/no)"
  if ($a -ne "yes") { Write-Host "Not approved."; exit 1 }
}
$map = [ordered]@{}
foreach ($f in $files) { $p = Join-Path $Repo $f; if (Test-Path $p) { $map[$f] = (Get-FileHash -Algorithm SHA256 $p).Hash } }
[ordered]@{ commit = $head; at = (Get-Date).ToString("s"); files = $map } | ConvertTo-Json -Depth 3 | Out-File $trustFile -Encoding utf8
Copy-Item (Join-Path $Repo "tools\home\runner.ps1") (Join-Path $dir "runner.ps1") -Force
Copy-Item (Join-Path $Repo "tools\home\closure.ps1") (Join-Path $dir "closure.ps1") -Force
Write-Host "Approved $($map.Count) files. Installed runner.ps1 + closure.ps1 in $dir"

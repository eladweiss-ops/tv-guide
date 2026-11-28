# tools/set-cron-secret.ps1 – מחליף את CRON_SECRET בערך חדש אחד, גם ב-Vercel וגם ב-GitHub Actions (רק אלעד מריץ).
# למה: העדכון הלילי ב-GitHub קורא לשרת (/api/team-sync) כדי ליצור תזכורות קבוצה מיד אחרי שהלוח מתעדכן,
# וצריך את אותו סוד כמו ב-Vercel. הערך הקיים ב-Vercel רגיש ואי אפשר לקרוא אותו, לכן מחליפים בחדש.
# הרצה: powershell -ExecutionPolicy Bypass -File C:\Users\eladw\tv-guide\tools\set-cron-secret.ps1   ואחריו deploy-server.ps1
$ErrorActionPreference = "Stop"
function Fail($m) { Write-Host "FAILED: $m" -ForegroundColor Red; exit 1 }
$repo = Split-Path -Parent $PSScriptRoot
Set-Location (Join-Path $repo "calendar-server")
$bytes = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$s = -join ($bytes | ForEach-Object { $_.ToString("x2") })
cmd /c "npx vercel env rm CRON_SECRET production -y 2>&1" | Out-Null   # אם לא קיים – לא משנה
$s | cmd /c "npx vercel env add CRON_SECRET production --sensitive 2>&1" | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "Vercel env add" }
$s | gh secret set CRON_SECRET --repo eladweiss-ops/tv-guide
if ($LASTEXITCODE -ne 0) { Fail "gh secret set" }
Write-Host "CRON_SECRET OK (Vercel + GitHub). עכשיו להריץ deploy-server.ps1" -ForegroundColor Green

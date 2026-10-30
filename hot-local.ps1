# מושך את כל המקורות שחוסמים שרתים מחוץ לישראל (HOT, ערוץ 14) ודוחף ל-GitHub.
# רץ מ-Task Scheduler כל בוקר ובהתחברות. הנתונים נשמרים בקבצי מטמון (hot-cache.json, extra-cache.json),
# והעדכון הלילי ב-GitHub מחיל אותם מחדש, כך שמספיק שהמחשב יהיה דלוק פעם בכמה ימים.
$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
Set-Location $PSScriptRoot
$log = Join-Path $PSScriptRoot "hot-local.log"
function Run($cmd) { & cmd /c "$cmd 2>&1" | Out-File $log -Append -Encoding utf8 }
"=== $(Get-Date -Format 'yyyy-MM-dd HH:mm') ===" | Out-File $log -Append -Encoding utf8
# המשיכה מ-GitHub והבדיקה שהקוד מאושר נעשות ב-tools/home/runner.ps1 לפני שהקובץ הזה רץ
Run "node enrich_hot.mjs"
Run "node extra_channels.mjs"
git add guide.json hot-cache.json extra-cache.json
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
  Run "git commit -m ""Israeli sources (home computer)"""
  Run "git pull --rebase"
  Run "git push"
} else { "no changes" | Out-File $log -Append -Encoding utf8 }

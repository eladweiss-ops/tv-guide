# מושך תקצירים מ-HOT (עובד רק מכתובת בישראל) ודוחף ל-GitHub.
# רץ מ-Task Scheduler כל בוקר. התקצירים נשמרים גם ב-hot-cache.json,
# והעדכון הלילי ב-GitHub מחיל אותם מחדש, כך שמספיק שהמחשב יהיה דלוק פעם בכמה ימים.
$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot
$log = Join-Path $PSScriptRoot "hot-local.log"
"=== $(Get-Date -Format 'yyyy-MM-dd HH:mm') ===" | Out-File $log -Append -Encoding utf8
git pull --rebase --autostash 2>&1 | Out-File $log -Append -Encoding utf8
node enrich_hot.mjs 2>&1 | Out-File $log -Append -Encoding utf8
git add guide.json hot-cache.json
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
  git commit -m "HOT summaries (home computer)" 2>&1 | Out-File $log -Append -Encoding utf8
  git pull --rebase 2>&1 | Out-File $log -Append -Encoding utf8
  git push 2>&1 | Out-File $log -Append -Encoding utf8
} else { "no changes" | Out-File $log -Append -Encoding utf8 }

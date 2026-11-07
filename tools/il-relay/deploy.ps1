# פריסת ממסר HOT ל-Cloud Run בתל אביב + שמירת הכתובת והמפתח כ-secrets ב-GitHub.
# הרצה (אלעד בלבד): powershell -ExecutionPolicy Bypass -File "C:\Users\eladw\לוח שידורים\tools\il-relay\deploy.ps1"
# הרצה חוזרת: מפתח חדש, פריסה מחדש ועדכון ה-secrets. המפתח לא נשמר במאגר ולא מודפס.
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$bytes = New-Object byte[] 24; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$key = [Convert]::ToBase64String($bytes) -replace '[+/=]', ''
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $here "server.js")))
$runArgs = "^;^-e;eval(Buffer.from('$b64','base64').toString())"

gcloud run deploy il-relay --project tv-guide-8f736 --region me-west1 `
  --image docker.io/library/node:22-slim --command node --args=$runArgs `
  --set-env-vars "RELAY_KEY=$key" --allow-unauthenticated `
  --max-instances 1 --memory 512Mi --cpu 1 --timeout 120 --quiet
if ($LASTEXITCODE -ne 0) { throw "deploy failed" }

$url = (gcloud run services describe il-relay --project tv-guide-8f736 --region me-west1 --format "value(status.url)").Trim()
$key | gh secret set HOT_RELAY_KEY -R eladweiss-ops/tv-guide
$url | gh secret set HOT_RELAY_URL -R eladweiss-ops/tv-guide

$d = (Get-Date).ToString("yyyy-MM-dd")
$code = (Invoke-WebRequest -Uri "$url/hot?from=$d&to=$d" -Headers @{ "x-relay-key" = $key } -UseBasicParsing).StatusCode
Write-Host "RELAY OK @ $url (HOT $code)"

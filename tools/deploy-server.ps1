# Deploy calendar-server to Vercel production - always from origin/main (GitHub), never from a local copy.
# Usage (from any clone of the repo):
#   powershell -ExecutionPolicy Bypass -File C:\Users\eladw\tv-guide\tools\deploy-server.ps1
# Steps: git fetch -> export origin/main:calendar-server to a temp folder (working tree untouched)
#        -> npm ci -> tests -> make sure CRON_SECRET exists -> vercel deploy --prod
# ASCII only on purpose: Windows PowerShell 5 misreads UTF-8 without BOM.
$ErrorActionPreference = "Continue"
$repo = Split-Path -Parent $PSScriptRoot
$env:VERCEL_ORG_ID = "team_3ZTTTE9reTK9EYwXO6t5y0mH"      # not secret (project ids, see CLAUDE.md section 6)
$env:VERCEL_PROJECT_ID = "prj_IJJcborobtVWvo155wvHm6HaxtKA"

function Fail($m) { Write-Host "DEPLOY FAILED: $m"; exit 1 }

git -C $repo fetch -q origin main
if ($LASTEXITCODE -ne 0) { Fail "git fetch" }
$sha = (git -C $repo rev-parse --short origin/main).Trim()

$tmp = Join-Path $env:TEMP ("tvg-deploy-" + $sha)
if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
New-Item -ItemType Directory -Force $tmp | Out-Null
$tar = Join-Path $env:TEMP ("tvg-deploy-" + $sha + ".tar")
git -C $repo archive --format=tar -o $tar origin/main   # whole tree: some server tests also check js/ and manifest
if ($LASTEXITCODE -ne 0) { Fail "git archive" }
tar -xf $tar -C $tmp
Remove-Item -Force $tar
$srv = Join-Path $tmp "calendar-server"
Set-Location $srv
Write-Host "Deploying origin/main @ $sha"

cmd /c "npm ci --no-audit --no-fund 2>&1" | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "npm ci" }
cmd /c "node --test test/ 2>&1" | Select-Object -Last 8
if ($LASTEXITCODE -ne 0) { Fail "tests failed - nothing was deployed" }

$list = (cmd /c "npx vercel env ls production 2>&1") -join "`n"
if ($list -notmatch "CRON_SECRET") {
  $s = [guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")
  $s | cmd /c "npx vercel env add CRON_SECRET production --sensitive 2>&1"
  if ($LASTEXITCODE -ne 0) { Fail "adding CRON_SECRET" }
}

cmd /c "npx vercel deploy --prod --yes 2>&1"
if ($LASTEXITCODE -ne 0) { Fail "vercel deploy" }
Set-Location $env:TEMP
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
Write-Host "DEPLOY OK @ $sha"

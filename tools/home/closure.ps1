# רשימת הקבצים שהמשימה הביתית באמת מריצה: hot-local.ps1, runner.ps1, נקודות הכניסה,
# וכל קובץ ‎.mjs שהן טוענות (import יחסי, רקורסיבית). רק אותם בודקים ומאשרים,
# כך ששינוי בסקריפטים אחרים (נטפליקס, וואלה, ספורט) לא עוצר את המשימה בבית.
function Get-HomeFiles([string]$Repo) {
  $entries = @("enrich_hot.mjs", "extra_channels.mjs")
  $seen = [ordered]@{ "hot-local.ps1" = 1; "tools/home/runner.ps1" = 1; "tools/home/closure.ps1" = 1 }
  $queue = [System.Collections.Queue]::new()
  foreach ($e in $entries) { $queue.Enqueue($e) }
  while ($queue.Count) {
    $f = $queue.Dequeue()
    if ($seen.Contains($f)) { continue }
    $seen[$f] = 1
    $p = Join-Path $Repo $f
    if (-not (Test-Path $p)) { continue }
    $txt = Get-Content $p -Raw -Encoding utf8
    foreach ($m in [regex]::Matches($txt, '(?:from\s+|import\s*\(\s*|import\s+)["'']\./([\w.\-]+\.mjs)["'']')) {
      $queue.Enqueue($m.Groups[1].Value)
    }
  }
  return @($seen.Keys)
}

# Scan source files and report those exceeding thresholds
$warnThreshold = 700
$hardThreshold = 900
$extensions = @("*.js", "*.ts", "*.jsx", "*.tsx")
$excludePatterns = @("node_modules", "\.git", "dist", "build", "\.next", "coverage", "\.claude", "vendor")

$critical = @()
$warning = @()

foreach ($ext in $extensions) {
  $files = Get-ChildItem -Recurse -Include $ext -File -ErrorAction SilentlyContinue
  foreach ($file in $files) {
    $skip = $false
    foreach ($pattern in $excludePatterns) {
      if ($file.FullName -match $pattern) { $skip = $true; break }
    }
    if ($skip) { continue }

    $lineCount = (Get-Content $file.FullName -ErrorAction SilentlyContinue | Measure-Object -Line).Lines
    if ($lineCount -gt $hardThreshold) {
      $critical += [PSCustomObject]@{
        Lines = $lineCount
        File  = $file.FullName.Replace("C:\9router\", "")
        Status = "CRITICAL"
      }
    } elseif ($lineCount -gt $warnThreshold) {
      $warning += [PSCustomObject]@{
        Lines = $lineCount
        File  = $file.FullName.Replace("C:\9router\", "")
        Status = "WARNING"
      }
    }
  }
}

Write-Host ""
Write-Host "=== CRITICAL (>900 lines - MUST modularize) ==="
$critical | Sort-Object Lines -Descending | Format-Table Lines, File -AutoSize

Write-Host "=== WARNING (700-900 lines - consider splitting) ==="
$warning | Sort-Object Lines -Descending | Format-Table Lines, File -AutoSize

Write-Host "=== SUMMARY ==="
Write-Host "CRITICAL (>$hardThreshold lines): $($critical.Count) files"
Write-Host "WARNING ($warnThreshold-$hardThreshold lines): $($warning.Count) files"
Write-Host "Total needing attention: $($critical.Count + $warning.Count) files"

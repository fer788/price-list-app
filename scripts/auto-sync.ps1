param(
  [int]$IntervalSeconds = 60,
  [string]$Branch = "dev"
)

$ErrorActionPreference = "Continue"

function Has-Remote {
  $remotes = git remote 2>$null
  return $LASTEXITCODE -eq 0 -and ($remotes -match "origin")
}

while ($true) {
  try {
    git rev-parse --is-inside-work-tree *> $null
    if ($LASTEXITCODE -ne 0) {
      Write-Host "Not a git repo. Retrying in $IntervalSeconds seconds..."
      Start-Sleep -Seconds $IntervalSeconds
      continue
    }

    git checkout $Branch *> $null
    git add -A

    git diff --cached --quiet
    if ($LASTEXITCODE -ne 0) {
      $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
      git commit -m "auto-sync: $timestamp" *> $null
      if ($LASTEXITCODE -eq 0 -and (Has-Remote)) {
        git push origin $Branch *> $null
      }
      Write-Host "Synced changes at $timestamp"
    }
  } catch {
    Write-Host "Auto-sync error: $($_.Exception.Message)"
  }

  Start-Sleep -Seconds $IntervalSeconds
}

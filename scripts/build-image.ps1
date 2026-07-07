param(
  [Parameter(Mandatory = $true)]
  [string]$Tag
)

$ErrorActionPreference = 'Stop'

$Root = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')
$Script = Join-Path $Root 'scripts\build-image.sh'
$Candidates = @(
  (Get-Command bash -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue),
  'C:\Program Files\Git\bin\bash.exe',
  'C:\Program Files\Git\usr\bin\bash.exe',
  'C:\msys64\usr\bin\bash.exe'
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique

$Bash = $null
foreach ($Candidate in $Candidates) {
  try {
    $Version = & $Candidate -lc 'printf ok' 2>$null
    if ($LASTEXITCODE -eq 0 -and $Version -eq 'ok') {
      $Bash = $Candidate
      break
    }
  } catch {
    continue
  }
}

if (-not $Bash) {
  throw 'No usable bash found. Install Git for Windows or run scripts/build-image.sh from a POSIX shell.'
}

Write-Host "Using bash: $Bash"
& $Bash $Script $Tag
exit $LASTEXITCODE

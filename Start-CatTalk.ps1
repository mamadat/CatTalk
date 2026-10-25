param([switch]$Mobile)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$bundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$nodeExecutable = if (Test-Path -LiteralPath $bundledNode) { $bundledNode } else { (Get-Command node -ErrorAction Stop).Source }
$env:Path = (Split-Path -Parent $nodeExecutable) + ';' + $env:Path
if (-not (Test-Path -LiteralPath 'node_modules\expo\bin\cli')) {
  Write-Error 'Dependencies are missing. Run npm ci first using Node 22.13 or newer.'
}
if ($Mobile) { & $nodeExecutable 'node_modules\expo\bin\cli' start --offline }
else { & $nodeExecutable 'node_modules\expo\bin\cli' start --web --offline }

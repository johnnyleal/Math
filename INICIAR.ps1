$ErrorActionPreference = 'Stop'
$labNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
if (-not (Test-Path -LiteralPath $labNode)) { $labNode = (Get-Command node).Source }
$labServer = Join-Path $PSScriptRoot 'server.cjs'
Write-Host 'Laboratorio local em http://127.0.0.1:8765. Feche com Ctrl+C.'
& $labNode $labServer

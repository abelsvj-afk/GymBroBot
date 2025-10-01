param(
  [int]$Port = 3001,
  [string]$DebugCommands = '1'
)

$cwd = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $cwd

$env:PORT = $Port
$env:DEBUG_COMMANDS = $DebugCommands

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Write-Error "node executable not found in PATH"; exit 1 }

$logDir = Join-Path $cwd 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

$stdout = Join-Path $logDir 'bot.out.log'
$stderr = Join-Path $logDir 'bot.err.log'

Write-Output "Starting GymBroBot detached; logs -> $stdout | $stderr"

# Start node in a new process; it returns immediately so your shell and the assistant won't block
Start-Process -FilePath $node -ArgumentList 'bot.js' -WorkingDirectory $cwd -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden

Write-Output "Bot start issued; check logs with Get-Content -Tail 50 -Wait $stdout"
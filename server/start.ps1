$ErrorActionPreference = "Stop"

$serverDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$envPath = Join-Path $serverDir ".env"
$pythonPath = Join-Path $serverDir "venv\Scripts\python.exe"

if (-not (Test-Path $envPath)) {
    Write-Host "Missing server\.env." -ForegroundColor Red
    Write-Host "Copy server\.env.example to server\.env and configure it." -ForegroundColor Yellow
    exit 1
}

if (Test-Path $pythonPath) {
    & $pythonPath (Join-Path $serverDir "run.py")
} else {
    python (Join-Path $serverDir "run.py")
}

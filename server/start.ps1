$ErrorActionPreference = "Stop"

$serverDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$envPath = Join-Path $serverDir ".env"
$pythonPath = Join-Path $serverDir "venv\Scripts\python.exe"

if (-not (Test-Path $envPath)) {
    Write-Host "Missing server\.env." -ForegroundColor Red
    Write-Host "Create server\.env with your MongoDB Atlas settings:" -ForegroundColor Yellow
    Write-Host "MONGO_URI=mongodb+srv://YOUR_USERNAME:YOUR_PASSWORD@YOUR_CLUSTER.mongodb.net/bragright?retryWrites=true&w=majority"
    Write-Host "MONGO_DB_NAME=bragright"
    exit 1
}

$envContent = Get-Content $envPath -Raw

if ($envContent -notmatch "(?m)^MONGO_URI=mongodb\+srv://") {
    Write-Host "MONGO_URI must be a MongoDB Atlas mongodb+srv:// URI." -ForegroundColor Red
    Write-Host "Update server\.env and use the Atlas connection string from MongoDB Atlas." -ForegroundColor Yellow
    exit 1
}

$mongoUriLine = ($envContent -split "`r?`n") | Where-Object { $_ -match "^MONGO_URI=" } | Select-Object -First 1

if ($mongoUriLine -match "localhost|127\.0\.0\.1|0\.0\.0\.0") {
    Write-Host "server\.env is pointing at a local MongoDB server." -ForegroundColor Red
    Write-Host "Replace it with your MongoDB Atlas mongodb+srv:// URI." -ForegroundColor Yellow
    exit 1
}

if (Test-Path $pythonPath) {
    & $pythonPath (Join-Path $serverDir "run.py")
} else {
    python (Join-Path $serverDir "run.py")
}

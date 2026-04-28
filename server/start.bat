@echo off
setlocal

set "SERVER_DIR=%~dp0"
set "ENV_PATH=%SERVER_DIR%.env"
set "PYTHON_PATH=%SERVER_DIR%venv\Scripts\python.exe"

if not exist "%ENV_PATH%" (
  echo Missing server\.env.
  echo Create server\.env with your MongoDB Atlas settings:
  echo MONGO_URI=mongodb+srv://YOUR_USERNAME:YOUR_PASSWORD@YOUR_CLUSTER.mongodb.net/bragright?retryWrites=true^&w=majority
  echo MONGO_DB_NAME=bragright
  exit /b 1
)

findstr /R /C:"^MONGO_URI=mongodb+srv://" "%ENV_PATH%" >nul
if errorlevel 1 (
  echo MONGO_URI must be a MongoDB Atlas mongodb+srv:// URI.
  echo Update server\.env and use the Atlas connection string from MongoDB Atlas.
  exit /b 1
)

findstr /R /C:"^MONGO_URI=.*localhost" /C:"^MONGO_URI=.*127\.0\.0\.1" /C:"^MONGO_URI=.*0\.0\.0\.0" "%ENV_PATH%" >nul
if not errorlevel 1 (
  echo server\.env is pointing at a local MongoDB server.
  echo Replace it with your MongoDB Atlas mongodb+srv:// URI.
  exit /b 1
)

if exist "%PYTHON_PATH%" (
  "%PYTHON_PATH%" "%SERVER_DIR%run.py"
) else (
  python "%SERVER_DIR%run.py"
)

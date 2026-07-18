@echo off
setlocal

set "SERVER_DIR=%~dp0"
set "ENV_PATH=%SERVER_DIR%.env"
set "PYTHON_PATH=%SERVER_DIR%venv\Scripts\python.exe"

if not exist "%ENV_PATH%" (
  echo Missing server\.env.
  echo Copy server\.env.example to server\.env and configure it.
  exit /b 1
)

if exist "%PYTHON_PATH%" (
  "%PYTHON_PATH%" "%SERVER_DIR%run.py"
) else (
  python "%SERVER_DIR%run.py"
)

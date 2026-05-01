@echo off
setlocal

set "SERVER_DIR=%~dp0"
set "PYTHON_PATH=%SERVER_DIR%venv\Scripts\python.exe"

if exist "%PYTHON_PATH%" (
  "%PYTHON_PATH%" "%SERVER_DIR%seed_admin.py"
) else (
  python "%SERVER_DIR%seed_admin.py"
)

@echo off
setlocal

set "ROOT_DIR=%~dp0"
set "SERVER_DIR=%ROOT_DIR%server"
set "CLIENT_DIR=%ROOT_DIR%client"

if not exist "%SERVER_DIR%\.env" (
  echo Missing server\.env.
  echo Create server\.env with your MongoDB Atlas settings before starting the app.
  pause
  exit /b 1
)

start "BragRight Flask API" /D "%SERVER_DIR%" cmd /k "start.bat"
start "BragRight React Client" /D "%CLIENT_DIR%" cmd /k "npm.cmd run dev"

echo Started BragRight backend and frontend in separate terminal windows.
echo Backend:  http://localhost:5000/api
echo Frontend: http://localhost:5173

@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Install Node.js LTS from https://nodejs.org then run this file again.
  pause
  exit /b 1
)
call npm ci --no-audit --no-fund
if errorlevel 1 goto failed
call npm run dist:win
if errorlevel 1 goto failed
echo.
echo Build complete. Installer is in the dist folder.
explorer "%~dp0dist"
pause
exit /b 0
:failed
echo Build failed. See the error above.
pause
exit /b 1

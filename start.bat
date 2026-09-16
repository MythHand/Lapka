@echo off
rem Lapka on Windows: double-click. Checks Node, installs what is missing
rem the first time, starts the server and opens it in the browser. Closing
rem this window stops Lapka.
setlocal
cd /d "%~dp0"
if "%PORT%"=="" set PORT=8800
set URL=http://127.0.0.1:%PORT%

where node >nul 2>nul || (echo Node.js is not installed. Get the LTS build at https://nodejs.org/ and run this again. & pause & exit /b 1)
for /f %%v in ('node -p "process.versions.node.split('.')[0]"') do set MAJOR=%%v
if %MAJOR% LSS 22 (echo Node.js is too old: Lapka needs 22 or newer. Get the LTS build at https://nodejs.org/. & pause & exit /b 1)

if not exist node_modules (
  echo Installing what Lapka needs, once...
  call npm install --no-audit --no-fund || (echo npm install failed; see above. & pause & exit /b 1)
)

where ffmpeg >nul 2>nul || echo ffmpeg is not installed: watching works, saving episodes to a file will not. See docs\INSTALL.md.

echo Starting Lapka at %URL% ... (close this window to stop)
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start "" %URL%"
node core\main.mjs
pause

@echo off
rem Updates Lapka to the newest version: double-click. A folder that came by git
rem is pulled; a folder that came as a ZIP is told where the new ZIP is.
setlocal
cd /d "%~dp0"
if "%PORT%"=="" set PORT=8800
set URL=http://127.0.0.1:%PORT%
set ZIP=https://github.com/MythHand/Lapka/archive/refs/heads/main.zip

if not exist .git (
  echo This folder was downloaded as a ZIP, so it cannot pull the update itself.
  echo Get the new ZIP at %ZIP%, unpack it over this folder (replace the files), then start Lapka as usual.
  echo Settings and the chosen Lapka folder are not inside and stay as they are.
  pause & exit /b 0
)
where git >nul 2>nul || (echo git is not installed, so this folder cannot pull the update. Get the new ZIP at %ZIP% and unpack it over this folder. & pause & exit /b 1)

set was_running=0
curl -fs %URL%/api/ping >nul 2>nul && set was_running=1

echo Pulling the newest Lapka...
git pull --ff-only || (echo git pull did not go through; see above. If you changed files in this folder, put them back or ask for help. & pause & exit /b 1)

echo Installing what Lapka needs...
call npm install --no-audit --no-fund || (echo npm install failed; see above. & pause & exit /b 1)

if %was_running%==1 (
  echo Lapka was running: starting the new one...
  curl -fs -X POST -H "x-lapka: 1" %URL%/api/quit >nul 2>nul
  timeout /t 2 /nobreak >nul
  call start.bat
) else (
  echo Done. Start Lapka as usual: start.bat or npm start.
  pause
)

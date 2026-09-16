@echo off
rem Lapka on Windows: double-click. Checks Node, installs what is missing
rem the first time, starts Lapka in the background and opens it in the
rem browser. This window can be closed afterwards; stop.bat stops Lapka.
setlocal
cd /d "%~dp0"
if "%PORT%"=="" set PORT=8800
set URL=http://127.0.0.1:%PORT%
if not exist .dev mkdir .dev

curl -fs %URL%/api/ping >nul 2>nul && (echo Lapka is already running at %URL% & start "" %URL% & exit /b 0)

where node >nul 2>nul || (echo Node.js is not installed. Get the LTS build at https://nodejs.org/ and run this again. & pause & exit /b 1)
for /f %%v in ('node -p "process.versions.node.split('.')[0]"') do set MAJOR=%%v
if %MAJOR% LSS 22 (echo Node.js is too old: Lapka needs 22 or newer. Get the LTS build at https://nodejs.org/. & pause & exit /b 1)

if not exist node_modules (
  echo Installing what Lapka needs, once...
  call npm install --no-audit --no-fund || (echo npm install failed; see above. & pause & exit /b 1)
)

where ffmpeg >nul 2>nul || echo ffmpeg is not installed: watching works, saving episodes to a file will not. See docs\INSTALL.md.

echo Starting Lapka at %URL% ...
powershell -NoProfile -Command "$p = Start-Process -FilePath 'node' -ArgumentList 'core\main.mjs' -WindowStyle Hidden -PassThru -RedirectStandardOutput '.dev\lapka.log' -RedirectStandardError '.dev\lapka.err.log'; $p.Id | Out-File -Encoding ascii '.dev\lapka.pid'"

set /a tries=0
:wait
curl -fs %URL%/api/ping >nul 2>nul && goto up
set /a tries+=1
if %tries% GEQ 60 (type .dev\lapka.log & type .dev\lapka.err.log & echo Lapka did not answer at %URL% in time; see above. If the port is taken, set PORT=8801 and run again. & pause & exit /b 1)
timeout /t 1 /nobreak >nul
goto wait

:up
start "" %URL%
echo Lapka is running in the background at %URL%. This window can be closed.
echo To stop it: stop.bat, or the Quit button in the settings.
timeout /t 5

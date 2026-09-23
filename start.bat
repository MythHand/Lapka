@echo off
rem Lapka on Windows: double-click. Checks Node, installs what is missing
rem the first time, starts Lapka in a window of its own, minimised, and
rem opens it in the browser. This window can be closed afterwards; the
rem minimised Lapka window stays in the taskbar: closing it, or stop.bat,
rem or the Quit button in the settings stops Lapka.
rem
rem Plainly, no PowerShell and no hidden process: a batch file that spawns
rem a hidden network process through PowerShell is what behaviour-based
rem antivirus looks for, and Kaspersky flagged the earlier launcher so.
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
set LAPKA_NO_OPEN=1
start "Lapka" /min node core\main.mjs

set /a tries=0
:wait
curl -fs %URL%/api/ping >nul 2>nul && goto up
set /a tries+=1
if %tries% GEQ 60 (echo Lapka did not answer at %URL% in time; see the Lapka window. If the port is taken, set PORT=8801 and run again. & pause & exit /b 1)
timeout /t 1 /nobreak >nul
goto wait

:up
start "" %URL%
echo Lapka is running at %URL% in a minimised window of its own. This window can be closed.
echo To stop it: close the Lapka window, or stop.bat, or the Quit button in the settings.
timeout /t 5

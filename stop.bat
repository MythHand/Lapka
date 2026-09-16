@echo off
rem Stops the Lapka started by start.bat.
setlocal
cd /d "%~dp0"
if "%PORT%"=="" set PORT=8800
set URL=http://127.0.0.1:%PORT%
set stopped=0
if exist .dev\lapka.pid (
  set /p PID=<.dev\lapka.pid
  taskkill /pid %PID% /f >nul 2>nul && set stopped=1
  del .dev\lapka.pid
)
if %stopped%==0 (curl -fs -X POST -H "x-lapka: 1" %URL%/api/quit >nul 2>nul && set stopped=1)
if %stopped%==1 (echo Lapka stopped.) else (echo Lapka was not running.)
timeout /t 3

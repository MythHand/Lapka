@echo off
rem A double click starts the local server and opens the player in the browser.
rem The page is opened on the same port the server takes: PORT, 8777 if unset.
cd /d "%~dp0"
if "%PORT%"=="" set PORT=8777
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start "" http://127.0.0.1:%PORT%"
node server.mjs %*

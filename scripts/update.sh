#!/bin/bash
# The shared body of update.command and update.sh: brings this folder to the
# newest Lapka. A folder that came by git is pulled; a folder that came as a
# ZIP is told where the new ZIP is. Whatever Lapka needs is installed, and a
# Lapka that was running is started again. Settings and the chosen folder stay.
PORT="${PORT:-8800}"
URL="http://127.0.0.1:$PORT"
ZIP="https://github.com/MythHand/Lapka/archive/refs/heads/main.zip"

say() { printf '\n%s\n' "$*"; }
halt() { say "$*"; printf '\nPress Enter to close.'; read -r _; exit 1; }

if [ ! -d .git ]; then
  say "This folder was downloaded as a ZIP, so it cannot pull the update itself."
  say "Get the new ZIP at $ZIP, unpack it over this folder (replace the files), then start Lapka as usual."
  say "Settings and the chosen Lapka folder are not inside and stay as they are."
  printf '\nPress Enter to close.'; read -r _; exit 0
fi
command -v git >/dev/null 2>&1 || halt "git is not installed, so this folder cannot pull the update. Get the new ZIP at $ZIP and unpack it over this folder."

was_running=0
if curl -fs "$URL/api/ping" >/dev/null 2>&1; then was_running=1; fi

say "Pulling the newest Lapka…"
before="$(git rev-parse HEAD)"
git pull --ff-only || halt "git pull did not go through; see above. If you changed files in this folder, put them back or ask for help."
after="$(git rev-parse HEAD)"
if [ "$before" = "$after" ]; then say "Already the newest."; else say "Updated: $(git log --oneline "$before".."$after" | wc -l | tr -d ' ') change(s)."; fi

if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  say "Installing what Lapka needs…"
  npm install --no-audit --no-fund || halt "npm install failed; see above."
fi

if [ "$was_running" = 1 ]; then
  say "Lapka was running: starting the new one…"
  curl -fs -X POST -H 'x-lapka: 1' "$URL/api/quit" >/dev/null 2>&1
  for _ in $(seq 1 20); do curl -fs "$URL/api/ping" >/dev/null 2>&1 || break; sleep 0.5; done
  . ./scripts/start.sh
else
  say "Done. Start Lapka as usual: start.command, start.bat or npm start."
fi

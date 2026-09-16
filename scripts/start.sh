#!/bin/bash
# The shared body of start.command and start.sh: run from the project folder.
# Lapka is started in the background, apart from this window: the window can
# be closed, Lapka keeps running. It stops with stop.command / stop.sh, with
# the "Quit Lapka" button in the settings, or with a restart of the machine.
PORT="${PORT:-8800}"
URL="http://127.0.0.1:$PORT"
mkdir -p .dev
PIDFILE=".dev/lapka.pid"
LOG=".dev/lapka.log"

say() { printf '\n%s\n' "$*"; }
halt() { say "$*"; printf '\nPress Enter to close.'; read -r _; exit 1; }
open_url() { if command -v open >/dev/null 2>&1; then open "$1"; elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$1" >/dev/null 2>&1; fi; }

if curl -fs "$URL/api/ping" >/dev/null 2>&1; then
  say "Lapka is already running at $URL"
  open_url "$URL"
  exit 0
fi

command -v node >/dev/null 2>&1 || halt "Node.js is not installed. Get the LTS build at https://nodejs.org/ and run this again."
MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$MAJOR" -ge 22 ] 2>/dev/null || halt "Node.js $(node -v) is too old: Lapka needs 22 or newer. Get the LTS build at https://nodejs.org/."

if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  say "Installing what Lapka needs (once)…"
  npm install --no-audit --no-fund || halt "npm install failed; see above."
fi

command -v ffmpeg >/dev/null 2>&1 || say "ffmpeg is not installed: watching works, saving episodes to a file will not. See docs/INSTALL.md."

say "Starting Lapka at $URL …"
PORT="$PORT" nohup node core/main.mjs >"$LOG" 2>&1 &
echo $! >"$PIDFILE"
disown 2>/dev/null

for _ in $(seq 1 60); do
  if curl -fs "$URL/api/ping" >/dev/null 2>&1; then
    open_url "$URL"
    say "Lapka is running in the background at $URL. This window can be closed."
    say "To stop it: stop.command (macOS), ./stop.sh (Linux), or the Quit button in the settings."
    exit 0
  fi
  kill -0 "$(cat "$PIDFILE")" 2>/dev/null || { cat "$LOG"; halt "Lapka did not start; see above. If the port is taken, run: PORT=8801 ./start.sh"; }
  sleep 0.5
done
cat "$LOG"; halt "Lapka did not answer at $URL in time; see above."

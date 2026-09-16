#!/bin/bash
# The shared body of start.command and start.sh: run from the project folder.
PORT="${PORT:-8800}"
URL="http://127.0.0.1:$PORT"

say() { printf '\n%s\n' "$*"; }
halt() { say "$*"; printf '\nPress Enter to close.'; read -r _; exit 1; }

command -v node >/dev/null 2>&1 || halt "Node.js is not installed. Get the LTS build at https://nodejs.org/ and run this again."
MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$MAJOR" -ge 22 ] 2>/dev/null || halt "Node.js $(node -v) is too old: Lapka needs 22 or newer. Get the LTS build at https://nodejs.org/."

if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  say "Installing what Lapka needs (once)…"
  npm install --no-audit --no-fund || halt "npm install failed; see above."
fi

command -v ffmpeg >/dev/null 2>&1 || say "ffmpeg is not installed: watching works, saving episodes to a file will not. See docs/INSTALL.md."

say "Starting Lapka at $URL … (Ctrl+C or close this window to stop)"
node core/main.mjs &
SERVER=$!
trap 'kill "$SERVER" 2>/dev/null; exit 0' INT TERM HUP

opened=0
for _ in $(seq 1 60); do
  if curl -fs "$URL/api/ping" >/dev/null 2>&1; then
    if command -v open >/dev/null 2>&1; then open "$URL"; elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1; fi
    opened=1; break
  fi
  kill -0 "$SERVER" 2>/dev/null || break
  sleep 0.5
done
[ "$opened" = 1 ] || say "Lapka did not answer at $URL. If the port is taken, run: PORT=8801 ./start.sh"
wait "$SERVER"

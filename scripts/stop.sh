#!/bin/bash
# The shared body of stop.command and stop.sh: stops the Lapka started by the launcher.
PORT="${PORT:-8800}"
URL="http://127.0.0.1:$PORT"
PIDFILE=".dev/lapka.pid"
stopped=0
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then kill "$(cat "$PIDFILE")" && stopped=1; fi
rm -f "$PIDFILE"
if [ "$stopped" = 0 ] && curl -fs "$URL/api/ping" >/dev/null 2>&1; then
  curl -fs -X POST -H 'x-lapka: 1' "$URL/api/quit" >/dev/null 2>&1 && stopped=1
fi
if [ "$stopped" = 1 ]; then printf '\nLapka stopped.\n'; else printf '\nLapka was not running.\n'; fi

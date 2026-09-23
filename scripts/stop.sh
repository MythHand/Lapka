#!/bin/bash
# The shared body of stop.command and stop.sh: Lapka is asked to quit
# through its own route, the way the Quit button in the settings does.
PORT="${PORT:-8800}"
URL="http://127.0.0.1:$PORT"
if curl -fs "$URL/api/ping" >/dev/null 2>&1 && curl -fs -X POST -H 'x-lapka: 1' "$URL/api/quit" >/dev/null 2>&1; then
  printf '\nLapka stopped.\n'
else
  printf '\nLapka was not running.\n'
fi

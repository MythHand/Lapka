#!/bin/sh
# Starts the local server and opens the player in the browser (Linux).
# The page is opened on the same port the server takes: PORT, 8777 if unset.
cd "$(dirname "$0")" || exit 1
PORT="${PORT:-8777}"; export PORT
( sleep 1.2; xdg-open "http://127.0.0.1:$PORT" >/dev/null 2>&1 ) &
exec node server.mjs "$@"

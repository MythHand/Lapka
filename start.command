#!/bin/sh
# A double click starts the local server and opens the player in the browser.
# The page is opened on the same port the server takes: PORT, 8777 if unset.
cd "$(dirname "$0")" || exit 1
PORT="${PORT:-8777}"; export PORT
( sleep 1.2; open "http://127.0.0.1:$PORT" ) &
exec node server.mjs "$@"

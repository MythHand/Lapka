#!/bin/bash
# Lapka on macOS: double-click. Checks Node, installs what is missing the
# first time, starts the server and opens it in the browser. Closing this
# window, or Ctrl+C, stops Lapka.
cd "$(dirname "$0")" || exit 1
. ./scripts/start.sh

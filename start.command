#!/bin/bash
# Lapka on macOS: double-click. Checks Node, installs what is missing the
# first time, starts Lapka in the background and opens it in the browser.
# This window can be closed afterwards; stop.command stops Lapka.
cd "$(dirname "$0")" || exit 1
. ./scripts/start.sh

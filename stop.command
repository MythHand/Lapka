#!/bin/bash
# Stops the Lapka started by start.command.
cd "$(dirname "$0")" || exit 1
. ./scripts/stop.sh

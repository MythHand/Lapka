#!/bin/bash
# Stops the Lapka started by start.sh: ./stop.sh
cd "$(dirname "$0")" || exit 1
. ./scripts/stop.sh

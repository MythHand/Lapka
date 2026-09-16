#!/bin/bash
# Updates Lapka to the newest version: double-click. A running Lapka is started again.
cd "$(dirname "$0")" || exit 1
. ./scripts/update.sh

#!/usr/bin/env bash
# Get DROYD trading positions
# Usage: droyd-positions.sh [leg_status]
# Status: active (default), all

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/droyd.sh"

STATUS="${1:-active}"

droyd_request "GET" "/api/v1/trade/positions?leg_status=$STATUS"
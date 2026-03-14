#!/usr/bin/env bash
# Get DROYD watchlist
# Usage: droyd-watchlist.sh [scope] [limit] [attributes]
# Scope: agent (default), swarm, combined
# Example: droyd-watchlist.sh "combined" 25 "market_data,technical_analysis,mindshare"

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/droyd.sh"

SCOPE="${1:-agent}"
LIMIT="${2:-20}"
ATTRIBUTES="${3:-developments,mindshare,market_data}"

# Convert comma-separated to JSON array
to_json_array() {
  echo "$1" | tr ',' '\n' | jq -R . | jq -s .
}

DATA=$(jq -n \
  --arg scope "$SCOPE" \
  --argjson limit "$LIMIT" \
  --argjson attrs "$(to_json_array "$ATTRIBUTES")" \
  '{scope: $scope, limit: $limit, include_attributes: $attrs}')

droyd_request "POST" "/api/v1/projects/watchlist" "$DATA"

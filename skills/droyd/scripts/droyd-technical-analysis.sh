#!/usr/bin/env bash
# Get technical analysis timeseries with OHLCV + indicators
# Usage: droyd-technical-analysis.sh <project_ids> [timeframes] [include_ta]
# project_ids: comma-separated project IDs (1-5)
# timeframes: comma-separated timeframes (default "4H") — valid: 5m, 15m, 4H, 1D
# include_ta: true/false (default true)
# Example: droyd-technical-analysis.sh "123"
# Example: droyd-technical-analysis.sh "123,456" "4H,1D" true

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/droyd.sh"

PROJECT_IDS="${1:-}"
TIMEFRAMES="${2:-4H}"
INCLUDE_TA="${3:-true}"

if [[ -z "$PROJECT_IDS" ]]; then
  echo "Usage: droyd-technical-analysis.sh <project_ids> [timeframes] [include_ta]" >&2
  echo "project_ids: comma-separated project IDs (1-5, e.g. \"123,456\")" >&2
  echo "timeframes: 5m, 15m, 4H, 1D (default: 4H)" >&2
  exit 1
fi

# Convert comma-separated IDs to JSON number array
ids_to_json_array() {
  echo "$1" | tr ',' '\n' | jq -R 'tonumber' | jq -s .
}

# Convert comma-separated strings to JSON string array
to_json_array() {
  echo "$1" | tr ',' '\n' | jq -R . | jq -s .
}

DATA=$(jq -n \
  --argjson project_ids "$(ids_to_json_array "$PROJECT_IDS")" \
  --argjson timeframes "$(to_json_array "$TIMEFRAMES")" \
  --argjson include_ta "$INCLUDE_TA" \
  '{
    project_ids: $project_ids,
    timeframes: $timeframes,
    include_ta: $include_ta
  }')

droyd_request "POST" "/api/v1/projects/technical-analysis" "$DATA"

#!/usr/bin/env bash
# Analyze virality and mention velocity
# Usage: droyd-virality.sh <search_type> <queries> [lookback_days] [bucket_interval] [viral_threshold] [include_timeseries]
# search_type: "terms" or "project_id"
# Example: droyd-virality.sh "terms" "BTC,ETH,SOL"
# Example: droyd-virality.sh "project_id" "6193,34570" 30 "8 hours" 2.0 true

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/droyd.sh"

SEARCH_TYPE="${1:-}"
QUERIES="${2:-}"
LOOKBACK="${3:-30}"
BUCKET="${4:-8 hours}"
THRESHOLD="${5:-2.0}"
TIMESERIES="${6:-false}"

if [[ -z "$SEARCH_TYPE" || -z "$QUERIES" ]]; then
  echo "Usage: droyd-virality.sh <search_type> <queries> [lookback_days] [bucket_interval] [viral_threshold] [include_timeseries]" >&2
  echo "search_type: terms, project_id" >&2
  exit 1
fi

# Convert comma-separated to JSON array
to_json_array() {
  echo "$1" | tr ',' '\n' | jq -R . | jq -s .
}

DATA=$(jq -n \
  --argjson queries "$(to_json_array "$QUERIES")" \
  --arg type "$SEARCH_TYPE" \
  --argjson lookback "$LOOKBACK" \
  --arg bucket "$BUCKET" \
  --argjson threshold "$THRESHOLD" \
  --argjson ts "$TIMESERIES" \
  '{
    queries: $queries,
    search_type: $type,
    lookback_days: $lookback,
    bucket_interval: $bucket,
    viral_threshold: $threshold,
    include_timeseries: $ts
  }')

droyd_request "POST" "/api/v1/data/virality" "$DATA"

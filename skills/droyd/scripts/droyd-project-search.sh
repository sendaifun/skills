#!/usr/bin/env bash
# Search DROYD projects
# Usage: droyd-project-search.sh <type> <queries> [limit] [attributes] [developments_limit] [recent_content_limit] [recent_content_days_back]
# Types: name, symbol, address, semantic, project_id
# Example: droyd-project-search.sh "name" "Bitcoin,Ethereum" 10
# Example: droyd-project-search.sh "semantic" "AI agents in DeFi" 15 "market_data,technical_analysis,recent_content" 5 15 7

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/droyd.sh"

TYPE="${1:-name}"
QUERIES="${2:-}"
LIMIT="${3:-10}"
ATTRIBUTES="${4:-developments,mindshare,market_data}"
DEV_LIMIT="${5:-}"
CONTENT_LIMIT="${6:-}"
CONTENT_DAYS="${7:-}"

if [[ -z "$QUERIES" ]]; then
  echo "Usage: droyd-project-search.sh <type> <queries> [limit] [attributes] [dev_limit] [content_limit] [content_days]" >&2
  echo "Types: name, symbol, address, semantic, project_id" >&2
  exit 1
fi

# Convert comma-separated to JSON array
to_json_array() {
  echo "$1" | tr ',' '\n' | jq -R . | jq -s .
}

DATA=$(jq -n \
  --arg type "$TYPE" \
  --argjson queries "$(to_json_array "$QUERIES")" \
  --argjson limit "$LIMIT" \
  --argjson attrs "$(to_json_array "$ATTRIBUTES")" \
  '{search_type: $type, queries: $queries, limit: $limit, include_attributes: $attrs}')

# Add optional limits
[[ -n "$DEV_LIMIT" ]] && DATA=$(echo "$DATA" | jq --argjson v "$DEV_LIMIT" '. + {developments_limit: $v}')
[[ -n "$CONTENT_LIMIT" ]] && DATA=$(echo "$DATA" | jq --argjson v "$CONTENT_LIMIT" '. + {recent_content_limit: $v}')
[[ -n "$CONTENT_DAYS" ]] && DATA=$(echo "$DATA" | jq --argjson v "$CONTENT_DAYS" '. + {recent_content_days_back: $v}')

droyd_request "POST" "/api/v1/projects/search" "$DATA"

#!/usr/bin/env bash
# Search DROYD content
# Usage: droyd-search.sh <mode> <types> [limit] [ecosystems] [categories] [days_back] [query] [project_ids] [include_analysis] [image_limit] [snippet_limit]
# Example (recent): droyd-search.sh "recent" "posts,news" 25 "ethereum,base" "defi" 7
# Example (semantic): droyd-search.sh "semantic" "posts,tweets" 50 "" "" 7 "What are AI agents?"
# Example (auto): droyd-search.sh "auto" "posts,news" 25 "" "" 7 "What happened in crypto?"

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/droyd.sh"

MODE="${1:-auto}"
TYPES="${2:-posts,news}"
LIMIT="${3:-25}"
ECOSYSTEMS="${4:-}"
CATEGORIES="${5:-}"
DAYS_BACK="${6:-7}"
QUERY="${7:-}"
PROJECT_IDS="${8:-}"
INCLUDE_ANALYSIS="${9:-}"
IMAGE_LIMIT="${10:-}"
SNIPPET_LIMIT="${11:-}"

# Convert comma-separated to JSON array
to_json_array() {
  echo "$1" | tr ',' '\n' | jq -R . | jq -s .
}

# Convert comma-separated numbers to JSON array
to_json_num_array() {
  echo "$1" | tr ',' '\n' | jq -R 'tonumber' | jq -s .
}

# Build base request
if [[ "$MODE" == "semantic" ]]; then
  if [[ -z "$QUERY" ]]; then
    echo "Error: Query required for semantic search" >&2
    exit 1
  fi

  DATA=$(jq -n \
    --arg mode "$MODE" \
    --argjson types "$(to_json_array "$TYPES")" \
    --argjson limit "$LIMIT" \
    --argjson days "$DAYS_BACK" \
    --arg query "$QUERY" \
    '{search_mode: $mode, content_types: $types, limit: $limit, days_back: $days, query: $query, include_analysis: true}')
elif [[ "$MODE" == "auto" && -n "$QUERY" ]]; then
  DATA=$(jq -n \
    --arg mode "$MODE" \
    --argjson types "$(to_json_array "$TYPES")" \
    --argjson limit "$LIMIT" \
    --argjson days "$DAYS_BACK" \
    --arg query "$QUERY" \
    '{search_mode: $mode, content_types: $types, limit: $limit, days_back: $days, query: $query, include_analysis: true}')
else
  DATA=$(jq -n \
    --arg mode "$MODE" \
    --argjson types "$(to_json_array "$TYPES")" \
    --argjson limit "$LIMIT" \
    --argjson days "$DAYS_BACK" \
    '{search_mode: $mode, content_types: $types, limit: $limit, days_back: $days}')
fi

# Add optional filters
[[ -n "$ECOSYSTEMS" ]] && DATA=$(echo "$DATA" | jq --argjson eco "$(to_json_array "$ECOSYSTEMS")" '. + {ecosystems: $eco}')
[[ -n "$CATEGORIES" ]] && DATA=$(echo "$DATA" | jq --argjson cat "$(to_json_array "$CATEGORIES")" '. + {categories: $cat}')
[[ -n "$PROJECT_IDS" ]] && DATA=$(echo "$DATA" | jq --argjson ids "$(to_json_num_array "$PROJECT_IDS")" '. + {project_ids: $ids}')
[[ -n "$INCLUDE_ANALYSIS" ]] && DATA=$(echo "$DATA" | jq --argjson v "$INCLUDE_ANALYSIS" '. + {include_analysis: $v}')
[[ -n "$IMAGE_LIMIT" ]] && DATA=$(echo "$DATA" | jq --argjson v "$IMAGE_LIMIT" '. + {image_limit: $v}')
[[ -n "$SNIPPET_LIMIT" ]] && DATA=$(echo "$DATA" | jq --argjson v "$SNIPPET_LIMIT" '. + {snippet_limit: $v}')

droyd_request "POST" "/api/v1/search" "$DATA"

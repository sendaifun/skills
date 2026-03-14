#!/usr/bin/env bash
# Search DROYD agent files
# Usage: droyd-files-search.sh [query] [scopes] [limit] [sort_by] [file_extensions] [offset]
# Example: droyd-files-search.sh "price prediction" "agent,droyd" 25 "trending" "py,txt"

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/droyd.sh"

QUERY="${1:-}"
SCOPES="${2:-}"
LIMIT="${3:-50}"
SORT_BY="${4:-}"
FILE_EXTENSIONS="${5:-}"
OFFSET="${6:-}"

# Convert comma-separated to JSON array
to_json_array() {
  echo "$1" | tr ',' '\n' | jq -R . | jq -s .
}

# Build request
DATA=$(jq -n --argjson limit "$LIMIT" '{limit: $limit}')

[[ -n "$QUERY" ]] && DATA=$(echo "$DATA" | jq --arg v "$QUERY" '. + {query: $v}')
[[ -n "$SCOPES" ]] && DATA=$(echo "$DATA" | jq --argjson v "$(to_json_array "$SCOPES")" '. + {scopes: $v}')
[[ -n "$SORT_BY" ]] && DATA=$(echo "$DATA" | jq --arg v "$SORT_BY" '. + {sort_by: $v}')
[[ -n "$FILE_EXTENSIONS" ]] && DATA=$(echo "$DATA" | jq --argjson v "$(to_json_array "$FILE_EXTENSIONS")" '. + {file_extensions: $v}')
[[ -n "$OFFSET" ]] && DATA=$(echo "$DATA" | jq --argjson v "$OFFSET" '. + {offset: $v}')

droyd_request "POST" "/api/v1/files/search" "$DATA"

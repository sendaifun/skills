#!/usr/bin/env bash
# Search DROYD agent skills
# Usage: droyd-skills-search.sh [query] [scopes] [limit] [sort_by] [skill_type] [offset]
# Example: droyd-skills-search.sh "trading bot" "droyd,swarm" 20 "popular" "tool"

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/droyd.sh"

QUERY="${1:-}"
SCOPES="${2:-}"
LIMIT="${3:-50}"
SORT_BY="${4:-}"
SKILL_TYPE="${5:-}"
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
[[ -n "$SKILL_TYPE" ]] && DATA=$(echo "$DATA" | jq --arg v "$SKILL_TYPE" '. + {skill_type: $v}')
[[ -n "$OFFSET" ]] && DATA=$(echo "$DATA" | jq --argjson v "$OFFSET" '. + {offset: $v}')

droyd_request "POST" "/api/v1/skills/search" "$DATA"

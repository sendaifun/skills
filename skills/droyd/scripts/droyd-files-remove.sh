#!/usr/bin/env bash
# Delete file or folder from DROYD agent storage
# Usage: droyd-files-remove.sh <agent_id> <path>
# Example: droyd-files-remove.sh 123 "/home/droyd/agent/data/report.txt"

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/droyd.sh"

AGENT_ID="${1:-}"
FILE_PATH="${2:-}"

if [[ -z "$AGENT_ID" || -z "$FILE_PATH" ]]; then
  echo "Usage: droyd-files-remove.sh <agent_id> <path>" >&2
  exit 1
fi

DATA=$(jq -n \
  --argjson agent_id "$AGENT_ID" \
  --arg path "$FILE_PATH" \
  '{agent_id: $agent_id, path: $path}')

droyd_request "POST" "/api/v1/files/remove" "$DATA"

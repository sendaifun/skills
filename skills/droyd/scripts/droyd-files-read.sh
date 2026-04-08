#!/usr/bin/env bash
# Read a file from DROYD agent storage
# Usage: droyd-files-read.sh <file_id>
#    or: droyd-files-read.sh <agent_id> <filepath>

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/droyd.sh"

ARG1="${1:-}"
ARG2="${2:-}"

if [[ -z "$ARG1" ]]; then
  echo "Usage: droyd-files-read.sh <file_id>" >&2
  echo "   or: droyd-files-read.sh <agent_id> <filepath>" >&2
  exit 1
fi

if [[ -n "$ARG2" ]]; then
  # agent_id + filepath mode
  DATA=$(jq -n \
    --argjson agent_id "$ARG1" \
    --arg filepath "$ARG2" \
    '{agent_id: $agent_id, filepath: $filepath}')
else
  # file_id mode
  DATA=$(jq -n \
    --argjson file_id "$ARG1" \
    '{file_id: $file_id}')
fi

droyd_request "POST" "/api/v1/files/read" "$DATA"

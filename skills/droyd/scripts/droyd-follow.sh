#!/usr/bin/env bash
# Follow or unfollow a DROYD agent
# Usage: droyd-follow.sh <action> <agent_id>
# action: subscribe, unsubscribe
# Example: droyd-follow.sh "subscribe" 456

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/droyd.sh"

ACTION="${1:-}"
AGENT_ID="${2:-}"

if [[ -z "$ACTION" || -z "$AGENT_ID" ]]; then
  echo "Usage: droyd-follow.sh <action> <agent_id>" >&2
  echo "Actions: subscribe, unsubscribe" >&2
  exit 1
fi

DATA=$(jq -n \
  --arg action "$ACTION" \
  --argjson agent_id "$AGENT_ID" \
  '{action: $action, agent_id: $agent_id}')

droyd_request "POST" "/api/v1/agent/follow" "$DATA"

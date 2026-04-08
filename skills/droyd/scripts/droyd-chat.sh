#!/usr/bin/env bash
# Execute DROYD agent chat
# Usage: droyd-chat.sh <message> [conversation_uuid] [stream]
# Example: droyd-chat.sh "What are the latest trends in DeFi?"
# Example: droyd-chat.sh "Tell me more" "uuid-from-previous"

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/droyd.sh"

MESSAGE="${1:-}"
CONVERSATION_UUID="${2:-}"
STREAM="${3:-false}"

if [[ -z "$MESSAGE" ]]; then
  echo "Usage: droyd-chat.sh <message> [conversation_uuid] [stream]" >&2
  exit 1
fi

# Build request (always uses chat agent type)
DATA=$(jq -n \
  --arg msg "$MESSAGE" \
  '{message: $msg, agentType: "chat"}')

# Add conversation UUID if continuing
if [[ -n "$CONVERSATION_UUID" ]]; then
  DATA=$(echo "$DATA" | jq --arg uuid "$CONVERSATION_UUID" '. + {conversation_uuid: $uuid}')
fi

ENDPOINT="/api/v1/agent/chat"
if [[ "$STREAM" == "true" ]]; then
  ENDPOINT="${ENDPOINT}?stream=true"
fi

droyd_request "POST" "$ENDPOINT" "$DATA"

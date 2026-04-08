#!/usr/bin/env bash
# Create a new DROYD agent with wallet and API key
# Usage: droyd-agent-create.sh <email> [agent_name] [profile_image] [agent_bio]
# The returned API key is automatically saved to .config

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
CONFIG_FILE="$SKILL_DIR/.config"
API_URL="https://api.droyd.ai"

# If config exists, use its API URL
if [[ -f "$CONFIG_FILE" ]]; then
  API_URL=$(jq -r '.apiUrl // "https://api.droyd.ai"' "$CONFIG_FILE")
  EXISTING_KEY=$(jq -r '.apiKey // empty' "$CONFIG_FILE")
fi

EMAIL="${1:-}"
AGENT_NAME="${2:-}"
PROFILE_IMAGE="${3:-}"
AGENT_BIO="${4:-}"

if [[ -z "$EMAIL" ]]; then
  echo "Usage: droyd-agent-create.sh <email> [agent_name] [profile_image] [agent_bio]" >&2
  exit 1
fi

# Build request JSON
DATA=$(jq -n --arg email "$EMAIL" '{email: $email}')
[[ -n "$AGENT_NAME" ]] && DATA=$(echo "$DATA" | jq --arg v "$AGENT_NAME" '. + {agent_name: $v}')
[[ -n "$PROFILE_IMAGE" ]] && DATA=$(echo "$DATA" | jq --arg v "$PROFILE_IMAGE" '. + {profile_image: $v}')
[[ -n "$AGENT_BIO" ]] && DATA=$(echo "$DATA" | jq --arg v "$AGENT_BIO" '. + {agent_bio: $v}')

# Use existing key if available, otherwise send without (x402 will be required)
AUTH_HEADER=""
if [[ -n "${EXISTING_KEY:-}" ]]; then
  AUTH_HEADER="-H x-droyd-api-key: $EXISTING_KEY"
fi

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${API_URL}/api/v1/agent/create" \
  ${AUTH_HEADER:+-H "x-droyd-api-key: $EXISTING_KEY"} \
  -H "Content-Type: application/json" \
  -d "$DATA")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "201" ]]; then
  # Extract the new API key and save to config
  NEW_KEY=$(echo "$BODY" | jq -r '.data.user.api_key // empty')
  if [[ -n "$NEW_KEY" ]]; then
    cat > "$CONFIG_FILE" << EOF
{
  "apiKey": "$NEW_KEY",
  "apiUrl": "$API_URL"
}
EOF
    echo "Config saved with new API key to $CONFIG_FILE" >&2
  fi
  echo "$BODY"
else
  echo "Error: HTTP $HTTP_CODE" >&2
  echo "$BODY" >&2
  exit 1
fi

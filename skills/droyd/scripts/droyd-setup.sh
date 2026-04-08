#!/usr/bin/env bash
# Configure DROYD API credentials
# Usage: droyd-setup.sh [api_key]
#    or: droyd-setup.sh --create <email> [agent_name] [agent_bio]
# If no key provided, prompts interactively

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
CONFIG_FILE="$SKILL_DIR/.config"
API_URL="https://api.droyd.ai"

# Handle --create flag: create new account and auto-configure
if [[ "${1:-}" == "--create" ]]; then
  EMAIL="${2:-}"
  AGENT_NAME="${3:-}"
  AGENT_BIO="${4:-}"

  if [[ -z "$EMAIL" ]]; then
    echo "Usage: droyd-setup.sh --create <email> [agent_name] [agent_bio]" >&2
    exit 1
  fi

  echo "Creating new DROYD agent for $EMAIL..."

  DATA=$(jq -n --arg email "$EMAIL" '{email: $email}')
  [[ -n "$AGENT_NAME" ]] && DATA=$(echo "$DATA" | jq --arg v "$AGENT_NAME" '. + {agent_name: $v}')
  [[ -n "$AGENT_BIO" ]] && DATA=$(echo "$DATA" | jq --arg v "$AGENT_BIO" '. + {agent_bio: $v}')

  RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${API_URL}/api/v1/agent/create" \
    -H "Content-Type: application/json" \
    -d "$DATA")

  HTTP_CODE=$(echo "$RESPONSE" | tail -1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "201" ]]; then
    API_KEY=$(echo "$BODY" | jq -r '.data.user.api_key // empty')
    if [[ -z "$API_KEY" ]]; then
      echo "Error: No API key returned in response" >&2
      echo "$BODY" >&2
      exit 1
    fi

    cat > "$CONFIG_FILE" << EOF
{
  "apiKey": "$API_KEY",
  "apiUrl": "$API_URL"
}
EOF
    echo "Agent created successfully!"
    echo "Config saved to $CONFIG_FILE"
    echo "$BODY" | jq '{agent_id: .data.agent.agent_id, wallet: .data.agent.wallet_address, email: .data.user.email}'
    exit 0
  else
    echo "Error: HTTP $HTTP_CODE" >&2
    echo "$BODY" >&2
    exit 1
  fi
fi

API_KEY="${1:-}"

if [[ -z "$API_KEY" ]]; then
  echo "DROYD API Setup"
  echo "==============="
  echo ""
  echo "Get your API key at https://droyd.ai (Account Settings)"
  echo "Or create a new account: droyd-setup.sh --create <email>"
  echo ""
  read -rp "Enter your DROYD API key: " API_KEY

  if [[ -z "$API_KEY" ]]; then
    echo "Error: API key cannot be empty" >&2
    exit 1
  fi
fi

# Write config
cat > "$CONFIG_FILE" << EOF
{
  "apiKey": "$API_KEY",
  "apiUrl": "$API_URL"
}
EOF

echo "Config saved to $CONFIG_FILE"

# Validate by hitting a lightweight endpoint
echo "Validating API key..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/api/v1/search" \
  -H "x-droyd-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"search_mode": "recent", "content_types": ["news"], "limit": 1}')

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [[ "$HTTP_CODE" == "200" ]]; then
  SUCCESS=$(echo "$BODY" | jq -r '.success // false')
  if [[ "$SUCCESS" == "true" ]]; then
    echo "API key validated successfully!"
  else
    echo "Warning: API responded but returned unexpected result. Key may still be valid." >&2
  fi
elif [[ "$HTTP_CODE" == "401" ]]; then
  echo "Error: Invalid API key (401 Unauthorized)" >&2
  rm -f "$CONFIG_FILE"
  exit 1
else
  echo "Warning: Could not validate key (HTTP $HTTP_CODE). Config saved anyway." >&2
fi

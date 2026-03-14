#!/usr/bin/env bash
# DROYD API - Configuration and common functions
# Usage: source this file from other scripts

set -euo pipefail

# Resolve skill root directory
DROYD_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DROYD_SKILL_DIR="$(dirname "$DROYD_SCRIPT_DIR")"

# Load config: env override > skill-local .config
CONFIG_FILE="${DROYD_CONFIG:-$DROYD_SKILL_DIR/.config}"

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "Error: Config file not found at $CONFIG_FILE" >&2
  echo "Run: $DROYD_SCRIPT_DIR/droyd-setup.sh" >&2
  exit 1
fi

DROYD_API_KEY=$(jq -r '.apiKey // empty' "$CONFIG_FILE")
DROYD_API_URL=$(jq -r '.apiUrl // "https://api.droyd.ai"' "$CONFIG_FILE")

if [[ -z "$DROYD_API_KEY" ]]; then
  echo "Error: apiKey not found in config" >&2
  exit 1
fi

# API request function
droyd_request() {
  local method="$1"
  local endpoint="$2"
  local data="${3:-}"

  local url="${DROYD_API_URL}${endpoint}"

  if [[ "$method" == "GET" ]]; then
    curl -s -X GET "$url" \
      -H "x-droyd-api-key: $DROYD_API_KEY" \
      -H "Content-Type: application/json"
  else
    curl -s -X POST "$url" \
      -H "x-droyd-api-key: $DROYD_API_KEY" \
      -H "Content-Type: application/json" \
      -d "$data"
  fi
}

# Export for use in other scripts
export DROYD_API_KEY DROYD_API_URL DROYD_SKILL_DIR
export -f droyd_request

#!/usr/bin/env bash
# Filter DROYD projects
# Accepts JSON matching the /api/v1/projects/filter POST body
# Usage: droyd-filter.sh '<json>'
# Example (natural):  droyd-filter.sh '{"filter_mode":"natural_language","instructions":"Find trending Solana micro-caps"}'
# Example (direct):   droyd-filter.sh '{"filter_mode":"direct","sort_by":"quant_score","max_rsi":30,"min_liquidity":100000}'

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/droyd.sh"

DATA="${1:-}"

if [[ -z "$DATA" ]]; then
  echo "Usage: droyd-filter.sh '<json>'" >&2
  echo '  droyd-filter.sh '\''{"filter_mode":"natural_language","instructions":"Find trending tokens"}'\''' >&2
  echo '  droyd-filter.sh '\''{"filter_mode":"direct","sort_by":"traders_change","max_market_cap":10}'\''' >&2
  exit 1
fi

# Validate JSON
if ! echo "$DATA" | jq empty 2>/dev/null; then
  echo "Error: Invalid JSON" >&2
  exit 1
fi

# Validate required field
MODE=$(echo "$DATA" | jq -r '.filter_mode // empty')
if [[ -z "$MODE" ]]; then
  echo "Error: filter_mode is required (natural_language or direct)" >&2
  exit 1
fi

if [[ "$MODE" == "natural_language" ]]; then
  INSTR=$(echo "$DATA" | jq -r '.instructions // empty')
  if [[ -z "$INSTR" ]]; then
    echo "Error: instructions is required for natural_language mode" >&2
    exit 1
  fi
fi

droyd_request "POST" "/api/v1/projects/filter" "$DATA"

#!/usr/bin/env bash
# Open DROYD trade
# Usage (simple): droyd-trade-open.sh <project_id> "market_buy" <amount>
# Usage (managed): droyd-trade-open.sh <project_id> "managed" <amount> <stop_pct> <tp_pct> [rationale]
# Usage (address): droyd-trade-open.sh "address:<contract>:<chain>" "market_buy" <amount>
# Usage (custom legs): droyd-trade-open.sh <project_id> "custom" '<legs_json>' [rationale]
# Example: droyd-trade-open.sh 123 "managed" 100 0.10 0.25 "Momentum play"
# Example: droyd-trade-open.sh "address:So111...:solana" "market_buy" 50

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/droyd.sh"

IDENTIFIER="${1:-}"
TYPE="${2:-market_buy}"
AMOUNT="${3:-100}"
STOP_PCT="${4:-}"
TP_PCT="${5:-}"
RATIONALE="${6:-}"

if [[ -z "$IDENTIFIER" ]]; then
  echo "Usage: droyd-trade-open.sh <project_id|address:contract:chain> <type> <amount> [stop_%] [tp_%] [rationale]" >&2
  echo "Types: market_buy, managed, custom" >&2
  exit 1
fi

# Determine if using project_id or contract_address
if [[ "$IDENTIFIER" == address:* ]]; then
  IFS=':' read -r _ CONTRACT CHAIN <<< "$IDENTIFIER"
  ID_JSON=$(jq -n --arg addr "$CONTRACT" --arg chain "${CHAIN:-solana}" '{contract_address: $addr, chain: $chain}')
else
  ID_JSON=$(jq -n --argjson pid "$IDENTIFIER" '{project_id: $pid}')
fi

if [[ "$TYPE" == "managed" ]]; then
  if [[ -z "$STOP_PCT" || -z "$TP_PCT" ]]; then
    echo "Error: managed type requires stop_pct and tp_pct" >&2
    exit 1
  fi

  DATA=$(echo "$ID_JSON" | jq \
    --argjson amt "$AMOUNT" \
    --argjson stop "$STOP_PCT" \
    --argjson tp "$TP_PCT" \
    '. + {legs: [
      {type: "market_buy", amountUSD: $amt},
      {type: "stop_loss", amountUSD: $amt, triggerPercent: $stop},
      {type: "take_profit", amountUSD: $amt, triggerPercent: $tp}
    ]}')
elif [[ "$TYPE" == "custom" ]]; then
  # AMOUNT param is actually the legs JSON in custom mode
  LEGS_JSON="$AMOUNT"
  RATIONALE="${4:-}"
  DATA=$(echo "$ID_JSON" | jq --argjson legs "$LEGS_JSON" '. + {legs: $legs}')
else
  DATA=$(echo "$ID_JSON" | jq \
    --argjson amt "$AMOUNT" \
    '. + {legs: [{type: "market_buy", amountUSD: $amt}]}')
fi

# Add rationale if provided
if [[ -n "$RATIONALE" ]]; then
  DATA=$(echo "$DATA" | jq --arg r "$RATIONALE" '. + {rationale: $r}')
fi

droyd_request "POST" "/api/v1/trade/open" "$DATA"

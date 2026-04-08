#!/usr/bin/env bash
# Manage DROYD trade
# Usage: droyd-trade-manage.sh <strategy_id> <action> [param]
# Actions: close, sell (with percent 0-1), buy (with amount USD), update (with legs JSON)
# Example: droyd-trade-manage.sh 789 "close"
# Example: droyd-trade-manage.sh 789 "sell" 0.5
# Example: droyd-trade-manage.sh 789 "buy" 50
# Example: droyd-trade-manage.sh 789 "update" '[{"leg_action":"add","type":"take_profit","amountUSD":50,"triggerPercent":0.30}]'

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/droyd.sh"

STRATEGY_ID="${1:-}"
ACTION="${2:-close}"
PARAM="${3:-}"

if [[ -z "$STRATEGY_ID" ]]; then
  echo "Usage: droyd-trade-manage.sh <strategy_id> <action> [param]" >&2
  echo "Actions: close, sell (pct 0-1), buy (amount USD), update (legs JSON)" >&2
  exit 1
fi

case "$ACTION" in
  close)
    DATA=$(jq -n \
      --argjson sid "$STRATEGY_ID" \
      '{strategy_id: $sid, action: "close"}')
    ;;
  sell)
    if [[ -z "$PARAM" ]]; then
      echo "Error: sell requires percent (0-1)" >&2
      exit 1
    fi
    DATA=$(jq -n \
      --argjson sid "$STRATEGY_ID" \
      --argjson pct "$PARAM" \
      '{strategy_id: $sid, action: "sell", sellPercent: $pct}')
    ;;
  buy)
    if [[ -z "$PARAM" ]]; then
      echo "Error: buy requires amount USD" >&2
      exit 1
    fi
    DATA=$(jq -n \
      --argjson sid "$STRATEGY_ID" \
      --argjson amt "$PARAM" \
      '{strategy_id: $sid, action: "buy", amountUSD: $amt}')
    ;;
  update)
    if [[ -z "$PARAM" ]]; then
      echo "Error: update requires legs JSON array" >&2
      exit 1
    fi
    DATA=$(jq -n \
      --argjson sid "$STRATEGY_ID" \
      --argjson legs "$PARAM" \
      '{strategy_id: $sid, action: "update", legs: $legs}')
    ;;
  *)
    echo "Unknown action: $ACTION" >&2
    exit 1
    ;;
esac

droyd_request "POST" "/api/v1/trade/manage" "$DATA"

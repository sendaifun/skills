# Trading

Execute trades with risk management: market buys, stop losses, take profits, and quant-based strategies.

## Endpoints

- `POST /api/v1/trade/open` - Open new position
- `POST /api/v1/trade/manage` - Manage existing position
- `GET /api/v1/trade/positions` - Get positions and P&L

---

## Open Trade

`POST /api/v1/trade/open`

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `project_id` | number | Conditional | - | Project ID (use this OR contract_address) |
| `contract_address` | string | Conditional | - | Contract address (use this OR project_id) |
| `chain` | string | No | `solana` | Required if using contract_address |
| `legs` | array | Yes | - | Array of trade legs (1-10 items) |
| `rationale` | string | No | - | Optional rationale for the trade |

### Leg Types

| Type | triggerPercent Meaning |
|------|------------------------|
| `market_buy` | Not required (immediate execution) |
| `limit_order` | Price drop % (0.05 = buy at 5% below current) |
| `stop_loss` | Price drop % (0.10 = sell at 10% below entry) |
| `take_profit` | Price rise % (0.20 = sell at 20% above entry) |
| `quant_buy` | Momentum score threshold (15 = buy when score reaches 15) |
| `quant_sell` | Momentum score threshold (-10 = sell when score reaches -10) |

### Leg Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `type` | string | Yes | Leg type (see above) |
| `amountUSD` | number | Yes | Amount in USD (min: 1) |
| `triggerPercent` | number | Conditional | Required for all except market_buy |
| `positionPercent` | number | No | Portion of position (0-1, default: 1) |

### Examples

**Simple Market Buy:**
```bash
curl -X POST https://api.droyd.ai/api/v1/trade/open \
  -H "x-droyd-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": 123,
    "legs": [{"type": "market_buy", "amountUSD": 100}]
  }'
```

**Buy with Stop Loss and Take Profits:**
```bash
curl -X POST https://api.droyd.ai/api/v1/trade/open \
  -H "x-droyd-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": 123,
    "legs": [
      {"type": "market_buy", "amountUSD": 100},
      {"type": "stop_loss", "amountUSD": 100, "triggerPercent": 0.10},
      {"type": "take_profit", "amountUSD": 50, "triggerPercent": 0.25, "positionPercent": 0.5},
      {"type": "take_profit", "amountUSD": 50, "triggerPercent": 0.50, "positionPercent": 0.5}
    ],
    "rationale": "Entry with 10% stop and scaled take profits"
  }'
```

**Momentum-Based Entry:**
```bash
curl -X POST https://api.droyd.ai/api/v1/trade/open \
  -H "x-droyd-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": 456,
    "legs": [
      {"type": "quant_buy", "amountUSD": 200, "triggerPercent": 15},
      {"type": "quant_sell", "amountUSD": 200, "triggerPercent": -10},
      {"type": "stop_loss", "amountUSD": 200, "triggerPercent": 0.15}
    ],
    "rationale": "Entry on momentum breakout with protective stop"
  }'
```

---

## Manage Trade

`POST /api/v1/trade/manage`

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `strategy_id` | number | Yes | Strategy ID to manage |
| `action` | string | Yes | `close`, `buy`, `sell`, `update` |
| `amountUSD` | number | Conditional | Required for `buy` |
| `sellPercent` | number | Conditional | Required for `sell` (0-1) |
| `legs` | array | Conditional | Required for `update` |

### Actions

**Close Position:**
```bash
curl -X POST https://api.droyd.ai/api/v1/trade/manage \
  -H "x-droyd-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"strategy_id": 789, "action": "close"}'
```

**Partial Sell (50%):**
```bash
curl -X POST https://api.droyd.ai/api/v1/trade/manage \
  -H "x-droyd-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"strategy_id": 789, "action": "sell", "sellPercent": 0.5}'
```

**Add to Position:**
```bash
curl -X POST https://api.droyd.ai/api/v1/trade/manage \
  -H "x-droyd-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"strategy_id": 789, "action": "buy", "amountUSD": 50}'
```

**Update Strategy Legs:**
```bash
curl -X POST https://api.droyd.ai/api/v1/trade/manage \
  -H "x-droyd-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "strategy_id": 789,
    "action": "update",
    "legs": [
      {"leg_action": "add", "type": "take_profit", "amountUSD": 50, "triggerPercent": 0.30},
      {"leg_action": "update", "leg_id": 123, "triggerPercent": 0.15},
      {"leg_action": "remove", "leg_id": 456}
    ]
  }'
```

---

## Get Positions

`GET /api/v1/trade/positions`

### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `leg_status` | string | `active` | `active` or `all` (include executed) |

### Example

```bash
curl "https://api.droyd.ai/api/v1/trade/positions" \
  -H "x-droyd-api-key: $API_KEY"
```

### Response

```json
{
  "success": true,
  "data": {
    "strategies": [
      {
        "strategy_id": 789,
        "created_at": "2025-01-15T10:30:00Z",
        "reasoning": "Momentum play",
        "projects": [{"project_id": 123, "name": "Example", "symbol": "EXT"}],
        "legs": [...],
        "swaps": [...],
        "pnl_summary": {
          "total_pnl_usd": 12.50,
          "total_pnl_pct": 12.5,
          "realized_pnl_usd": 0,
          "unrealized_pnl_usd": 12.50,
          "position_usd_open": 100,
          "position_usd_mark": 112.50
        }
      }
    ],
    "overall_balance": 1500.00,
    "wallet_holdings": [...],
    "summary": {
      "total_strategies": 3,
      "total_pnl_usd": 250.50,
      "total_pnl_pct": 12.5
    }
  }
}
```

---

## Best Practices

1. **Always add stop losses**: Typical 10-20% below entry
2. **Scale take profits**: Lock in partial gains at multiple levels
3. **Use `positionPercent`** for partial exits (0.5 = 50%)
4. **Use `project_id`** when known (faster than contract_address)
5. **Monitor positions** regularly with GET /positions
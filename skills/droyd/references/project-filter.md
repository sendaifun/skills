# Project Filter

Filter and screen crypto projects using comprehensive market filters.

## Endpoint

`POST /api/v1/projects/filter` or `GET /api/v1/projects/filter`

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `filter_mode` | string | Yes | - | `natural_language` or `direct` |
| `instructions` | string | Conditional | - | Required for natural_language (min 10 chars) |
| `sort_by` | string | No | `trending` | Sort field |
| `sort_direction` | string | No | `desc` | `asc` or `desc` |
| `timeframe` | string | No | `4h` | `4h` or `24h` |
| `tradable_chains` | string[] | No | `["solana"]` | `solana`, `ethereum`, `base`, `arbitrum` |
| `min_market_cap` | number | No | - | Min market cap in MILLIONS |
| `max_market_cap` | number | No | - | Max market cap in MILLIONS |
| `min_price_change` | number | No | - | Min price change % |
| `max_price_change` | number | No | - | Max price change % |
| `min_liquidity` | number | No | - | Min liquidity in USD |
| `min_volume` | number | No | - | Min volume in USD |
| `min_trader_count` | number | No | - | Min unique traders |
| `min_trader_change` | number | No | - | Min trader change % |
| `min_technical_score` | number | No | - | Min quant score (-100 to 100) |
| `max_technical_score` | number | No | - | Max quant score |
| `min_rsi` | number | No | - | Min RSI (0-100) |
| `max_rsi` | number | No | - | Max RSI |
| `limit` | number | No | `20` | Results (1-50) |
| `page` | number | No | `0` | Page number (0-based) |
| `include_attributes` | string[] | No | default set | Attributes to include |

## Usage

The script accepts a single JSON argument matching the API request body:

```bash
scripts/droyd-filter.sh '<json>'
```

### Natural Language

```bash
scripts/droyd-filter.sh '{"filter_mode":"natural_language","instructions":"Find trending micro-cap Solana tokens with high trader growth","limit":20}'
```

### Direct Mode

```bash
scripts/droyd-filter.sh '{"filter_mode":"direct","sort_by":"traders_change","sort_direction":"desc","timeframe":"4h","tradable_chains":["solana"],"max_market_cap":10,"min_trader_change":50,"min_liquidity":50000,"limit":20}'
```

## Sort Options

| Sort By | Description |
|---------|-------------|
| `trending` | Composite-scored feed (default) |
| `market_cap` | Market capitalization |
| `price_change` | Price change % |
| `traders` | Unique trader count |
| `traders_change` | Trader change % |
| `volume` | Trading volume |
| `volume_change` | Volume change % |
| `buy_volume_ratio` | Buy vs sell ratio |
| `quant_score` | Technical/quant score |
| `quant_score_change` | Quant score change |
| `mentions_24h` | 24h mentions |
| `mentions_7d` | 7d mentions |
| `mentions_change_24h` | 24h mention change |
| `mentions_change_7d` | 7d mention change |

## GET Syntax

```bash
# Natural language
curl "https://api.droyd.ai/api/v1/projects/filter?mode=natural_language&q=Find+trending+Solana+tokens&limit=20" \
  -H "x-droyd-api-key: $API_KEY"

# Direct with filters
curl "https://api.droyd.ai/api/v1/projects/filter?mode=direct&sort=traders_change&dir=desc&max_mcap=10&min_trader_change=50&chain=solana" \
  -H "x-droyd-api-key: $API_KEY"
```

## Response

```json
{
  "success": true,
  "projects": [
    {
      "project_id": 123,
      "project_name": "Example Token",
      "symbol": "EXT",
      "short_description": "...",
      "market_cap": 5000000,
      "market_data_latest": {...},
      "technical_analysis": {...},
      "mindshare": {...}
    }
  ],
  "metadata": {
    "filter_mode": "direct",
    "applied_filters": {
      "sort_by": "traders_change",
      "sort_direction": "desc",
      "timeframe": "4h",
      "market_cap_range": "0-10M",
      "chain": ["solana"]
    },
    "total_results": 20,
    "page": 0,
    "limit": 20
  }
}
```

## Common Screening Strategies

### Trending Micro-Caps
```json
{
  "filter_mode": "direct",
  "sort_by": "traders_change",
  "max_market_cap": 10,
  "min_liquidity": 50000,
  "tradable_chains": ["solana"]
}
```

### Oversold Tokens
```json
{
  "filter_mode": "direct",
  "sort_by": "quant_score",
  "max_rsi": 30,
  "min_liquidity": 100000
}
```

### High Momentum
```json
{
  "filter_mode": "direct",
  "sort_by": "quant_score",
  "sort_direction": "desc",
  "min_technical_score": 50,
  "timeframe": "4h"
}
```

## Best Practices

1. **Natural language** for quick ad-hoc queries
2. **Direct mode** for precise, repeatable filters
3. **Market cap is in MILLIONS** (e.g., `10` = $10M)
4. **Timeframes**: `4h` for short-term momentum, `24h` for daily trends
5. **Combine filters** for precise screening (chain + mcap + trader change)
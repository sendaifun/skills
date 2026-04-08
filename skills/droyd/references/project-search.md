# Project Search

Search for crypto projects by name, symbol, address, or semantic concepts.

## Endpoint

`POST /api/v1/projects/search` or `GET /api/v1/projects/search`

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `search_type` | string | Yes | - | `name`, `symbol`, `address`, `semantic`, `project_id` |
| `queries` | string[] | Yes | - | Search queries (1-15 items) |
| `limit` | number | No | `10` | Results per query (1-25) |
| `include_attributes` | string[] | No | `["developments", "mindshare", "market_data"]` | Attributes to include |
| `developments_limit` | number | No | `3` | Max developments per project (1-10) |
| `recent_content_limit` | number | No | `10` | Max content items per project (1-25) |
| `recent_content_days_back` | number | No | `7` | Days back for content (1-30) |

## Search Types

### project_id (Fastest)
Direct ID lookup when you have known IDs:

```bash
curl -X POST https://api.droyd.ai/api/v1/projects/search \
  -H "x-droyd-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"search_type": "project_id", "queries": ["123", "456"]}'
```

### name
Search by project name:

```bash
curl -X POST https://api.droyd.ai/api/v1/projects/search \
  -H "x-droyd-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"search_type": "name", "queries": ["Bitcoin", "Ethereum"], "limit": 10}'
```

### symbol
Search by ticker:

```bash
curl -X POST https://api.droyd.ai/api/v1/projects/search \
  -H "x-droyd-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"search_type": "symbol", "queries": ["BTC", "ETH", "SOL"]}'
```

### address
Exact contract address match:

```bash
curl -X POST https://api.droyd.ai/api/v1/projects/search \
  -H "x-droyd-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"search_type": "address", "queries": ["So11111111111111111111111111111111111111112"]}'
```

### semantic
AI-powered concept search:

```bash
curl -X POST https://api.droyd.ai/api/v1/projects/search \
  -H "x-droyd-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"search_type": "semantic", "queries": ["AI agents in DeFi"], "limit": 15}'
```

## With Custom Attributes

```bash
curl -X POST https://api.droyd.ai/api/v1/projects/search \
  -H "x-droyd-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "search_type": "name",
    "queries": ["Bitcoin"],
    "include_attributes": ["market_data", "technical_analysis", "recent_content"],
    "developments_limit": 5,
    "recent_content_limit": 15
  }'
```

## GET Syntax

```bash
# By name
curl "https://api.droyd.ai/api/v1/projects/search?type=name&q=Bitcoin,Ethereum&limit=10" \
  -H "x-droyd-api-key: $API_KEY"

# By symbol
curl "https://api.droyd.ai/api/v1/projects/search?type=symbol&q=BTC,ETH" \
  -H "x-droyd-api-key: $API_KEY"

# Semantic
curl "https://api.droyd.ai/api/v1/projects/search?type=semantic&q=AI+agents+in+DeFi&limit=15" \
  -H "x-droyd-api-key: $API_KEY"

# With attributes
curl "https://api.droyd.ai/api/v1/projects/search?type=name&q=Bitcoin&include=market_data,technical_analysis" \
  -H "x-droyd-api-key: $API_KEY"
```

## Response

```json
{
  "success": true,
  "projects": [
    {
      "project_id": 1,
      "project_name": "Bitcoin",
      "symbol": "BTC",
      "short_description": "The first decentralized cryptocurrency...",
      "market_cap": 1200000000000,
      "recent_developments": [...],
      "mindshare": {...},
      "market_data_latest": {...}
    }
  ],
  "metadata": {
    "search_type": "name",
    "queries": ["Bitcoin"],
    "total_results": 1,
    "included_attributes": ["developments", "mindshare", "market_data"]
  }
}
```

## Available Attributes

| Attribute | Description |
|-----------|-------------|
| `developments` | Recent project developments/milestones |
| `recent_content` | Recent posts, tweets, news |
| `technical_analysis` | RSI, MACD, support/resistance |
| `market_data` | Price, volume, market cap |
| `mindshare` | Mentions and mindshare metrics |
| `detailed_description` | Technology explanation |
| `metadata` | Categories, ecosystems, tags, links |

## Best Practices

1. **Use `project_id`** when you have known IDs (fastest)
2. **Batch queries**: Search for multiple projects in one request
3. **Optimize attributes**: Only request what you need to reduce response size
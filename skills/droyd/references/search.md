# Content Search

Search the DROYD knowledge base for crypto content.

## Endpoint

`POST /api/v1/search` or `GET /api/v1/search`

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `search_mode` | string | No | `auto` | `auto`, `recent`, or `semantic` |
| `query` | string | Conditional | - | Required for semantic or auto search |
| `content_types` | string[] | No | all | Content types to search |
| `limit` | number | No | `25` | Results (1-100) |
| `days_back` | number | No | `7` | Days to look back (1-90) |
| `sort_by` | string | No | `relevance` | `relevance` or `date` |
| `minimum_relevance_score` | number | No | `0.2` | Score threshold (0-1) |
| `ecosystems` | string[] | No | - | Ecosystem slugs (max 5) |
| `categories` | string[] | No | - | Category slugs (max 5) |
| `project_ids` | number[] | No | - | Project IDs (max 25) |
| `image_limit` | number | No | - | Max images per item (1-10) |
| `include_analysis` | boolean | No | `true` | Include AI analysis (semantic only) |
| `snippet_limit` | number | No | - | Max text snippets per item (1-5, only with query) |

## Content Types

- `posts` - Long-form articles and blog posts
- `news` - News articles
- `developments` - Project updates and milestones
- `tweets` - Twitter/X posts
- `youtube` - YouTube videos
- `memories` - Agent memories
- `concepts` - Conceptual knowledge

## Search Modes

### Recent Mode
Browse latest content by type, ecosystem, category:

```bash
curl -X POST https://api.droyd.ai/api/v1/search \
  -H "x-droyd-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "search_mode": "recent",
    "content_types": ["posts", "news"],
    "ecosystems": ["ethereum", "base"],
    "categories": ["defi"],
    "days_back": 7,
    "limit": 25
  }'
```

### Semantic Mode
AI-powered question answering with analysis:

```bash
curl -X POST https://api.droyd.ai/api/v1/search \
  -H "x-droyd-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "search_mode": "semantic",
    "query": "What are the risks of liquid staking?",
    "content_types": ["posts"],
    "limit": 25,
    "include_analysis": true
  }'
```

### Auto Mode (Default)
Automatically determines search type based on query:

```bash
curl -X POST https://api.droyd.ai/api/v1/search \
  -H "x-droyd-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "search_mode": "auto",
    "query": "What happened today in crypto?",
    "ecosystems": ["ethereum"]
  }'
```

## GET Syntax

```bash
# Recent
curl "https://api.droyd.ai/api/v1/search?types=posts,news&ecosystems=ethereum&days_back=7" \
  -H "x-droyd-api-key: $API_KEY"

# Semantic
curl "https://api.droyd.ai/api/v1/search?q=AI+agents&mode=semantic&types=posts,tweets&limit=50" \
  -H "x-droyd-api-key: $API_KEY"

# Auto (default - automatically determines mode)
curl "https://api.droyd.ai/api/v1/search?q=What+happened+today+in+crypto&ecosystems=ethereum" \
  -H "x-droyd-api-key: $API_KEY"
```

## Response

```json
{
  "success": true,
  "analysis": "Recent AI agent projects show...",
  "content": [
    {
      "post_id": 12345,
      "title": "AI Agents on Solana",
      "summary": "Analysis of AI agent frameworks...",
      "post_link": "https://...",
      "published_date": "2025-01-05T10:00:00Z",
      "source_name": "CryptoDaily",
      "projects": [{"project_id": 789, "project_name": "Virtuals Protocol"}]
    }
  ],
  "metadata": {
    "content_types": ["posts", "tweets"],
    "days_back": 7,
    "total_results": 50,
    "limit": 50
  }
}
```

## Valid Ecosystems

`bitcoin`, `ethereum`, `solana`, `base`, `optimism`, `arbitrum`, `celestia`, `monad`, `binance-smart-chain`, `megaeth`, `eclipse`, `movement`, `aptos`, `sui`, `avalanche`, `polygon`, `scroll`, `berachain`, `sonic`, `hyperliquid`, `unichain`, `near`, `hedera`, `ronin`, `cosmos`, `ripple`, `bittensor`, `virtuals`, `telegram`, `ton`, `tron`, `cardano`, `zksync`, `blast`, `linea`, `stacks`, `celo`, `starknet`, `sei`, `farcaster`, `abstract`

## Valid Categories

`defi`, `derivatives`, `rwas`, `nfts`, `gaming`, `ai`, `socialfi`, `daos`, `memecoins`, `stablecoins`, `ecosystems`, `rollups`, `zk`, `interoperability`, `depin`, `wallets`, `consumer`, `robotics`, `prediction-markets`

## Best Practices

1. **Semantic vs Recent**: Use `semantic` for specific questions; `recent` for discovery
2. **Relevance scores**: `0.1` = more noise, `0.3` = balanced, `0.5+` = high quality
3. **Content mix**: Posts + News = analysis; Tweets + YouTube = sentiment
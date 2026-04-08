# Watchlist

Retrieve watchlist projects for the authenticated user. Includes projects watched by user's agent and swarm agents.

## Endpoint

`POST /api/v1/projects/watchlist` or `GET /api/v1/projects/watchlist`

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `scope` | string | No | `agent` | `agent`, `swarm`, or `combined` |
| `include_attributes` | string[] | No | `["developments", "mindshare", "market_data"]` | Attributes to include |
| `limit` | number | No | `15` | Results (1-50) |

## Scopes

- `agent` — Only the user's primary agent's watchlist
- `swarm` — Watchlists from the user's swarm (followed) agents
- `combined` — Both user's agent and swarm watchlists

## Examples

```bash
# User's agent watchlist
scripts/droyd-watchlist.sh "agent" 20

# Swarm watchlists with custom attributes
scripts/droyd-watchlist.sh "swarm" 15 "market_data,technical_analysis"

# Combined watchlists
scripts/droyd-watchlist.sh "combined" 25
```

## GET Syntax

```bash
curl "https://api.droyd.ai/api/v1/projects/watchlist?scope=combined&include=market_data,mindshare&limit=25" \
  -H "x-droyd-api-key: $API_KEY"
```

## Response

Projects include `agents_watching` array with each agent's `investment_score`, `current_evaluation`, and `key_thesis_points`, plus any requested attributes (developments, market_data, mindshare, etc.).

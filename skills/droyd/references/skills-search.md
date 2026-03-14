# Search Skills

Search agent skills with scope-based filtering. Discover tools, scripts, and automations across your agent, swarm, the Droyd platform, or paid third-party skills.

## Endpoint

`POST /api/v1/skills/search` or `GET /api/v1/skills/search`

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | No | - | Search query text |
| `scopes` | string[] | No | All scopes | `agent`, `swarm`, `droyd`, `payment_required` |
| `limit` | number | No | `50` | Results (1-100) |
| `sort_by` | string | No | `relevance` | `relevance`, `trending`, `popular`, `acceleration`, `adoption`, `recent` |
| `skill_type` | string | No | - | Filter by skill type (e.g. `tool`) |
| `offset` | number | No | `0` | Pagination offset |
| `include_agent_ids` | number[] | No | - | Filter to specific agent IDs |
| `min_payment_amount` | number | No | - | Min skill access price (USD) |
| `max_payment_amount` | number | No | - | Max skill access price (USD) |
| `max_malicious_probability` | number | No | `0.3` | Max malicious probability threshold (0-1) |

## Examples

```bash
# Search by query
scripts/droyd-skills-search.sh "price analysis" "agent,droyd" 25

# Filter by skill type
scripts/droyd-skills-search.sh "trading bot" "droyd,swarm" 20 "popular" "tool"

# Find paid skills
scripts/droyd-skills-search.sh "" "payment_required" 20 "trending"
```

## Scopes

- `agent` — Only the authenticated user's agent skills
- `swarm` — Skills from the user's swarm agents
- `droyd` — Droyd platform skills (agent ID 2)
- `payment_required` — Third-party paid skills (excludes your agent, swarm, and Droyd)

## Response

Each skill includes `skill_id`, `slug`, `title`, `description`, `source`, `author`, `categories`, `code_languages`, `dependencies`, `skill_type`, `complexity_tier`, `version`, `filepath`, `run_amount_usd`, quality metrics (`quality_score`, `value_score`, `malicious_probability`), usage stats (`total_reads_30d`, `unique_agents_30d`, `trending_percentile`), and `agent` info.

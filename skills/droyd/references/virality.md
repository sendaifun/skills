# Virality Analysis

Analyze social mention velocity, virality signals, and trend momentum for crypto terms or projects.

## Endpoint

`POST /api/v1/data/virality`

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `queries` | string[] | Yes | - | Terms or project IDs to analyze (max 25) |
| `search_type` | string | Yes | - | `terms` or `project_id` |
| `lookback_days` | number | No | `30` | Days to look back (1-90) |
| `bucket_interval` | string | No | `8 hours` | Time bucket interval (e.g., "4 hours", "8 hours", "1 day") |
| `viral_threshold` | number | No | `2.0` | Z-score threshold for viral detection (0.5-10) |
| `include_timeseries` | boolean | No | `false` | Include full time-bucketed velocity data |

## Search Types

- `terms` — Searches directly for provided terms/symbols
- `project_id` — Fetches project records and builds query sets with [name, symbol] for comprehensive coverage

## Signal Values

| Signal | Possible Values |
|--------|-----------------|
| `trend` | `strongly_bullish`, `bullish`, `neutral`, `bearish`, `strongly_bearish` |
| `momentum` | `accelerating_fast`, `accelerating`, `decelerating`, `decelerating_fast` |
| `virality` | `viral`, `elevated`, `above_average`, `normal` |
| `trend_maturity` | `no_trend`, `emerging`, `developing`, `established`, `mature` |
| `trend_recency` | `active_now`, `recent`, `cooling`, `cold` |
| `alert_level` | `critical`, `high`, `medium`, `low` |

## Timeseries Fields (when `include_timeseries: true`)

| Field | Description |
|-------|-------------|
| `mention_count` | Raw mention count for the bucket |
| `fast_ma` | Fast moving average (3-period) |
| `slow_ma` | Slow moving average (12-period) |
| `velocity` | MACD-style velocity (fast_ma - slow_ma) |
| `signal_line` | Smoothed signal line |
| `acceleration` | Rate of change of velocity |
| `z_score` | Statistical deviation from mean |
| `pct_change` | Percent change from previous bucket |

## Examples

**Analyze by terms:**
```bash
scripts/droyd-virality.sh "terms" "BTC,ETH,SOL"
```

**Analyze by project ID with timeseries:**
```bash
scripts/droyd-virality.sh "project_id" "6193,34570" 30 "8 hours" 2.0 true
```

## Response Structure

Each query returns: `current` (latest bucket stats), `stats` (aggregate metrics), `trend` (duration/streak info), `signals` (categorical assessments), `alert_level`, `summary`, and optionally `timeseries` (chronological bucket data).

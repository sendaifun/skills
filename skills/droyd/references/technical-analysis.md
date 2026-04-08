# Technical Analysis Timeseries

Get OHLCV candle timeseries enriched with technical indicators (RSI, MACD, Bollinger Bands, momentum score) and daily mindshare data.

## Endpoint

`POST /api/v1/projects/technical-analysis`

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `project_ids` | number[] | Yes | - | Project IDs to analyze (1-5, positive integers) |
| `timeframes` | string[] | No | `["4H"]` | Timeframes for candle data |
| `include_ta` | boolean | No | `true` | Include full technical analysis indicators |

## Valid Timeframes

- `5m` — 5-minute candles
- `15m` — 15-minute candles
- `4H` — 4-hour candles
- `1D` — Daily candles

## Candle Fields

| Field | Description |
|-------|-------------|
| `time` | Unix timestamp (seconds) |
| `open`, `close`, `high`, `low` | OHLC price data |
| `volume` | Trading volume |
| `momentum_score` | Composite momentum score |
| `rsi` | Relative Strength Index (0-100) |
| `macd` | MACD line value |
| `macd_signal` | MACD signal line |
| `macd_histogram` | MACD histogram (macd - signal) |
| `macd_velocity` | Rate of MACD change |
| `macd_acceleration` | Rate of velocity change |
| `macd_is_converging` | Whether MACD lines are converging |
| `macd_candles_till_cross` | Estimated candles until MACD crossover |
| `macd_cross_direction` | Expected cross direction (1 = bullish, -1 = bearish) |
| `bollinger_position` | Price position within Bollinger Bands (0-1) |
| `bollinger_squeeze` | Whether bands are in a squeeze |
| `bollinger_expanding` | Whether bands are expanding |
| `price_minus_vwap` | Price deviation from VWAP |
| `mindshare_24h` | Daily mindshare score (merged from daily data) |
| `mindshare_abs_change_24h` | Daily mindshare absolute change |

## Examples

**Single project, default 4H timeframe:**
```bash
scripts/droyd-technical-analysis.sh "123"
```

**Multiple projects, multiple timeframes:**
```bash
scripts/droyd-technical-analysis.sh "123,456,789" "4H,1D"
```

**OHLCV only (no TA indicators):**
```bash
scripts/droyd-technical-analysis.sh "123" "5m,15m" false
```

## Response Structure

Each result contains: `project_id`, `name`, `symbol`, and `timeseries` keyed by timeframe. Each timeframe holds an array of candle objects with the fields above.

If some projects fail and others succeed, the response includes both `results` and `errors` (keyed by project ID with error message).

## Notes

- Max 5 projects per request
- Results are cached for 2 minutes
- Mindshare data is merged at the daily level — intra-day candles inherit the mindshare of their UTC date

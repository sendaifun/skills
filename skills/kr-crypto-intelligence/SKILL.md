---
name: kr-crypto-intelligence
description: Korean crypto + news data API with x402 payments. 15 paid endpoints — Korean-to-English sentiment (world's first), dual-basis Kimchi Premium across 180+ tokens, Global vs Korea divergence with AI breakdown, plus Korean news (K-pop artists, semiconductor industry: Samsung/SK Hynix/HBM) translated to English with AI synthesis. Every paid response includes cryptographic receipt (ECDSA secp256k1). For agents that analyze Asian crypto markets, monitor Korean regulations, detect retail sentiment shifts, or process Korean news.
---

# KR Crypto Intelligence Integration Guide

A comprehensive guide for integrating Korean crypto + news intelligence into AI agents. Access live Upbit/Bithumb data, Kimchi Premium across 180+ tokens, AI-powered Korean sentiment analysis, and Korean news translated to English — all via x402 micropayments. No API keys, no accounts.

## Overview

Korean market data is the **blind spot** of every global trading agent. South Korea ranks **top 3 globally in crypto trading volume**, yet most agents have zero visibility into Upbit, Bithumb, or Korean-language news. Capital flows in/out of Korea move global prices — and they move first.

KR Crypto Intelligence closes that gap, and now extends beyond crypto to **Korean news translation**: K-pop artists (1B+ global fans) and Korean semiconductor industry (Samsung Electronics, SK Hynix, HBM supply chain ≈ 20% of Korean GDP).

### Key Features

| Feature | Description |
|---------|-------------|
| **189+ Korean tokens** | Full Upbit + Bithumb coverage, 60s refresh |
| **Kimchi Premium** | Real-time price gap vs Binance for every supported token |
| **Korean Sentiment** | First-in-world Korean news → English sentiment via Claude AI |
| **Global vs Korea Divergence** | CoinGecko global price + Korean price + AI breakdown (light/deep tiers) |
| **Investment Warnings** | Live caution flags from Upbit (volume soaring, deposit soaring, listing changes) |
| **Korean News → English** | K-pop artists + semiconductor industry headlines + AI synthesis |
| **Signed Receipts** | Every paid response includes ECDSA secp256k1 receipt for agent accountability |
| **x402 Pay-per-Call** | Base, Polygon, Solana — no signup, no API keys |
| **MCP Server** | 15 tools for Claude Desktop, Cursor, ChatGPT |

### Numbers

- **15 paid endpoints** ($0.001 to $0.10 per call)
- **2 free endpoints** (`/health`, `/api/v1/symbols`)
- **3 networks** (Base mainnet, Polygon mainnet, Solana mainnet)
- **15 MCP tools** at `https://mcp.printmoneylab.com/mcp`
- **Live**: `https://api.printmoneylab.com`
- **Source**: [github.com/bakyang2/kr-crypto-intelligence](https://github.com/bakyang2/kr-crypto-intelligence)

---

## Quick Start

### Install x402 Client

**TypeScript:**
```bash
npm install x402 viem
```

**Python:**
```bash
pip install "x402[httpx,evm]"
```

### First Call — Kimchi Premium (Base, $0.001)

**TypeScript:**
```typescript
import { x402HttpClient } from 'x402';
import { exactEvm } from 'x402/mechanisms/evm/exact';
import { privateKeyToAccount } from 'viem/accounts';

const account = privateKeyToAccount(process.env.WALLET_PK as `0x${string}`);
const client = new x402HttpClient();
client.register('eip155:8453', exactEvm({ signer: account })); // Base

const res = await client.get(
  'https://api.printmoneylab.com/api/v1/kimchi-premium?symbol=BTC'
);
console.log(await res.json());
// { symbol: "BTC", premium_percent: 1.1, upbit_krw: 142000000,
//   binance_usdt: 95200.5, fx_rate: 1475.27, receipt: {...}, ... }
```

**Python:**
```python
import asyncio, getpass
from x402 import x402Client
from x402.mechanisms.evm.exact import ExactEvmScheme
from x402.http.clients.httpx import x402HttpxClient
from eth_account import Account

async def main():
    pk = getpass.getpass("Private key: ")
    signer = Account.from_key(pk)
    client = x402Client()
    client.register("eip155:8453", ExactEvmScheme(signer=signer))

    async with x402HttpxClient(client, timeout=30) as http:
        r = await http.get(
            "https://api.printmoneylab.com/api/v1/kimchi-premium?symbol=BTC"
        )
        print(r.json())

asyncio.run(main())
```

### MCP Server — Claude Desktop / Cursor

```json
{
  "mcpServers": {
    "kr-crypto": {
      "url": "https://mcp.printmoneylab.com/mcp",
      "transport": "streamable-http"
    }
  }
}
```

15 tools available: `get_kimchi_premium`, `get_kr_sentiment`, `get_global_vs_korea_divergence`, `get_global_vs_korea_divergence_deep`, `get_market_read`, `get_arbitrage_scanner`, `get_exchange_alerts`, `get_market_movers`, `get_kr_prices`, `get_stablecoin_premium`, `get_fx_rate`, `get_kr_news_kpop`, `get_kr_news_kpop_summary`, `get_kr_news_semiconductor`, `get_kr_news_semiconductor_summary`, plus free `get_available_symbols`, `check_health`.

---

## Endpoints

### Korean Sentiment ($0.05) — Most Powerful

`GET /api/v1/kr-sentiment` — World's first Korean-to-English crypto sentiment. Combines exchange intelligence with Korean news (Coinness Telegram) for AI-powered insights. **1-hour cache.**

```typescript
const r = await client.get('https://api.printmoneylab.com/api/v1/kr-sentiment');
const data = await r.json();
// {
//   sentiment: "CAUTIOUS_FOMO",
//   score: 0.4,
//   report_en: "Korean retail showing mixed signals...",
//   exchange_signals: { deposit_soaring: ["BIO","ARKM"], warnings: 2, ... },
//   news_context: { korean_count: 8, total_analyzed: 20 }
// }
```

### Global vs Korea Divergence — Light ($0.05) / Deep ($0.10)

Light: divergence + 1-2 sentence AI summary (60s cache).
Deep: + Korean news signals (Coinness 24h) + structured AI breakdown (drivers, action suggestion, confidence). 5-min cache.

25 supported symbols: BTC, ETH, XRP, SOL, ADA, DOGE, DOT, MATIC, LINK, AVAX, ATOM, UNI, LTC, NEAR, OP, ARB, APT, ALGO, FTM, SUI, TRX, BCH, ETC, HBAR, SHIB.

### Korean News → English (NEW, May 2026)

Korean news translated to English with AI synthesis. Powered by Naver News API + Claude Haiku (classification + translation) + Claude (premium synthesis).

**K-pop**:
- `GET /api/v1/kr-news/kpop?limit=5` — $0.01 — Headlines (artists/groups/solo) translated to English
- `GET /api/v1/kr-news/kpop-summary?limit=5` — $0.05 — Headlines + AI sentiment + key themes + trending artists

**Semiconductor**:
- `GET /api/v1/kr-news/semiconductor?limit=5` — $0.02 — Korean semiconductor industry (Samsung, SK Hynix, HBM)
- `GET /api/v1/kr-news/semiconductor-summary?limit=5` — $0.10 — Headlines + AI market_signal (bullish/bearish/neutral) + trending companies

130 K-pop entities + 80 semiconductor entities in keyword dictionary. 5-min cache.

```typescript
const r = await client.get(
  'https://api.printmoneylab.com/api/v1/kr-news/semiconductor-summary?limit=5'
);
const { results, ai_analysis, receipt } = await r.json();
// ai_analysis: {
//   overall_sentiment: "bullish",
//   key_themes: ["HBM supply chain dominance", "AI capex acceleration", ...],
//   trending_entities: ["Samsung Electronics", "SK Hynix", "TSMC", ...],
//   market_signal: "bullish",
//   summary_en: "Korean semiconductor equities..."
// }
```

### Arbitrage Scanner ($0.01)

`GET /api/v1/arbitrage-scanner` — Token-by-token Kimchi Premium for 189+ tokens. Reverse premiums (Korean discount), Upbit-Bithumb price gaps, market share.

### Exchange Alerts ($0.01)

`GET /api/v1/exchange-alerts` — Live caution flags from Upbit: `INVESTMENT_WARNING`, `VOLUME_SOARING`, `DEPOSIT_SOARING`, `GLOBAL_PRICE_DIFF`, `SMALL_ACCOUNTS_CONCENTRATION`.

### Market Movers ($0.01)

`GET /api/v1/market-movers` — 1-minute price surges/crashes (>1%), volume spikes, top 20 by volume on Upbit.

### Market Read ($0.10) — AI Synthesis

`GET /api/v1/market-read` — Combines 12+ data sources → Claude AI → BULLISH/BEARISH/NEUTRAL signal with confidence score and token-level alerts.

### Stablecoin Premium ($0.001)

`GET /api/v1/stablecoin-premium` — USDT/USDC premium on Korean exchanges vs official USD/KRW. Critical fund-flow indicator.

### Basic Market Data ($0.001 each)

- `GET /api/v1/kimchi-premium?symbol=BTC` — single-token Kimchi Premium
- `GET /api/v1/kr-prices?symbol=BTC&exchange=all` — Upbit + Bithumb prices in KRW
- `GET /api/v1/fx-rate` — current USD/KRW

---

## Receipt Verification

**Every paid response includes a signed receipt for agent accountability.** Verify authenticity using merchant's public key.

```json
{
  "receipt": {
    "id": "rcpt_20260513_a3f9c1",
    "issued_at": "2026-05-13T07:30:00.000Z",
    "endpoint": "/api/v1/kimchi-premium",
    "amount": "0.001",
    "currency": "USDC",
    "network": "eip155:8453",
    "tx_hash": "0x...",
    "payer": "0x...",
    "merchant": "0xcF9223eCe895258dEa8D288AEBcf846Ab8E342fB",
    "signature": "0x...",
    "signer": "0x1AdF0f9e576E94a150208F08D2C31F791932E781"
  }
}
```

**Python verification:**
```python
from eth_account import Account
from eth_account.messages import encode_defunct

r = response_json["receipt"]
payload = "|".join([
    r["id"], r["endpoint"], r["amount"], r["currency"],
    r["network"], r["tx_hash"], r["payer"], r["merchant"], r["issued_at"]
])
recovered = Account.recover_message(
    encode_defunct(text=payload), signature=r["signature"]
)
assert recovered.lower() == r["signer"].lower()  # authentic
```

Merchant public key published at `https://api.printmoneylab.com/.well-known/x402` under `receipt_signer.public_key`.

---

## Use Cases

### 1. Korean Market Entry Analysis (Global Funds)

```typescript
const [stable, kimchi] = await Promise.all([
  client.get('https://api.printmoneylab.com/api/v1/stablecoin-premium').then(r => r.json()),
  client.get('https://api.printmoneylab.com/api/v1/kimchi-premium?symbol=BTC').then(r => r.json()),
]);

if (stable.stablecoins.usdt.premium_percent > 0.5 && kimchi.premium_percent > 2) {
  // Strong inflow signal — Korean retail loading up
}
```

### 2. Kimchi Premium Arbitrage Bot

```typescript
const r = await client.get('https://api.printmoneylab.com/api/v1/arbitrage-scanner');
const { premiums } = await r.json();
const opportunities = premiums.filter(p =>
  Math.abs(p.premium_pct) > 3 && !p.warning && p.upbit_volume_krw > 5e9
);
```

### 3. Korean Policy / Regulation Monitoring

Poll `kr-sentiment` once per hour — when score swings >0.3 in either direction, regulatory news likely broke.

### 4. Global vs Korea Divergence Detection

```typescript
const r = await client.get(
  'https://api.printmoneylab.com/api/v1/global-vs-korea-divergence-deep?symbol=ETH'
);
const { ai_deep_analysis } = await r.json();
if (ai_deep_analysis.confidence === 'high') {
  console.log(ai_deep_analysis.implied_action_suggestion);
}
```

### 5. Korean Semiconductor Trading Signal (NEW)

```typescript
const r = await client.get(
  'https://api.printmoneylab.com/api/v1/kr-news/semiconductor-summary?limit=5'
);
const { ai_analysis } = await r.json();
if (ai_analysis.market_signal === 'bullish') {
  // Trigger Korean semiconductor ETF position (KODEX 반도체, 069500.KS)
  console.log('Key drivers:', ai_analysis.key_themes);
  console.log('Trending:', ai_analysis.trending_entities);
}
```

### 6. K-pop Content Agent (NEW)

```typescript
const r = await client.get(
  'https://api.printmoneylab.com/api/v1/kr-news/kpop-summary?limit=5'
);
const { ai_analysis, results } = await r.json();
// Generate fan engagement content based on trending_artists + key_themes
// Or post to social media in English with proper attribution
```

### 7. Asian Signal for Trading Agents

Wire `market-read` into your agent's reasoning loop — structured JSON with `signal`, `confidence`, `key_factors`, `token_alerts`, `risk_warning`.

---

## AWS Bedrock AgentCore Integration

AgentCore agents can call x402-protected endpoints by routing payments through a Coinbase AgentKit wallet.

```typescript
import { AgentKit } from '@coinbase/agentkit';
import { x402HttpClient } from 'x402';
import { exactEvm } from 'x402/mechanisms/evm/exact';

const agentKit = await AgentKit.from({ cdpApiKeyName, cdpApiKeyPrivateKey });
const wallet = await agentKit.getWallet();

const client = new x402HttpClient();
client.register('eip155:8453', exactEvm({ signer: wallet.toViemAccount() }));

// Korean semiconductor signal tool
export const semiconductorSignalTool = {
  name: 'korean_semiconductor_signal',
  description: 'Korean semiconductor industry news + AI market signal. Costs $0.10 USDC.',
  invoke: async () => {
    const r = await client.get(
      'https://api.printmoneylab.com/api/v1/kr-news/semiconductor-summary?limit=5'
    );
    return r.json();
  },
};
```

Reference: [Coinbase AgentKit docs](https://docs.cdp.coinbase.com/agentkit/welcome).

---

## Best Practices

- **Respect built-in caches.** kimchi/kr-prices/fx 15s, intelligence endpoints 60s, kr-sentiment 1h, divergence-light 60s, divergence-deep 5min, kr-news/* 5min.
- **Use 30s HTTP timeout** for `kr-sentiment`, `market-read`, `divergence-deep`, `kr-news/*-summary` — Claude AI adds latency.
- **Use 45s timeout for kr-news premium** endpoints (cold start ~25s).
- **Verify receipts** when running production audit trails.
- **Use Polygon for cheaper gas.** All paid endpoints accept `eip155:137` with native USDC.
- **MCP for human-in-the-loop.** Let Claude/Cursor auto-discover tools instead of hard-coding endpoints.

---

## Pricing

| Endpoint | Price | Cache | Purpose |
|---|---|---|---|
| `/api/v1/kimchi-premium` | $0.001 | 15s | Single-token Kimchi |
| `/api/v1/kr-prices` | $0.001 | 15s | Upbit/Bithumb price |
| `/api/v1/fx-rate` | $0.001 | 15s | USD/KRW |
| `/api/v1/stablecoin-premium` | $0.001 | 15s | Fund flow indicator |
| `/api/v1/arbitrage-scanner` | $0.01 | 60s | 189+ tokens Kimchi |
| `/api/v1/exchange-alerts` | $0.01 | 60s | Caution flags |
| `/api/v1/market-movers` | $0.01 | 60s | 1-min movers |
| `/api/v1/kr-news/kpop` | $0.01 | 5min | K-pop news |
| `/api/v1/kr-news/semiconductor` | $0.02 | 5min | Semi news |
| `/api/v1/global-vs-korea-divergence` | $0.05 | 60s | Light AI divergence |
| `/api/v1/kr-sentiment` | $0.05 | 1 hour | Korean news + AI sentiment |
| `/api/v1/kr-news/kpop-summary` | $0.05 | 5min | K-pop + AI synthesis |
| `/api/v1/global-vs-korea-divergence-deep` | $0.10 | 5 min | Deep AI + news signal |
| `/api/v1/market-read` | $0.10 | n/a | Full market AI synthesis |
| `/api/v1/kr-news/semiconductor-summary` | $0.10 | 5min | Semi + AI market signal |
| `/api/v1/symbols` | free | 5 min | Symbol list |
| `/health` | free | n/a | Service status |

---

## Live URLs

- **API**: `https://api.printmoneylab.com`
- **MCP**: `https://mcp.printmoneylab.com/mcp` (streamable-http)
- **Manifest**: `https://api.printmoneylab.com/.well-known/x402`
- **llms.txt**: `https://api.printmoneylab.com/llms.txt`
- **Source**: [github.com/bakyang2/kr-crypto-intelligence](https://github.com/bakyang2/kr-crypto-intelligence)
- **Networks**: Base (`eip155:8453`), Polygon (`eip155:137`), Solana mainnet
- **Bazaar**: indexed via CDP x402 discovery (auto-listed on Agentic.market)

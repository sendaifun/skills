# Jito Block Engine — Endpoints, Addresses & Enums

Pure lookup data for the Jito Block Engine: regional base URLs, API paths, tip accounts, the tip-floor API, bundle-status enums, rate limits, and SDK versions. The tutorial flow and runnable code live in `docs/jito-bundles.md` — this file is reference only.

> **Verify-at-runtime:** the **tip accounts can rotate** — fetch the current set via `getTipAccounts` rather than hardcoding (the list below is a snapshot). Program IDs and endpoint hosts are stable. **No Jito on devnet** — use testnet or mainnet.

---

## Mainnet Block Engine base URLs

All HTTPS. The **global** host routes to the nearest region; for lowest latency pick the region closest to your server (and ideally the current/next leader).

| Region | Base URL |
|---|---|
| **Global (default)** | `https://mainnet.block-engine.jito.wtf` |
| Amsterdam | `https://amsterdam.mainnet.block-engine.jito.wtf` |
| Dublin | `https://dublin.mainnet.block-engine.jito.wtf` |
| Frankfurt | `https://frankfurt.mainnet.block-engine.jito.wtf` |
| London | `https://london.mainnet.block-engine.jito.wtf` |
| New York | `https://ny.mainnet.block-engine.jito.wtf` |
| Salt Lake City | `https://slc.mainnet.block-engine.jito.wtf` |
| Singapore | `https://singapore.mainnet.block-engine.jito.wtf` |
| Tokyo | `https://tokyo.mainnet.block-engine.jito.wtf` |

**Testnet** mirrors the pattern at `https://<region>.testnet.block-engine.jito.wtf` (e.g. `https://dallas.testnet.block-engine.jito.wtf`, `https://ny.testnet.block-engine.jito.wtf`). There is **no devnet Block Engine**.

---

## API paths (append to any regional base URL)

| Method group | Path |
|---|---|
| Bundles — `sendBundle`, `getBundleStatuses`, `getInflightBundleStatuses`, `getTipAccounts` | `/api/v1/bundles` |
| Single transaction — `sendTransaction` | `/api/v1/transactions` |

- Full bundle endpoint example: `https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles`
- Single-tx with revert protection: `https://mainnet.block-engine.jito.wtf/api/v1/transactions?bundleOnly=true`
- All bundle JSON-RPC methods are `POST`ed to the same `/api/v1/bundles` path (the method name is in the JSON-RPC body).

---

## Tip accounts (8)

Returned by `getTipAccounts`. **Pick one at random per submission** (all 8 are write-locked while tipped; always hitting one serializes your bundles). **Fetch at runtime — the set can rotate.** Snapshot of the current set:

```
96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5
HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe
Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY
ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49
DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh
ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt
DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL
3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT
```

`getTipAccounts` request/response:

```json
// Request → POST /api/v1/bundles
{ "jsonrpc": "2.0", "id": 1, "method": "getTipAccounts", "params": [] }
```
```json
// Response — result is the 8-element array
{ "jsonrpc": "2.0", "id": 1, "result": [
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
  "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT"
] }
```

| Address | Role |
|---|---|
| `T1pyyaTNZsKv2WcRAB8oVnk93mLJw2XzjtVYqCsaHqt` | **Jito Tip Payment Program** — collects/distributes tips. You transfer to one of its 8 tip accounts, **not** to the program ID directly. |

**Tip rules:** minimum **1,000 lamports**; transfer SOL (e.g. `SystemProgram.transfer`) to a random tip account; place the tip in the **last** transaction of the bundle; the tip must be **inside** the bundle (a separate non-bundled tip is not credited).

---

## Tip-floor API

Size tips dynamically — real competitive tips run far above the 1,000-lamport floor during congestion. **Percentile values are in SOL** (multiply by `1e9` for lamports).

| Transport | Endpoint |
|---|---|
| REST (poll) | `GET https://bundles.jito.wtf/api/v1/bundles/tip_floor` |
| WebSocket (stream) | `wss://bundles.jito.wtf/api/v1/bundles/tip_stream` |

Returned fields (REST returns an array with one object; WS pushes the same shape):

| Field | Meaning |
|---|---|
| `landed_tips_25th_percentile` | 25th percentile of landed tips (SOL) |
| `landed_tips_50th_percentile` | 50th percentile (SOL) |
| `landed_tips_75th_percentile` | **75th percentile — common baseline** (SOL) |
| `landed_tips_95th_percentile` | 95th percentile — scale up for hot events (SOL) |
| `landed_tips_99th_percentile` | 99th percentile — launches/liquidations (SOL) |
| `ema_landed_tips_50th_percentile` | EMA of the 50th percentile (SOL) |

Common strategy: baseline at `landed_tips_75th_percentile`; scale toward 95th/99th during token launches and liquidation cascades.

---

## Bundle status enums

### `getInflightBundleStatuses` (live, 5-minute window; ≤5 bundle IDs)

| Field | Values / type |
|---|---|
| `bundle_id` | string (sha-256) |
| `status` | `Invalid` (unseen in 5-min window) · `Pending` (not yet failed or landed) · `Failed` (failed across all regions / not forwarded) · `Landed` (confirmed on-chain) |
| `landed_slot` | slot number if landed, else `null` |

### `getBundleStatuses` (confirmed detail; ≤5 bundle IDs)

| Field | Values / type |
|---|---|
| `bundle_id` | string |
| `transactions` | array of base58 transaction signatures |
| `slot` | slot where processed |
| `confirmation_status` | `processed` · `confirmed` · `finalized` |
| `err` | error object (retryable / non-retryable) or none |

Both wrap results in `result.value` (one entry per bundle ID). Poll `getInflightBundleStatuses` every ~1–2 s; on `Landed`, read `getBundleStatuses` for final detail. Always also enforce `lastValidBlockHeight` expiry as the hard timeout.

---

## Rate limits & authentication

| | Value |
|---|---|
| Default rate limit | **1 request / second / IP / region** (free, no auth) |
| Over-limit response | HTTP **429** |
| Raise the limit | UUID auth from a **Jito Discord** ticket |
| UUID — header | `x-jito-auth: <uuid>` |
| UUID — query param | `?uuid=<uuid>` (e.g. `/api/v1/transactions?uuid=<uuid>`) |

A submit-to-all-regions fan-out trips 429s at >1 req/s/IP — throttle per region, or submit to one nearby region and rely on internal forwarding.

---

## SDKs

| Package | Version | Notes |
|---|---|---|
| **raw `fetch` / `axios`** | n/a | **Most portable**, zero deps, browser-safe — recommended default |
| `jito-js-rpc` | **0.2.2** | `JitoJsonRpcClient`; thin JSON-RPC wrapper. Base URL is the `.../api/v1` prefix (no `/bundles` suffix); pass `""` for no UUID |
| `jito-ts` | **4.2.1** | gRPC + searcher/validator tooling; heavier, overkill for send-bundle |

---

## ShredStream pointer

Lowest-latency shred feed from leaders (for HFT/searchers, validators, low-latency geyser/RPC). Run the **ShredStream Proxy**: requires an **approved (allowlisted) Solana pubkey**, open **UDP port 20000**, and config `BLOCK_ENGINE_URL` + `DESIRED_REGIONS` + `DEST_IP_PORTS`.

`DESIRED_REGIONS` accepts up to 2 of: `amsterdam, ny, dublin, frankfurt, london, singapore, tokyo, salt-lake-city`. **Note:** the ShredStream region slug `salt-lake-city` differs from the HTTP host slug `slc`. Docs: https://docs.jito.wtf/lowlatencytxnfeed/

---

## References

- Jito — Low-Latency Transaction Send: https://docs.jito.wtf/lowlatencytxnsend/
- Jito — Low-Latency Block Updates / ShredStream: https://docs.jito.wtf/lowlatencytxnfeed/
- Jito MEV GitBook — Mainnet addresses: https://jito-labs.gitbook.io/mev/searcher-resources/block-engine/mainnet-addresses
- Jito — Tip-floor API: https://bundles.jito.wtf/api/v1/bundles/tip_floor
- Tutorial flow + runnable example: `docs/jito-bundles.md`
</content>

# Jito Block Engine — JSON-RPC reference

All facts verified against <https://docs.jito.wtf/lowlatencytxnsend/> (June 2026).
The Block Engine speaks plain JSON-RPC over HTTPS — no Jito SDK is required.

## Endpoints

Base URL (global): `https://mainnet.block-engine.jito.wtf`

Regional hosts (lower latency, **independent per-region rate limits**) follow
`https://<region>.mainnet.block-engine.jito.wtf`:

`amsterdam` · `dublin` · `frankfurt` · `london` · `ny` · `slc` · `singapore` · `tokyo`

Testnet: `https://testnet.block-engine.jito.wtf`

> The region roster changes over time — don't hardcode beyond the global host
> without re-checking the docs.

## Path mapping (NOT uniform)

| Method | HTTP path |
|--------|-----------|
| `sendBundle` | `/api/v1/bundles` |
| `sendTransaction` | `/api/v1/transactions` |
| `getBundleStatuses` | `/api/v1/getBundleStatuses` |
| `getInflightBundleStatuses` | `/api/v1/getInflightBundleStatuses` |
| `getTipAccounts` | `/api/v1/getTipAccounts` |

`Content-Type: application/json`. JSON-RPC envelope: `{ "jsonrpc":"2.0", "id":1, "method":..., "params":... }`.

## Methods

### `sendBundle`
- **params:** `[ [tx1, tx2, … up to 5], { "encoding": "base64" } ]`
- Transactions are **fully-signed**, encoded as **base64 (recommended)** or base58 (slow, **DEPRECATED**).
- ⚠️ The `encoding` default is **base58**. When you send base64 strings you **must** pass `{ "encoding": "base64" }` explicitly, or they are mis-decoded.
- **result:** `bundle_id` (string) = SHA-256 of the bundle's transaction signatures.
- A result means **received, not landed.** You must poll status.
- A **tip** (SOL transfer to a tip account) must be present in one of the txns.

### `getInflightBundleStatuses` (fast, 5-minute lookback)
- **params:** `[ [bundleId, … up to 5] ]`  ← note the double-array nesting
- **result:** `{ context: { slot }, value: [ { bundle_id, status, landed_slot } ] }` — unwrap `.value` (same envelope as `getBundleStatuses`).
- `status`: `Invalid` (not in system / 5-min window expired) · `Pending` · `Failed` (all regions failed it) · `Landed`
- `landed_slot`: `u64 | null`

### `getBundleStatuses` (on-chain confirmation)
- **params:** `[ [bundleId, … up to 5] ]`
- **result:** `{ context: { slot }, value: [ { bundle_id, transactions, slot, confirmation_status, err } | null ] }`
- Fields are **snake_case**: `bundle_id`, `transactions`, `slot`, `confirmation_status`, `err`.
- `transactions`: array of base58 signatures — the actual landed, on-chain tx signatures.
- `confirmation_status`: `processed | confirmed | finalized`
- `err`: `{ "Ok": null }` on success, else a Solana `TransactionError`.
- A not-found / not-landed bundle's `value` entry is `null`.

### `getTipAccounts`
- **params:** `[]`
- **result:** array of 8 tip-account pubkey strings. Fetch at runtime; don't hardcode.

### `sendTransaction` (single-tx MEV-protected path — different from bundles)
- **params:** `[ encodedSignedTx, { "encoding": "base64" } ]`; proxy to Solana `sendTransaction`, always `skip_preflight=true`.
- Query `?bundleOnly=true` enables revert protection (sent as a 1-tx bundle).
- When sent as a bundle, the `bundle_id` comes back in the **`x-bundle-id`** response header (not the JSON body, not `x-bundle-auth`).
- Fee guidance for this path is a **70/30 priority-fee/tip split** — *unlike* `sendBundle`, where only the tip matters.

## Limits & auth
- **Rate limit:** 1 request/sec **per IP per region** (HTTP `429` on excess). Per-region, so spreading across regional hosts multiplies throughput.
- **Auth:** no approved key needed for default sends. Higher limits use an optional UUID via the `x-jito-auth: <uuid>` header or `?uuid=<uuid>` query.
- **Bundle size:** max **5 transactions**; max **5 bundle IDs** per status call.

## `simulateBundle`
Not a Block Engine method — it's a **Jito-Solana RPC node** method (alongside
`simulateTransaction`). Point it at a Jito-Solana RPC, not `mainnet.block-engine.jito.wtf`.

## SDKs (optional)
- `jito-js-rpc` — maintained JSON-RPC TS SDK.
- `jito-ts` — heavier gRPC SearcherClient (optional). Not needed for HTTP bundle sending.
- For `@solana/web3.js` v1.x users, raw `fetch` needs **no Jito dependency** at all.

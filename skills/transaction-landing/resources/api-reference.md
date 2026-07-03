# API Reference — Compute Budget, Fee Estimators, Sender & Confirmation RPCs

Lookup tables behind `../SKILL.md` ("Estimating the price", the submit decision table) and
`../docs/priority-fees.md` / `../docs/retries-and-confirmation.md`. Exact method names, params,
and response shapes — copy these, don't guess. For tutorial flow, read the `docs/` files; this is
pure reference.

## Version matrix

| Package | Version | Role |
|---|---|---|
| `@solana/web3.js` | **1.98.4** | Portable baseline client (v1 line) |
| `@solana/kit` | **7.0.0** | Modern client (v2 line, renamed web3.js) |
| `@solana-program/compute-budget` | **0.16.0** | Kit-native ComputeBudget instruction builders |
| `@solana-program/system` | **0.12.2** | Kit-native System program (incl. durable nonce) |

All fee estimators below return **micro-lamports per compute unit (µLamports/CU)** — *except*
QuickNode's `per_transaction`, which is total lamports. `1 lamport = 1,000,000 µLamports`.

---

## 1. ComputeBudget program instructions

Program ID `ComputeBudget111111111111111111111111111111`. A priority fee requires **both**
`setComputeUnitLimit` and `setComputeUnitPrice`; placement in the instruction array does not affect
correctness, but convention is to put them first.

| Instruction | web3.js 1.98.4 builder | kit 0.16.0 builder | Param | Effect |
|---|---|---|---|---|
| Set CU limit | `ComputeBudgetProgram.setComputeUnitLimit({ units })` | `getSetComputeUnitLimitInstruction({ units })` | `units: number` (u32) | Caps tx CU; the **multiplier** in the fee formula |
| Set CU price | `ComputeBudgetProgram.setComputeUnitPrice({ microLamports })` | `getSetComputeUnitPriceInstruction({ microLamports })` | `microLamports: number \| bigint` | **Bids** for priority (price per CU) |
| Request heap | `ComputeBudgetProgram.requestHeapFrame({ bytes })` | `getRequestHeapFrameInstruction({ bytes })` | `bytes: number` (≤ 262144) | Enlarge program heap, up to 256 KiB |
| Limit loaded data | — (**not in web3.js 1.98.4**) | `getSetLoadedAccountsDataSizeLimitInstruction({ accountDataSizeLimit })` | `accountDataSizeLimit: number` | Cap total loaded account bytes |
| (deprecated) request units | — | `getRequestUnitsInstruction({ ... })` | legacy | Superseded by `setComputeUnitLimit` |

Kit imports: `import { getSetComputeUnitLimitInstruction, getSetComputeUnitPriceInstruction, getRequestHeapFrameInstruction, getSetLoadedAccountsDataSizeLimitInstruction } from "@solana-program/compute-budget"; // 0.16.0`

### CU constants (verified from Anza agave `program-runtime/src/execution_budget.rs`)

| Constant | Value | Meaning |
|---|---|---|
| `MAX_COMPUTE_UNIT_LIMIT` | `1_400_000` | Hard CU cap per **transaction**; `setComputeUnitLimit` clamps to this |
| `DEFAULT_INSTRUCTION_COMPUTE_UNIT_LIMIT` | `200_000` | Default CU per **non-builtin** instruction when no limit ix is present (× #ixs, clamped to 1.4M) |
| `MAX_BUILTIN_ALLOCATION_COMPUTE_UNIT_LIMIT` | `3_000` | Per builtin instruction |
| `MAX_HEAP_FRAME_BYTES` | `262_144` (256 KiB) | Max `requestHeapFrame` |

### Fee math

```
priorityFeeLamports = ceil( microLamportsPerCU * computeUnitLimit / 1_000_000 )
totalFee            = 5_000 * numSignatures + priorityFeeLamports
```

Worked: `50_000 µL/CU × 200_000 CU / 1e6 = 10_000` lamports priority (0.00001 SOL).
Lowering the CU limit linearly lowers the fee for a fixed price — size the limit from simulation
(`../docs/priority-fees.md`), don't ship the 1.4M ceiling.

---

## 2. `getRecentPrioritizationFees` (native JSON-RPC)

Standard Solana RPC. Returns raw per-slot prioritization fees over ~150 recent slots; **does no
aggregation** — you compute a percentile/max yourself, scoped to your write-locked accounts.

| Field | Value |
|---|---|
| Method | `getRecentPrioritizationFees` |
| Params | `[ addresses?: string[] ]` — up to **128** account addresses (the **writable** accounts your tx locks) |
| web3.js | `connection.getRecentPrioritizationFees({ lockedWritableAccounts: PublicKey[] })` |
| Result | `Array<{ slot: number, prioritizationFee: number }>` — `prioritizationFee` in **µLamports/CU** |

```jsonc
// request
{ "jsonrpc":"2.0", "id":1, "method":"getRecentPrioritizationFees",
  "params": [ ["Ck1...writable", "9xQ...writable"] ] }   // <= 128 addresses
// result (truncated)
{ "result": [ { "slot": 348125, "prioritizationFee": 1234 }, { "slot": 348126, "prioritizationFee": 0 } ] }
```

```ts
const fees = await connection.getRecentPrioritizationFees({
  lockedWritableAccounts: [writableA, writableB], // PublicKey[]
});
const samples = fees.map((f) => f.prioritizationFee).filter((x) => x > 0).sort((a, b) => a - b);
const microLamports = Math.max(samples[Math.floor(samples.length * 0.75)] ?? 0, 1); // p75
```

---

## 3. Helius `getPriorityFeeEstimate`

JSON-RPC method sent to your Helius RPC URL. Provide **either** `transaction` (preferred — Helius
reads your exact write-locks) **or** `accountKeys`.

| Field | Value |
|---|---|
| URL | `https://mainnet.helius-rpc.com/?api-key=<KEY>` |
| Method | `getPriorityFeeEstimate` |
| Params | single object in the `params` array (below) |
| Returns | `µLamports/CU` |

**Params object:**

| Key | Type | Notes |
|---|---|---|
| `transaction` | string | Serialized tx (preferred). Most accurate — reflects exact write-locks |
| `accountKeys` | string[] | Alternative to `transaction`: just the accounts |
| `options.transactionEncoding` | `"Base58"` (default) \| `"Base64"` | Encoding of `transaction` |
| `options.priorityLevel` | enum (below) | Pick one percentile bucket |
| `options.includeAllPriorityFeeLevels` | boolean | `true` → return all levels in `priorityFeeLevels` |
| `options.lookbackSlots` | number `1..150` | Sample window |
| `options.includeVote` | boolean | Include vote txns in the sample |
| `options.recommended` | boolean | `true` → single congestion-adjusted value (~Medium/p50) |
| `options.evaluateEmptySlotAsZero` | boolean | Count empty slots as 0-fee (lowers estimate in calm periods); default not documented — assume `false` |

**`priorityLevel` enum → percentile:**

| Value | Percentile |
|---|---|
| `Min` | p0 |
| `Low` | p25 |
| `Medium` | p50 |
| `High` | p75 |
| `VeryHigh` | p90+ |
| `UnsafeMax` | p100 — **dangerous, can drain the wallet; avoid** |

**Request / response:**

```jsonc
// request
{ "jsonrpc":"2.0", "id":"1", "method":"getPriorityFeeEstimate",
  "params": [{
    "transaction": "<base58-or-base64 serialized tx>",   // OR "accountKeys": ["JUP6Lk...","..."]
    "options": {
      "transactionEncoding": "Base64",
      "priorityLevel": "High",
      "includeAllPriorityFeeLevels": false,
      "lookbackSlots": 150,
      "includeVote": true,
      "recommended": false,
      "evaluateEmptySlotAsZero": false
    }
  }] }

// response (single value — when priorityLevel/recommended used):
{ "result": { "priorityFeeEstimate": 1200.0 } }            // µLamports/CU

// response (all levels — when includeAllPriorityFeeLevels: true):
{ "result": { "priorityFeeLevels": {
  "min": 0, "low": 2, "medium": 10071, "high": 100000, "veryHigh": 1000000, "unsafeMax": 50000000 } } }
```

```ts
import bs58 from "bs58";
const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_KEY}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0", id: "1", method: "getPriorityFeeEstimate",
    params: [{ transaction: bs58.encode(vtx.serialize()), options: { priorityLevel: "High", transactionEncoding: "Base58" } }],
  }),
});
const { result } = await res.json();
const microLamports = Math.ceil(result.priorityFeeEstimate);
```

---

## 4. QuickNode `qn_estimatePriorityFees`

Solana Priority Fee add-on (must be enabled on the QuickNode endpoint).

| Field | Value |
|---|---|
| Method | `qn_estimatePriorityFees` |
| `params.last_n_blocks` | optional, default & **max 100** — blocks to analyze |
| `params.account` | optional — program/account to scope the estimate to |
| `params.api_version` | optional — `2` gives more accurately weighted data |

**Response:** `per_compute_unit.*` = **µLamports/CU**; `per_transaction.*` = **total lamports**;
`recommended` = congestion-adjusted µLamports/CU. Level ≈ percentile: `low`≈p25, `medium`≈p50,
`high`≈p75, `extreme`≈p90.

```jsonc
// request
{ "jsonrpc":"2.0", "id":1, "method":"qn_estimatePriorityFees",
  "params": [{ "last_n_blocks": 100, "account": "JUP6Lk...", "api_version": 2 }] }
// response (truncated)
{ "result": {
  "context": { "slot": 335501774 },
  "per_compute_unit": { "extreme": 1432990, "high": 615532, "medium": 89430, "low": 36050, "percentiles": {} },
  "per_transaction": { "extreme": 309996858926, "high": 78616978104, "medium": 19888064000, "low": 4999945143, "percentiles": {} },
  "recommended": 877892
} }
```

Use `per_compute_unit.<level>` or `recommended` as `microLamports`. **Do not** feed `per_transaction`
into `setComputeUnitPrice` — it is total lamports, not per-CU.

---

## 5. Helius Sender (low-latency dual-route submission)

Submits in parallel to Helius staked/SWQoS validator connections **and** the Jito MEV auction to
maximize inclusion. No API key required; **consumes 0 API credits** even on the free tier.

| Endpoint | Host | Use |
|---|---|---|
| Global (frontend) | `https://sender.helius-rpc.com/fast` | HTTPS, auto-routes to nearest region; browser-safe (no CORS preflight) |
| Global health | `https://sender.helius-rpc.com/ping` | Liveness |
| Salt Lake City | `http://slc-sender.helius-rpc.com/fast` | Backend, pick nearest |
| Newark | `http://ewr-sender.helius-rpc.com/fast` | Backend |
| London | `http://lon-sender.helius-rpc.com/fast` | Backend |
| Frankfurt | `http://fra-sender.helius-rpc.com/fast` | Backend |
| Amsterdam | `http://ams-sender.helius-rpc.com/fast` | Backend |
| Singapore | `http://sg-sender.helius-rpc.com/fast` | Backend |
| Tokyo | `http://tyo-sender.helius-rpc.com/fast` | Backend |

Each regional host also exposes `/ping`. Append `?api-key=<KEY>` only to request higher rate limits;
append `?swqos_only=true` for SWQoS-only routing (skips the Jito leg, lower min tip).

**Rules (all mandatory for dual-route mode):**

| Rule | Value |
|---|---|
| Jito tip | **≥ 0.001 SOL = 1,000,000 lamports** — `SystemProgram.transfer` to a Jito tip account, **in the same tx** |
| Jito tip (`?swqos_only=true`) | **≥ 0.000005 SOL = 5,000 lamports** |
| Priority fee | **Required** — a `setComputeUnitPrice` ix (the tip buys auction access; the priority fee improves validator queue position) |
| `skipPreflight` | **`true`** (mandatory) |
| `maxRetries` | **`0`** (you own retries) |
| Rate limit | **~50 TPS per region** per Helius docs (verify current quota before relying on an exact number) |

**Request** (same JSON-RPC `sendTransaction` shape; tx must already contain `setComputeUnitLimit` +
`setComputeUnitPrice` + a ≥1,000,000-lamport (0.001 SOL) Jito tip transfer, signed and base64-serialized):

```ts
await fetch("https://sender.helius-rpc.com/fast", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "sendTransaction",
    params: [base64Tx, { encoding: "base64", skipPreflight: true, maxRetries: 0 }],
  }),
});
```

Jito tip accounts, the `tip_floor` sizing API, and Jito block-engine regions are in
`./jito-endpoints.md`.

---

## 6. Blockhash & confirmation RPCs

### `getLatestBlockhash`

| Field | Value |
|---|---|
| Method | `getLatestBlockhash` |
| Params | `[{ commitment?, minContextSlot? }]` |
| web3.js | `connection.getLatestBlockhash(commitment)` |
| Result | `{ context: { slot }, value: { blockhash: string, lastValidBlockHeight: number } }` |

```jsonc
{ "result": { "context": { "slot": 348126 },
  "value": { "blockhash": "EkSn...", "lastValidBlockHeight": 348276 } } }
```

`lastValidBlockHeight` is the **expiry height** — stop retrying once `getBlockHeight()` exceeds it.

### `isBlockhashValid`

| Field | Value |
|---|---|
| Method | `isBlockhashValid` |
| Params | `[ blockhash: string, { commitment?, minContextSlot? } ]` |
| web3.js | `connection.isBlockhashValid(blockhash, { commitment })` → `RpcResponseAndContext<boolean>` |
| Result | `{ context: { slot }, value: boolean }` — `true` while the blockhash is still processable |

```jsonc
{ "jsonrpc":"2.0", "id":1, "method":"isBlockhashValid",
  "params": [ "EkSn...", { "commitment": "confirmed" } ] }
{ "result": { "context": { "slot": 348200 }, "value": true } }
```

A direct liveness probe for a blockhash you already hold. The canonical expiry check in the
rebroadcast loop is still `getBlockHeight() > lastValidBlockHeight` (monotonic, one call); use
`isBlockhashValid` when you have only a blockhash and not its `lastValidBlockHeight`.

### `getSignatureStatuses`

| Field | Value |
|---|---|
| Method | `getSignatureStatuses` |
| Params | `[ signatures: string[] (≤256), { searchTransactionHistory?: boolean } ]` |
| web3.js | `connection.getSignatureStatuses([sig], { searchTransactionHistory })` |
| Result | `{ context, value: Array<null \| { slot, confirmations, err, confirmationStatus }> }` |

`confirmationStatus` ∈ `"processed" | "confirmed" | "finalized"`. `value[i]` is `null` if the sig is
unknown to the node's recent status cache. `searchTransactionHistory: true` (default `false`) also
scans older history — slower, but a definitive "did this ever land?" answer.

```jsonc
{ "result": { "context": { "slot": 348200 },
  "value": [ { "slot": 348190, "confirmations": 10, "err": null, "confirmationStatus": "confirmed" } ] } }
```

### `getBlockHeight`

| Field | Value |
|---|---|
| Method | `getBlockHeight` |
| Params | `[{ commitment?, minContextSlot? }]` |
| web3.js | `connection.getBlockHeight(commitment)` → `number` |
| Result | current block height (u64) |

Compare against `lastValidBlockHeight` to detect expiry. Block height counts produced blocks and is
**not** the same as slot number (slots can be skipped).

---

## References

- Solana RPC — `getRecentPrioritizationFees`: https://solana.com/docs/rpc/http/getrecentprioritizationfees
- Solana RPC — `getLatestBlockhash`: https://solana.com/docs/rpc/http/getlatestblockhash
- Solana RPC — `isBlockhashValid`: https://solana.com/docs/rpc/http/isblockhashvalid
- Solana RPC — `getSignatureStatuses`: https://solana.com/docs/rpc/http/getsignaturestatuses
- Solana RPC — `getBlockHeight`: https://solana.com/docs/rpc/http/getblockheight
- Helius — `getPriorityFeeEstimate`: https://www.helius.dev/docs/sending-transactions/priority-fees
- Helius API Reference — `getPriorityFeeEstimate`: https://helius.mintlify.app/api-reference/priority-fee/getpriorityfeeestimate
- Helius — Sender (ultra-low-latency submission): https://www.helius.dev/docs/sending-transactions/sender
- Helius — Sender FAQs (rate limit, tip + priority fee both required, 0 credits): https://helius.mintlify.app/faqs/sender
- QuickNode — `qn_estimatePriorityFees`: https://www.quicknode.com/docs/solana/qn_estimatePriorityFees
- Anza agave — compute budget constants (`execution_budget.rs`): https://github.com/anza-xyz/agave/blob/master/program-runtime/src/execution_budget.rs

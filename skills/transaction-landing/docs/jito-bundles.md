# Jito Bundles & Low-Latency Send

The deep dive behind the SKILL.md "Jito bundles" section. Covers what a bundle guarantees, how to size and place the tip, the full `sendBundle` / `sendTransaction` / status request-response shapes, the single-tx revert-protection path, rate limits, the dual-submission trap, SDKs, a complete runnable example, and ShredStream. Regional URLs, tip accounts, and status enums are tabulated in `resources/jito-endpoints.md` — this doc links there rather than duplicating them.

All TypeScript targets **`@solana/web3.js` 1.98.4** with **`@solana/kit` 7.0.0** notes. **Jito is mainnet/testnet only — there is no devnet Block Engine.**

---

## What a bundle is

A **bundle** is a list of **up to 5 fully-signed transactions** that the Block Engine submits to the current leader with four guarantees:

| Property | Meaning |
|---|---|
| **Sequential** | The txns execute in the exact order you list them. |
| **Atomic** | All execute within the **same slot** (same block). |
| **All-or-nothing** | If **any** txn fails, **none** are committed — there is no partial execution. |
| **Tipped** | The bundle must pay a Jito **tip** or it is dropped (see below). |

Compared with a normal `sendTransaction`, a bundle trades raw throughput for **ordering and atomicity**. The Block Engine simulates the bundle before forwarding; if simulation fails the bundle is dropped and **nothing lands** (you pay nothing). Inclusion is won by the **tip auction**, not by your per-tx priority fee.

### When to reach for a bundle

- **Atomic multi-tx** — e.g. a swap + a repay that must both land or neither (cross-instruction invariants that exceed one tx's size/CU limit).
- **MEV / revert protection** — wrap a single tx as a one-tx bundle (`bundleOnly=true`); it only commits if it succeeds, so a reverting tx costs nothing and cannot be sandwiched into a bad fill.
- **Ordering-sensitive plays** — you need txns in a guaranteed order inside one slot, ahead of the open market.

For a single, independent, non-atomic tx, a **plain priority fee with manual rebroadcast** (see `docs/retries-and-confirmation.md`) is simpler and usually sufficient. Use the SKILL.md decision table to choose.

---

## The tip

Every bundle must include a **tip**: an instruction that transfers SOL to **one of the 8 tip accounts**. Rules:

- **Minimum 1,000 lamports** — but that is a floor, not a competitive amount. Size from the **tip-floor API** (below).
- **Pick the tip account at random** per submission. All 8 are write-locked when tipped; always hitting the same one serializes your bundles behind that lock. **Fetch the set at runtime via `getTipAccounts`** — it can rotate (current snapshot + program ID in `resources/jito-endpoints.md`).
- **Place the tip in the LAST transaction** of the bundle. Rationale: with all-or-nothing atomicity the tip only lands if the whole bundle lands, so the work executes before you commit the tip — and it is the canonical pattern Jito and searchers use.
- The tip must be **inside the bundle**. A tip sent as a separate, non-bundled tx is **not credited**, and the bundle is dropped for having no tip.

### Sizing the tip from `tip_floor`

```ts
// Percentile values are in SOL — multiply by 1e9 for lamports.
async function tipLamportsFromFloor(): Promise<number> {
  const res = await fetch("https://bundles.jito.wtf/api/v1/bundles/tip_floor");
  const [floor] = await res.json(); // REST returns a 1-element array
  const sol = floor.landed_tips_75th_percentile as number; // p75 baseline
  return Math.max(1_000, Math.ceil(sol * 1e9)); // never below the 1,000-lamport floor
}
```

Baseline at the **75th percentile**; scale toward the 95th/99th during token launches and liquidation cascades. A live WebSocket stream is available at `wss://bundles.jito.wtf/api/v1/bundles/tip_stream` (same fields) if you want push updates instead of polling.

### Building the tip instruction

```ts
// web3.js 1.98.4 — tip is the LAST instruction of the LAST tx in the bundle.
import { SystemProgram, PublicKey } from "@solana/web3.js";

const tipIx = SystemProgram.transfer({
  fromPubkey: payer.publicKey,
  toPubkey: new PublicKey(tipAccount), // random of the 8 from getTipAccounts
  lamports: tipLamports,               // >= 1000; sized from tip_floor
});
```

```ts
// @solana/kit 7.0.0 equivalent — from @solana-program/system 0.12.2
import { getTransferSolInstruction } from "@solana-program/system";
import { address, lamports } from "@solana/kit";

const tipIx = getTransferSolInstruction({
  source: payerSigner,
  destination: address(tipAccount),
  amount: lamports(BigInt(tipLamports)),
});
```

---

## `sendBundle`

Submit **1–5 fully-signed** transactions. Params are `[ [<encoded txns>], { "encoding": "base64" } ]` — `"base64"` is recommended (`"base58"` is deprecated). The result is a **bundle ID** (a sha-256 hash string), not a transaction signature.

```json
// Request → POST https://<region>.mainnet.block-engine.jito.wtf/api/v1/bundles
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "sendBundle",
  "params": [
    ["AT2Aqtlok...base64-tx-1...", "B92ffd0p...base64-tx-2..."],
    { "encoding": "base64" }
  ]
}
```
```json
// Response — result is the bundle_id
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": "2id3YC2jK9G5Wo2phDx4gJVAew8DcY5NAojnVuao8rkxwPYPe8cSwE5GzhEgJA2y8fVjDEo6iR6ykBvDxrTQrtpb"
}
```

**Gotchas:**

- **No tip / tip below 1,000 lamports** → bundle rejected. Size from `tip_floor`.
- **>5 transactions** → rejected. Split work across slots, or compress instructions.
- **Duplicate transaction** (same signature twice in one bundle) → rejected.
- **Stale blockhash** → bundles expire like any tx; use a fresh `getLatestBlockhash` and capture `lastValidBlockHeight` as the hard timeout.
- **Block-engine simulation failure** → bundle silently dropped (nothing lands, you pay nothing). Validate client-side first.

---

## Single-tx path: `sendTransaction` (Jito) + `bundleOnly`

A drop-in alternative to a normal RPC `sendTransaction` that routes one tx through Jito for MEV protection. Endpoint: `POST .../api/v1/transactions`.

- By default it submits the tx **with MEV protection**.
- **`?bundleOnly=true`** wraps the tx as a **single-transaction bundle**, giving **revert protection** — the tx only lands if it succeeds; a revert is not committed and costs nothing.
- **This path ALWAYS forces `skip_preflight=true`** server-side — the tx is *not* simulated by the RPC before forwarding. **You must simulate client-side first** or you risk burning fees on a guaranteed-fail tx (and the failure semantics differ between plain and `bundleOnly`).
- The tx still needs a **Jito tip** instruction (same 8 accounts) to be prioritized. For this single-tx path Jito suggests roughly a **70/30 split** — ~70% of your spend to the priority fee (`setComputeUnitPrice`), ~30% to the Jito tip. (For a true `sendBundle`, only the tip matters for inclusion.)
- Params mirror standard `sendTransaction`: `[ "<base64-tx>", { "encoding": "base64" } ]`. The result is the **transaction signature** (base58), not a bundle ID.

```json
// Request → POST .../api/v1/transactions?bundleOnly=true
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "sendTransaction",
  "params": [ "<base64-encoded-signed-tx>", { "encoding": "base64" } ]
}
// Response result = the transaction signature (base58 string)
```

---

## Status methods

Two methods, both accepting an array of **up to 5 bundle IDs** and wrapping results in `result.value`. Enum/field details are tabulated in `resources/jito-endpoints.md`.

### `getInflightBundleStatuses` — cheap live polling (5-minute window)

`status` is one of `Invalid` (unseen in the 5-min window), `Pending` (neither failed nor landed), `Failed` (failed across all regions), `Landed` (confirmed on-chain). `landed_slot` is the slot if landed, else `null`.

```json
{ "jsonrpc": "2.0", "id": 1, "method": "getInflightBundleStatuses",
  "params": [ ["<bundleId1>", "<bundleId2>"] ] }
```

### `getBundleStatuses` — confirmed detail

Per bundle: `transactions` (base58 signatures), `slot`, `confirmation_status` (`processed` | `confirmed` | `finalized`), `err`.

```json
{ "jsonrpc": "2.0", "id": 1, "method": "getBundleStatuses",
  "params": [ ["<bundleId1>"] ] }
```

**Recommended pattern:** poll `getInflightBundleStatuses` every ~1–2 s until `Landed`/`Failed`; on `Landed`, call `getBundleStatuses` (or just confirm the tx signatures via your own RPC) for the final `confirmation_status`. **Always also enforce blockhash expiry as the hard timeout** — once `getBlockHeight() > lastValidBlockHeight`, the bundle can never land; rebuild with a fresh blockhash.

---

## Rate limits & authentication

- Default: **1 request / second / IP / region**, free, no auth. Exceeding returns HTTP **429**.
- Raise it with a **UUID** (granted via a Jito Discord ticket): header `x-jito-auth: <uuid>` or query param `?uuid=<uuid>`.
- A naive fan-out to all regions at >1 req/s/IP trips 429s — throttle per region, or submit to one nearby region and rely on Jito's internal forwarding.

---

## Dual-submission caveat

- **Do not blindly send the same signed tx to both Jito and a normal RPC** when you rely on `bundleOnly`/bundle revert protection. If the public RPC lands it first, it can land **without** the protection (and outside the atomic group) — defeating the purpose.
- For maximum landing of a *plain* (non-atomic-critical) tx, hedging across Jito + a staked/Sender RPC is a known tactic, but accept that revert/atomicity guarantees no longer hold. Decide based on whether atomicity actually matters for the use case.
- **Never duplicate a transaction within a single bundle** — same signature twice → the bundle is rejected.

---

## SDKs

Raw `fetch` is the most portable path (zero dependencies, browser-safe). The thin `jito-js-rpc` **0.2.2** client (`JitoJsonRpcClient`) wraps the same JSON-RPC; `jito-ts` **4.2.1** is a heavier gRPC/searcher toolkit and overkill for send-bundle. Versions are tabulated in `resources/jito-endpoints.md`.

```ts
// jito-js-rpc 0.2.2 — note the baseUrl is the /api/v1 prefix (no /bundles suffix); "" = no UUID.
import { JitoJsonRpcClient } from "jito-js-rpc";

const jito = new JitoJsonRpcClient("https://mainnet.block-engine.jito.wtf/api/v1", "");

const tips = await jito.getTipAccounts();
const tipAccount = tips.result[Math.floor(Math.random() * tips.result.length)];

// txns: base64-encoded fully-signed txs, tip in the LAST one.
const { result: bundleId } = await jito.sendBundle([txns, { encoding: "base64" }]);
const status = await jito.getInflightBundleStatuses([[bundleId]]);
```

---

## Complete runnable example

End-to-end: fetch tip accounts → pick one at random → size the tip from `tip_floor` → build a 2-tx bundle (a work tx + a last tx carrying the tip) → base64-encode → `POST sendBundle` (raw `fetch`) → poll status to `Landed`/`Failed` with `lastValidBlockHeight` as the hard stop. Compiles against `@solana/web3.js` 1.98.4.

```ts
// deps: @solana/web3.js@1.98.4
// Run on MAINNET (or testnet). There is no Jito on devnet.
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

const RPC = process.env.RPC_URL!;                       // your mainnet RPC (for blockhash + confirm)
const ENGINE = "https://ny.mainnet.block-engine.jito.wtf/api/v1"; // region nearest your server
const payer = Keypair.fromSecretKey(/* load your secret key */ new Uint8Array());

const connection = new Connection(RPC, "confirmed");

// Minimal JSON-RPC helper against the /bundles path.
const bundleRpc = (method: string, params: unknown[]) =>
  fetch(`${ENGINE}/bundles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }).then((r) => r.json());

async function main() {
  // 1. Fetch tip accounts at runtime (they can rotate) and pick one at random.
  const tips = await bundleRpc("getTipAccounts", []);
  const tipAccount: string = tips.result[Math.floor(Math.random() * tips.result.length)];

  // 2. Size the tip from the tip-floor API (p75 baseline; values are SOL → lamports).
  const [floor] = await fetch("https://bundles.jito.wtf/api/v1/bundles/tip_floor").then((r) => r.json());
  const tipLamports = Math.max(1_000, Math.ceil((floor.landed_tips_75th_percentile as number) * 1e9));

  // 3. Fresh blockhash — capture lastValidBlockHeight as the hard timeout.
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");

  // 4a. Work tx (replace with your real instructions; a self-transfer stands in here).
  const workTx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions: [
        SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: payer.publicKey, lamports: 1 }),
      ],
    }).compileToV0Message(),
  );

  // 4b. LAST tx — carries the Jito tip transfer.
  const tipTx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions: [
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: new PublicKey(tipAccount),
          lamports: tipLamports,
        }),
      ],
    }).compileToV0Message(),
  );

  // 5. Sign every tx, then base64-encode (tip is in the LAST element).
  workTx.sign([payer]);
  tipTx.sign([payer]);
  const encoded = [workTx, tipTx].map((t) => Buffer.from(t.serialize()).toString("base64"));

  // 6. Submit the bundle.
  const { result: bundleId } = await bundleRpc("sendBundle", [encoded, { encoding: "base64" }]);
  console.log("bundle_id:", bundleId);

  // 7. Poll until Landed/Failed, with lastValidBlockHeight as the hard stop.
  for (;;) {
    const { result } = await bundleRpc("getInflightBundleStatuses", [[bundleId]]);
    const status: string | undefined = result?.value?.[0]?.status; // Invalid | Pending | Failed | Landed
    if (status === "Landed") {
      const detail = await bundleRpc("getBundleStatuses", [[bundleId]]);
      console.log("landed:", detail.result.value[0]);
      return;
    }
    if (status === "Failed" || status === "Invalid") throw new Error(`bundle ${status}`);
    if ((await connection.getBlockHeight()) > lastValidBlockHeight) throw new Error("bundle expired — rebuild with a fresh blockhash");
    await new Promise((r) => setTimeout(r, 1_500)); // respect the 1 req/s/region limit
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
```

A standalone copy of this flow ships as `examples/jito-bundle.ts`.

---

## ShredStream (brief)

ShredStream delivers the **lowest-latency shreds** (the fragments a block is split into) straight from leaders — saving hundreds of milliseconds versus waiting for full blocks, plus redundant shred paths for reliability. You run the **ShredStream Proxy**, which connects to a Block Engine and fans shreds to your `DEST_IP_PORTS`. It requires an **approved (allowlisted) Solana pubkey**, open **UDP port 20000**, and `BLOCK_ENGINE_URL` + `DESIRED_REGIONS` (≤2) + `DEST_IP_PORTS` config; deploy via the Rust binary or Docker (host networking). Region slugs differ from HTTP hosts (e.g. `salt-lake-city` vs `slc`) — see `resources/jito-endpoints.md`. Use cases: HFT/searchers, validators wanting faster block reception, low-latency geyser/RPC. Docs: https://docs.jito.wtf/lowlatencytxnfeed/

---

## Common Errors

### Error: Bundle dropped / never lands (no status or `Failed`)
**Cause:** Tip below the live floor (1,000 lamports is the *minimum*, not competitive), tip sent as a separate non-bundled tx (not credited), tip not in the last tx, >5 txns, a duplicate tx, or block-engine simulation failed.
**Solution:** Put the tip **inside the bundle's last tx**, sized from `tip_floor` (≥75th percentile during congestion); randomize the tip account; keep ≤5 distinct, fully-signed txns with a fresh blockhash; validate client-side before submitting.

### Error: HTTP 429 from the Block Engine
**Cause:** More than 1 request/second/IP for that region — usually a fan-out submitting to every region at once.
**Solution:** Throttle to ≤1 req/s/region (the example sleeps 1.5 s between polls), submit to a single nearby region and rely on internal forwarding, or request a UUID via Jito Discord and pass `x-jito-auth`.

### Error: `bundleOnly` tx lands via the public RPC without protection
**Cause:** The same signed tx was also broadcast to a normal RPC, which included it first — outside the atomic/revert guarantees.
**Solution:** When relying on `bundleOnly`/bundle atomicity, submit **only** through Jito. Hedge across paths only for plain txns where atomicity does not matter.

### Error: Preflight assumptions on the `/transactions` path
**Cause:** The Jito `sendTransaction` path **force-sets `skip_preflight=true`**; a tx that would have been caught by preflight is forwarded anyway and can burn fees on failure.
**Solution:** Always `simulateTransaction` client-side before submitting to `/api/v1/transactions`. See `docs/retries-and-confirmation.md`.

### Error: Bundle "expired"
**Cause:** Block height passed `lastValidBlockHeight` before the bundle landed — bundles expire exactly like normal txns.
**Solution:** Treat expiry as the hard timeout, not a wall-clock timer. Rebuild with a fresh blockhash (and a higher tip if congested) and resubmit.

---

## References

- Jito — Low-Latency Transaction Send (bundles, tips, status, regions, auth): https://docs.jito.wtf/lowlatencytxnsend/
- Jito — Low-Latency Block Updates / ShredStream: https://docs.jito.wtf/lowlatencytxnfeed/
- Jito MEV GitBook — Bundles: https://jito-labs.gitbook.io/mev/searcher-resources/bundles
- Jito MEV GitBook — Mainnet addresses (regional URLs, tip program): https://jito-labs.gitbook.io/mev/searcher-resources/block-engine/mainnet-addresses
- Tip-floor API: https://bundles.jito.wtf/api/v1/bundles/tip_floor
- QuickNode — Jito Bundles guide: https://www.quicknode.com/guides/solana-development/transactions/jito-bundles
- Endpoint/address/enum lookup tables: `resources/jito-endpoints.md`
- Confirmation, expiry & rebroadcast: `docs/retries-and-confirmation.md`
- Priority-fee sizing for the 70/30 single-tx path: `docs/priority-fees.md`
</content>

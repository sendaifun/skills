# Jito tips — accounts, sizing & economics

Verified against <https://docs.jito.wtf/lowlatencytxnsend/> and the live
tip-floor feed (June 2026).

## What the tip is
A **tip is mandatory** for a bundle to be considered by the auction. It is just a
**SOL transfer to one of 8 Jito tip accounts**, included as an instruction
(top-level or CPI) inside one of the bundle's transactions.

- The transfer **source (`fromPubkey`) must sign** the transaction it lands in.
- **For `sendBundle`, only the tip wins the auction** — the Solana priority fee
  does *not* factor into bundle selection. (You may still add ComputeBudget
  priority-fee instructions for on-chain CU pricing, but they don't help you
  *land the bundle*.)

## The 8 tip accounts
Fetch them at runtime with `getTipAccounts` and **pick one at random per bundle**
to spread write-lock contention. Treat the list below as a cache/fallback only —
Jito may rotate it.

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

## Sizing the tip

- **Minimum:** 1,000 lamports. This is an *acceptance floor*, not a landing
  guarantee — under contention it is usually too low to win.
- **Tip-floor feed (recommended):**
  - REST: `GET https://bundles.jito.wtf/api/v1/bundles/tip_floor`
  - WebSocket: `wss://bundles.jito.wtf/api/v1/bundles/tip_stream`
  - Returns one object with: `landed_tips_25th_percentile`,
    `landed_tips_50th_percentile`, `landed_tips_75th_percentile`,
    `landed_tips_95th_percentile`, `landed_tips_99th_percentile`,
    `ema_landed_tips_50th_percentile`.

### ⚠️ The unit trap (most common correctness bug)
The tip-floor percentiles are expressed in **SOL** (decimal floats), **not
lamports**. You **must** multiply by `LAMPORTS_PER_SOL` (1e9):

```ts
const [floor] = await (await fetch("https://bundles.jito.wtf/api/v1/bundles/tip_floor")).json();
const ema50Sol = floor.ema_landed_tips_50th_percentile;        // e.g. 0.0000099 SOL
const tipLamports = Math.max(Math.ceil(ema50Sol * 1e9), 1000); // <-- *1e9, then floor at 1000
```

Feeding the raw float (`0.0000099`) into `SystemProgram.transfer`'s `lamports`
underpays by ~1e9× and the bundle never lands.

**Rule of thumb:** `ema_landed_tips_50th_percentile` is a cheap baseline;
use the 75th/95th percentile when you genuinely need to compete.

## Placement
Put the tip in the **last transaction** of the bundle, ideally folded into the
**same tx that runs your real logic**. Because bundles are atomic, if your work
fails the whole bundle is rejected and the tip is never paid — placement doesn't
change that, but a standalone tip-only tx increases "uncle bandit" exposure, so
prefer embedding it. The 5-transaction cap **includes** a dedicated tip tx if you
use one, so folding the tip into a real tx also saves a slot.

# Compute Units — Right-Sizing the CU Limit

## Why it matters

Two numbers govern what a transaction pays beyond the 5,000-lamport base fee:

```
priority fee (lamports) = ceil( computeUnitPrice (microLamports) × computeUnitLimit / 1_000_000 )
```

- **`computeUnitLimit`** — how many CUs you reserve. Default when unset: `200,000 × number_of_instructions`, capped at `1,400,000`.
- **`computeUnitPrice`** — microLamports paid per CU (see [priority-fees.md](priority-fees.md)).

The limit cuts both ways:

- **Too low** → the runtime aborts mid-execution with a compute error and the transaction **fails on-chain** (you still pay the base fee).
- **Too high** → you **overpay** (fee scales with the limit) *and* schedulers deprioritize you, because requesting CUs close to actual usage is itself a priority signal.

**Never ship the default.** Simulate, then set a tight limit with a small margin.

## Simulation-based estimation

```typescript
import {
  Connection, ComputeBudgetProgram, TransactionMessage,
  VersionedTransaction, Keypair, TransactionInstruction,
} from '@solana/web3.js';

async function estimateComputeUnits(
  connection: Connection,
  payer: Keypair,
  instructions: TransactionInstruction[],
): Promise<number> {
  // Build a probe tx with the MAX limit so simulation never aborts early.
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  const probe = new VersionedTransaction(
    new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
        ...instructions,
      ],
    }).compileToV0Message(),
  );
  probe.sign([payer]);

  const sim = await connection.simulateTransaction(probe, {
    replaceRecentBlockhash: true,  // simulate against a fresh slot; ignore staleness
    sigVerify: false,              // don't require valid sigs to simulate
  });

  if (sim.value.err) {
    throw new Error(`Simulation failed: ${JSON.stringify(sim.value.err)}\n${sim.value.logs?.join('\n')}`);
  }

  const used = sim.value.unitsConsumed ?? 200_000;
  // +10% margin absorbs run-to-run variance; floor 1,000; cap 1.4M.
  return Math.min(1_400_000, Math.max(1_000, Math.ceil(used * 1.1)));
}
```

### Why the margin
On-chain CU consumption is not perfectly deterministic across slots — account state, sysvar reads, and CPI depth shift it slightly. A 10% margin is the common production default. For transactions whose CU usage depends on variable input (e.g. a swap that routes through a different number of pools), simulate the *actual* instructions you'll send, not a representative one.

## Instruction ordering (required)

The compute-budget instructions must precede your application instructions:

```typescript
const instructions = [
  ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),  // 1st
  ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),        // 2nd
  ...applicationInstructions,                                         // then your logic
  // ...optional Jito tip transfer LAST (see escalation.md)
];
```

Include **each compute-budget instruction at most once**. A duplicate `setComputeUnitLimit` (e.g. one in your app instructions and one in a wrapper) makes only the first take effect and wastes space — a common, silent bug.

## @solana/kit equivalent

```typescript
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from '@solana-program/compute-budget';

const m = pipe(
  createTransactionMessage({ version: 0 }),
  (m) => setTransactionMessageFeePayerSigner(signer, m),
  (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
  (m) => appendTransactionMessageInstruction(getSetComputeUnitLimitInstruction({ units: computeUnits }), m),
  (m) => appendTransactionMessageInstruction(getSetComputeUnitPriceInstruction({ microLamports }), m),
  // ...append application instructions
);
```

`@solana/kit` also ships `estimateComputeUnitLimitFactory({ rpc })`, which wraps the simulate-and-pad flow above — prefer it when you're already on kit.

## Cost intuition

A transaction requesting **200,000 CU at 100,000 microLamports/CU** pays `200_000 × 100_000 / 1e6 = 20,000` lamports in priority fee. The *same* work right-sized to **50,000 CU** pays `5,000` lamports — **4× cheaper** for strictly better priority. Right-sizing is the highest-leverage thing you can do for cost.

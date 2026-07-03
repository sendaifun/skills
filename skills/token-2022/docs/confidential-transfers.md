# Confidential Transfers (Token-2022)

Hide the **amount** of a Token-2022 transfer on-chain using twisted-ElGamal encryption and
Pedersen commitments, verified by the native **ZK ElGamal Proof program**. Sender and receiver stay
public; only the value is encrypted. An optional **auditor** key lets a designated party decrypt
amounts for compliance.

This is the deep dive behind the `ConfidentialTransferMint` bullet in
[SKILL.md](../SKILL.md#key-extensions-tour) and the "confidential transfer fails / proof program
unavailable" entry in its Common Errors. Read SKILL.md first for the extension model and program ids.

---

## Read this first: verify the feature gate per cluster

Confidential transfers depend on the **ZK ElGamal Proof program**
(`ZkE1Gama1Proof11111111111111111111111111111`). That program has been **disabled and re-enabled**
within the last year, so availability is **date- and cluster-dependent**. Do not assume it is live —
check the feature gate for the exact cluster/epoch you target before shipping.

| Date | Event |
|---|---|
| 2025-04 | Soundness bug found in the ZK ElGamal Proof program (a Fiat-Shamir transcript was missing a component, breaking proof soundness). |
| 2025-06-11 | Token-2022 patched to **disable** `ConfidentialTransfer`, `ConfidentialTransferFee`, `ConfidentialMint/Burn`. |
| 2025-06-19 | ZK ElGamal Proof program **disabled** via feature gate at the start of mainnet-beta **epoch 805** (~06:00 UTC) as a precaution while audits ran. |
| 2025–2026 | Re-audited (Code4rena, Least Authority, ZkSecurity, Trail of Bits, Qedit); hardened. |
| 2026-04-21 | Re-enabled on **testnet + devnet**. |
| 2026-05-08 | Updated Token-2022 program with confidential transfers shipped to testnet/devnet. |
| 2026-06-29 | Maintainers confirm confidential transfers are **live on mainnet-beta** (`solana-program/token-2022#657`). |

**Bottom line (as of mid-2026):** confidential transfers and the ZK ElGamal Proof program are
**re-enabled on mainnet-beta, devnet, and testnet**. Treat this as time-sensitive: confirm the gate
yourself. During the disable window, major stablecoins (PYUSD, AUSD, USDG) had the extension
*initialized* on their mints but never *activated* for end users.

Check whether the proof program is callable on your cluster:

```bash
# The program account exists on every cluster; what matters is whether the feature gate that
# ENABLES it is active. Inspect features and look for the zk-elgamal-proof enablement gate.
solana feature status --url mainnet-beta | grep -i "elgamal\|zk"

# Or just probe it: a confidential op will fail fast with an "invalid instruction" / program-disabled
# error if the gate is off. Always test on devnet first.
solana program show ZkE1Gama1Proof11111111111111111111111111111 --url devnet
```

---

## SDK reality: `@solana/spl-token` cannot do this

**`@solana/spl-token` 0.4.14 has NO confidential-transfer module.** Its `extensions/` directory ships
`transferFee`, `transferHook`, `metadataPointer`, `interestBearingMint`, `pausable`, `cpiGuard`,
`defaultAccountState`, `permanentDelegate`, `scaledUiAmount`, and more — but **nothing for confidential
transfers**. There is no `createConfigureAccountInstruction` / `createDepositInstruction` in that
package. Do not reach for it here.

| Path | Package(s) | When to use |
|---|---|---|
| **kit (recommended for JS)** | `@solana-program/token-2022` **0.12.0** + `@solana/zk-sdk` **0.4.2** | New TypeScript code. First-class confidential helpers + WASM proof generation. |
| **Rust** | `spl-token-2022` **11.0.0** + `spl-token-confidential-transfer-proof-generation` **0.6.1** + `-proof-extraction` **0.6.1** | On-chain / backend Rust; full control of proof building. |
| **CLI** | `spl-token` CLI **v5.6.1** | Quick manual testing, ops, demos. |

The rest of this guide uses the **kit path**. The `@solana/zk-sdk` package is a WASM module that
generates the ElGamal/AES keys and the zero-knowledge proofs in the browser or Node; the
`@solana-program/token-2022` client builds the Token-2022 + proof-program instructions around them.

---

## The two programs and the encryption model

Every confidential operation touches **two** programs:

1. **Token-2022** (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`) — owns the mint/accounts and the
   `ConfidentialTransferMint` / `ConfidentialTransferAccount` extension state.
2. **ZK ElGamal Proof program** (`ZkE1Gama1Proof11111111111111111111111111111`) — a native program
   that verifies twisted-ElGamal / Pedersen proofs. Token-2022 never trusts a raw proof; it references
   the *result* of a proof-program verification.

Amounts are encrypted with **twisted ElGamal** over curve25519 and committed with **Pedersen
commitments**. Hiding only the amount (not the parties) is what keeps the scheme practical: balances
are encrypted, but the network still sees which accounts interacted.

### ZK ElGamal Proof program — verification instructions

From the Agave runtime (`docs.anza.xyz/runtime/zk-elgamal-proof`):

- `VerifyPubkeyValidity` — the ElGamal pubkey is well-formed (used by `ConfigureAccount`).
- `VerifyZeroCiphertext` — a ciphertext encrypts zero.
- `VerifyCiphertextCommitmentEquality` — a ciphertext and a Pedersen commitment encode the same value.
- `VerifyCiphertextCiphertextEquality` — two ciphertexts encode the same value.
- `VerifyBatchedRangeProofU64` / `...U128` / `...U256` — values lie in `[0, 2^n)` (no overflow/underflow).
- `VerifyGroupedCiphertext2HandlesValidity` / `VerifyBatchedGroupedCiphertext2HandlesValidity`.
- `VerifyGroupedCiphertext3HandlesValidity` / `VerifyBatchedGroupedCiphertext3HandlesValidity` — a
  ciphertext is decryptable by a set of pubkeys (source, destination, **auditor**).
- `VerifyPercentageWithCap` — used by confidential transfer **fees**.
- `CloseContextState` — admin: close a proof-context account and reclaim its rent.

---

## Account model: pending vs available balance

A confidential account splits its encrypted balance into two parts:

- **Pending balance** — credited by incoming `Deposit`s and confidential `Transfer`s. The owner does
  not control when credits arrive.
- **Available balance** — what the owner can spend (`Transfer` out / `Withdraw`).

Funds move **pending → available** only when the owner calls **`ApplyPendingBalance`**. This is the
**front-running guard**: because spending requires an *available* balance and only the owner applies
pending credits, an attacker cannot change the owner's spendable balance mid-transaction to invalidate
an in-flight proof. A `pending_balance_credit_counter` (with a `maximum_pending_balance_credit_counter`
cap) bounds how many credits can pile up before the owner must apply them.

`ConfidentialTransferAccount` state (Rust `spl_token_2022::extension::confidential_transfer`):

```rust
struct ConfidentialTransferAccount {
    approved,                                  // mint authority approved this account
    elgamal_pubkey,                            // account's ElGamal encryption pubkey
    pending_balance_lo, pending_balance_hi,    // encrypted pending balance (split 48/16-bit halves)
    available_balance,                         // encrypted available balance
    decryptable_available_balance,             // AES-encrypted copy for fast client-side decrypt
    allow_confidential_credits,                // accept confidential transfers in
    allow_non_confidential_credits,            // accept public (Deposit) credits in
    pending_balance_credit_counter,
    maximum_pending_balance_credit_counter,
    expected_pending_balance_credit_counter,
    actual_pending_balance_credit_counter,
}
```

The `decryptable_available_balance` is encrypted with the account's **AES key** (not ElGamal) so the
owner can decrypt their own balance with one symmetric operation instead of solving a discrete log.

---

## Keys: ElGamal + AES, derived from a wallet signature

Each confidential account needs two client-side secrets:

- an **ElGamal keypair** — homomorphic encryption of balances (used in proofs), and
- an **AES key** (`AeKey`) — fast symmetric decryption of the owner's own `decryptable_available_balance`.

The idiomatic pattern derives **both deterministically from a wallet signature** over a fixed message,
so nothing extra needs to be stored or backed up — re-signing the same message re-derives the same
keys. The keys are **per-owner, per-mint**.

```ts
import { ElGamalKeypair, AeKey } from '@solana/zk-sdk';
import {
  deriveElGamalKeypairForOwnerMint,
  deriveAeKeyForOwnerMint,
} from '@solana-program/token-2022/confidential';

// 0.12.0 takes a single options object. `signer` is a TransactionSigner (message-signing capable);
// `owner` is its address. The same (owner, mint) deterministically yields the same keys — no key storage.
const elgamal: ElGamalKeypair = await deriveElGamalKeypairForOwnerMint({ signer, owner, mint });
const aeKey: AeKey            = await deriveAeKeyForOwnerMint({ signer, owner, mint });
```

> Both derivations take an options object `{ signer, owner, mint }` in `@solana-program/token-2022` 0.12.0 (verified against `confidentialTransferKeys.d.ts`).

> **Security:** these keys *are* the ability to spend and decrypt the confidential balance. The
> wallet signature that derives them must be treated like a private key — never log it, never send it
> to a server. Losing the ability to reproduce the signature means losing access to the balance.

---

## The end-to-end flow

The lifecycle, with the **on-chain instruction names** at each step. Mint-side setup happens once;
per-account setup and transfers happen per holder.

### 0. Mint setup — `InitializeConfidentialTransferMint`

Add the `ConfidentialTransferMint` extension when you create the mint (a fixed-length extension, so it
goes **before** `InitializeMint` — see [SKILL.md ordering](../SKILL.md#creating-a-mint-with-extensions--the-critical-order)).
The extension stores: the confidential-transfer authority, an `auto_approve_new_accounts` flag, and an
optional **auditor ElGamal pubkey**.

```rust
struct ConfidentialTransferMint {
    authority: OptionalNonZeroPubkey,            // can update config / approve accounts (None = locked)
    auto_approve_new_accounts: PodBool,          // true = permissionless; false = authority must Approve
    auditor_elgamal_pubkey: OptionalNonZeroElGamalPubkey, // None = no auditor; Some = auditor can decrypt
}
```

With the kit `getCreateMintInstructionPlan`, this is an `ExtensionArgs` entry:

```ts
import { getCreateMintInstructionPlan, TOKEN_2022_PROGRAM_ADDRESS } from '@solana-program/token-2022';
import { some, none } from '@solana/kit';

const extensions = [
  {
    __kind: 'ConfidentialTransferMint',
    authority: some(confidentialAuthority.address),
    autoApproveNewAccounts: true,                  // permissionless approval
    auditorElgamalPubkey: none(),                  // or some(auditorElGamalPubkey) to enable an auditor
  },
];
const plan = getCreateMintInstructionPlan({ newMint, payer, mintAuthority, decimals: 6, extensions });
```

> `ConfidentialTransferMint` `ExtensionArgs` uses `autoApproveNewAccounts` and `auditorElgamalPubkey` (verified against `@solana-program/token-2022` 0.12.0).

- **`auto_approve_new_accounts = true`** → any holder can configure a confidential account without the
  authority's involvement (permissionless, "auto" approval).
- **`false`** → after a holder calls `ConfigureAccount`, the mint authority must `Approve` it
  ("manual" approval) before it can receive confidential credits.

### 1. `ConfigureAccount` (+ pubkey-validity proof)

The holder allocates the `ConfidentialTransferAccount` extension on their token account (reallocating
to the larger `getAccountDataSize`) and calls **`ConfigureAccount`**, supplying their **ElGamal pubkey**
and a **pubkey-validity proof** (`VerifyPubkeyValidity`). This sets the encrypted balances to zero.

```ts
import { getCreateConfidentialTransferAccountInstructionPlan } from '@solana-program/token-2022/confidential';

// Reallocate the token account for the extension, then ConfigureAccount with a pubkey-validity proof.
const configurePlan = getCreateConfidentialTransferAccountInstructionPlan({
  payer,
  token: ownerAta,            // the holder's Token-2022 ATA
  mint,
  owner,                      // signer
  elgamalKeypair: elgamal,
  aeKey,
});
```

If the mint did **not** set `auto_approve_new_accounts`, the mint authority must additionally send an
`Approve` instruction for this account before it can receive confidential credits.

### 2. `Deposit` (public → pending)

Get tokens into the account the normal (public) way — `MintTo` or a regular `transferChecked` — then
move that **public** balance into the **encrypted pending** balance with **`Deposit`**.

```ts
import { getConfidentialDepositInstruction } from '@solana-program/token-2022';

const depositIx = getConfidentialDepositInstruction({
  token: ownerAta,
  mint,
  amount: 1_000_000n,        // public base units to encrypt
  decimals: 6,
  authority: owner,          // signer
});
```

> `getConfidentialDepositInstruction` is the verified 0.12.0 generated builder name.

### 3. `ApplyPendingBalance` (pending → available)

The owner moves pending credits into the spendable available balance. Re-encrypts the
`decryptable_available_balance` with the AES key. This is the front-running guard described above.

```ts
import { getApplyConfidentialPendingBalanceInstructionFromToken } from '@solana-program/token-2022/confidential';

const applyIx = await getApplyConfidentialPendingBalanceInstructionFromToken({
  rpc,
  token: ownerAta,
  mint,
  authority: owner,
  elgamalKeypair: elgamal,
  aeKey,
});
```

### 4. Confidential `Transfer` (3 proofs)

A confidential transfer subtracts from the sender's **available** balance and adds to the recipient's
**pending** balance. It requires **three** zero-knowledge proofs, generated off-chain and verified by
the proof program:

1. **Equality** — `VerifyCiphertextCommitmentEquality`: the new source-balance ciphertext matches its
   Pedersen commitment (the sender really has the balance they claim).
2. **Ciphertext validity** — `VerifyBatchedGroupedCiphertext3HandlesValidity`: the transfer amount is
   correctly encrypted under **three** pubkeys — source, destination, **and auditor** — so each can
   decrypt their view.
3. **Range** — `VerifyBatchedRangeProofU128`: the amount and the resulting balances are in range
   (non-negative, no overflow).

The kit client packages proof generation + the Token-2022 `Transfer` into an **instruction plan**
(multi-tx — see below):

```ts
import { getConfidentialTransferInstructionPlan } from '@solana-program/token-2022/confidential';

const transferPlan = await getConfidentialTransferInstructionPlan({
  rpc,
  payer,
  mint,
  sourceToken: ownerAta,
  destinationToken: recipientAta,
  authority: owner,
  amount: 250_000n,
  // sender keys (decrypt current balance + sign) and the recipient/auditor ElGamal pubkeys
  sourceElgamalKeypair: elgamal,
  sourceAeKey: aeKey,
  destinationElgamalPubkey: recipientElGamalPubkey,
  auditorElgamalPubkey,                 // omit/none if the mint has no auditor
});
```

For a fee-bearing confidential mint (`ConfidentialTransferFeeConfig`), use the `WithFee` variant; it
adds a `VerifyPercentageWithCap` proof for the fee.

### 5. `Withdraw` (available → public, 2 proofs)

Move an **available** confidential balance back to a **public** balance. Requires two proofs:
**equality** (`VerifyCiphertextCommitmentEquality`) + **range** (`VerifyBatchedRangeProofU64`). Call
`ApplyPendingBalance` first if you need to spend recently received credits.

```ts
import { getConfidentialWithdrawInstructionPlan } from '@solana-program/token-2022/confidential';

const withdrawPlan = await getConfidentialWithdrawInstructionPlan({
  rpc,
  payer,
  token: ownerAta,
  mint,
  authority: owner,
  amount: 100_000n,
  elgamalKeypair: elgamal,
  aeKey,
});
```

### 6. `EmptyAccount` (before closing)

Before you can `CloseAccount` a confidential account you must prove its available balance is zero with
**`EmptyAccount`** (a `VerifyZeroCiphertext` proof).

```ts
import { getEmptyConfidentialTransferAccountInstruction } from '@solana-program/token-2022';

// This is the low-level GENERATED builder (0.12.0 ships no high-level plan helper for EmptyAccount).
// It is SYNCHRONOUS and needs a VerifyCloseAccount (zero-balance) proof supplied via the
// context-state pattern (see "Proof delivery" below). `proofInstructionOffset: 0` means "read the
// proof from the context-state account."
const emptyIx = getEmptyConfidentialTransferAccountInstruction({
  token: ownerAta,                                            // holder's Token-2022 ATA
  authority: owner,                                           // signer
  instructionsSysvarOrContextState: closeAccountProofContext, // VerifyCloseAccount context-state account
  proofInstructionOffset: 0,                                  // 0 → use the context-state account above
});
```

### Reading your balance

```ts
import { getDecryptableBalanceDecoder } from '@solana-program/token-2022';

// 0.12.0 has NO high-level `decryptAvailableBalance` export. Read the balance yourself: fetch the
// token account, take the ConfidentialTransferAccount extension's `decryptableAvailableBalance`
// ciphertext, decode it with the generated `getDecryptableBalanceDecoder()`, then decrypt it with
// your AES key (`aeKey` from @solana/zk-sdk). Confirm the exact AES-decrypt call against your
// installed zk-sdk `.d.ts` — this read-side surface is still evolving.
const decryptable = getDecryptableBalanceDecoder().decode(decryptableAvailableBalanceBytes);
const available = aeKey.decrypt(decryptable); // @solana/zk-sdk AeKey — verify method vs installed .d.ts
```

> **Import paths (0.12.0):** the high-level plan helpers (`getConfidentialTransferInstructionPlan`,
> `getConfidentialWithdrawInstructionPlan`, `getCreateConfidentialTransferAccountInstructionPlan`,
> `getApplyConfidentialPendingBalanceInstructionFromToken`) and the key-derivation helpers
> (`deriveElGamalKeypairForOwnerMint`, `deriveAeKeyForOwnerMint`) live under the
> **`@solana-program/token-2022/confidential`** subpath — they are NOT re-exported from the package root.
> The low-level generated builders (`getConfidentialDepositInstruction`,
> `getEmptyConfidentialTransferAccountInstruction`) are root exports. There is **no** `decryptAvailableBalance`
> export — read the balance with the `getDecryptableBalanceDecoder()` codec + your AES key. Confirm exact
> shapes against the installed `.d.ts`; this surface is still evolving.

---

## Proof delivery and the 1232-byte tx limit

A confidential transfer's proof data is large. **It does not fit in one 1232-byte transaction.** The
proof program supports three delivery modes; real flows use mode (3):

1. **Inline** — proof bytes in the verify instruction's data. Simplest, no extra account, but only
   works for small proofs that fit alongside everything else in one tx.
2. **Record account** — proof bytes stored in a separate record account, referenced by the verify
   instruction.
3. **Context-state account** — first send the proof-program verify instruction, which **verifies the
   proof and writes the public "context" (the statement being proven) into a context-state account**;
   the Token-2022 instruction then references that context account instead of re-verifying. Required
   when the proof + the token instruction won't fit in one tx, or when a PDA must own the proof.

A context-state account is described by `ContextStateInfo { context_state_account, context_state_authority }`.
After the token instruction consumes it, **close it with `CloseContextState`** to reclaim the rent —
otherwise each transfer leaks rent into dead accounts.

Because of all this, a single confidential transfer spans **several sequential transactions**:

```
create + verify each proof-context account  →  run the Token-2022 instruction  →  CloseContextState (reclaim rent)
```

The kit `*InstructionPlan` helpers above **return this multi-tx structure for you** — that is the whole
point of the "plan" helpers versus the single-instruction builders. Execute the plan with kit's plan
executor (or send the messages sequentially yourself). You can also pack the sequence into a Jito
bundle for atomic landing; see the `transaction-landing` skill.

---

## The auditor key

If the mint's `ConfidentialTransferMint.auditor_elgamal_pubkey` is set, **every** confidential transfer
must include a ciphertext decryptable by that auditor pubkey (enforced by the 3-handles validity
proof). The holder of the matching auditor **secret** key can therefore decrypt all transfer amounts —
the compliance escape hatch that makes confidential transfers usable by regulated issuers.

- Set the auditor pubkey at mint creation (or while the confidential-transfer authority is non-null).
- Setting it to `None` disables auditing for future transfers.
- The auditor sees **amounts**, not new private keys — it cannot spend.

---

## CLI quickstart (`spl-token` v5.6.1)

For manual testing on devnet, the CLI drives the whole flow without writing proof code:

```bash
# 1. Mint with confidential transfers enabled
spl-token --program-2022 create-token --enable-confidential-transfers auto

# 2. Configure the holder's account for confidential transfers
spl-token configure-confidential-transfer-account --address <TOKEN_ACCOUNT>

# 3. Public balance -> pending (encrypted)
spl-token deposit-confidential-tokens <MINT> <AMOUNT>

# 4. pending -> available
spl-token apply-pending-balance --address <TOKEN_ACCOUNT>

# 5. Confidential transfer (amount hidden on-chain)
spl-token transfer <MINT> <AMOUNT> <RECIPIENT> --confidential

# 6. available -> public
spl-token withdraw-confidential-tokens <MINT> <AMOUNT>
```

`--enable-confidential-transfers auto` sets `auto_approve_new_accounts = true`; use `manual` to require
authority approval.

---

## Guidelines

- **DO** verify the ZK ElGamal Proof program feature gate for your exact cluster/epoch before relying
  on confidential transfers — it has been disabled before and could be gated off again.
- **DO** test the full flow on **devnet** first; mainnet and devnet feature gates can differ.
- **DO** derive ElGamal + AES keys deterministically from a wallet signature and treat that signature
  as a private secret (never log it, never send it server-side).
- **DO** call `ApplyPendingBalance` before spending recently received credits, and `EmptyAccount`
  before closing a confidential account.
- **DO** `CloseContextState` after each multi-tx transfer to reclaim proof-account rent.
- **DON'T** reach for `@solana/spl-token` — it has no confidential module. Use kit
  `@solana-program/token-2022` + `@solana/zk-sdk`, the Rust proof crates, or the CLI.
- **DON'T** assume the amount being hidden hides the participants — **senders and receivers are
  public**, only amounts are encrypted.
- **DON'T** try to cram a confidential transfer into one transaction — it spans several; use the kit
  instruction-plan helpers (or a Jito bundle) for the multi-tx sequence.
- **DON'T** forget the auditor pubkey if your compliance model needs it — it can only be enforced at
  transfer time via the 3-handles validity proof.

---

## Common Errors

### Error: instruction fails / "program is not deployed" on the ZK ElGamal Proof program
**Cause** The proof program's feature gate is **off** on your cluster/epoch (it was disabled
2025-06-19 → re-enabled 2026; gates can differ between mainnet, devnet, and testnet).
**Solution** Confirm the gate with `solana feature status` (look for the zk-elgamal-proof enablement
gate) and test on devnet first. Do not hard-code an assumption that confidential transfers are live.

### Error: `createConfigureAccountInstruction` / confidential helpers not found in `@solana/spl-token`
**Cause** `@solana/spl-token` 0.4.14 has **no** confidential-transfer module.
**Solution** Use the kit client `@solana-program/token-2022` 0.12.0 + `@solana/zk-sdk` 0.4.2 (or the
Rust proof crates / CLI). See the [SDK reality](#sdk-reality-solanaspl-token-cannot-do-this) table.

### Error: transaction too large / exceeds 1232 bytes on a confidential transfer
**Cause** You tried to inline the proofs and the token instruction in one transaction.
**Solution** Use **context-state accounts**: verify each proof into its own context account, then run
the Token-2022 instruction referencing them, then `CloseContextState`. The kit `*InstructionPlan`
helpers emit this multi-tx structure automatically.

### Error: confidential `Transfer` rejected — missing auditor ciphertext / invalid validity proof
**Cause** The mint has an auditor pubkey but the transfer's ciphertext-validity proof did not include
a handle for it (or used the 2-handles instead of 3-handles validity proof).
**Solution** Pass the mint's `auditor_elgamal_pubkey` into the transfer so the
`VerifyBatchedGroupedCiphertext3HandlesValidity` proof encrypts the amount for source, destination,
**and** auditor.

### Error: cannot spend a balance you just received
**Cause** Incoming credits land in the **pending** balance; only **available** balance is spendable.
**Solution** Call `ApplyPendingBalance` (the front-running guard) to move pending → available first.

### Error: `CloseAccount` fails on a confidential account
**Cause** The confidential account still holds a (possibly zero) confidential balance state.
**Solution** Run `EmptyAccount` (proves available balance is zero via `VerifyZeroCiphertext`) before
`CloseAccount`.

---

## References

- Confidential Balances guide: https://www.solana-program.com/docs/confidential-balances
- Confidential transfer overview: https://solana.com/docs/tokens/extensions/confidential-transfer
- ZK ElGamal Proof program (instructions, context state, status): https://docs.anza.xyz/runtime/zk-elgamal-proof
- SIMD-0153 (ZK ElGamal Proof program replaces the ZK Token Proof program): https://github.com/solana-foundation/solana-improvement-documents/blob/main/proposals/0153-elgamal-proof-program.md
- June 2025 post-mortem (disable on 2025-06-11, epoch 805): https://solana.com/news/post-mortem-june-25-2025
- Re-enable tracking issue: https://github.com/solana-program/token-2022/issues/657
- `@solana-program/token-2022` (kit client, 0.12.0): https://www.npmjs.com/package/@solana-program/token-2022
- `@solana/zk-sdk` (WASM ElGamal/AES + proofs, 0.4.2): https://www.npmjs.com/package/@solana/zk-sdk
- QuickNode confidential-transfer guide: https://www.quicknode.com/guides/solana-development/spl-tokens/token-2022/confidential
- Program addresses: [`../resources/program-addresses.md`](../resources/program-addresses.md) · SDK mapping: [`../resources/sdk-reference.md`](../resources/sdk-reference.md)

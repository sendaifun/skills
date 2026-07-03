# Migrating from SPL Token to Token-2022

How Token-2022 differs from classic SPL Token, why you can never convert an existing mint in
place, how to write client code that handles **both** programs correctly, and how to decide
whether a new token should launch under Token-2022 at all.

> Prereqs: read the [SKILL.md](../SKILL.md) sections "Token-2022 vs SPL Token" and "Supporting both
> token programs" first. This doc is the deep dive behind them. Program ids, the ATA-seed rule, and
> package versions live in [resources/program-addresses.md](../resources/program-addresses.md); the
> full function-by-function SDK map is in [resources/sdk-reference.md](../resources/sdk-reference.md).

---

## 1. The fundamental fact: there is no in-place migration

Token-2022 (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`) and classic SPL Token
(`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`) are **two distinct on-chain programs**. A mint
account is **owned by** the program that created it, and the `owner` field of an account is set by
the System Program at allocation time and **cannot be reassigned to a different program** by anyone.

Consequences:

- **You cannot "upgrade" an SPL mint to Token-2022.** There is no instruction — in either program —
  that re-points an existing mint to the other program. The owning program is permanent for the life
  of the account.
- **You cannot add an extension to an existing mint of either kind.** Even within Token-2022, an
  extension's *presence* is fixed at mint creation (the account is sized for it up front and
  `InitializeMint` seals the TLV layout — see [SKILL.md → Creating a mint with extensions](../SKILL.md#creating-a-mint-with-extensions--the-critical-order)). A plain SPL mint has no TLV region at all.
- **The two ATAs for the same `(owner, mint)` are different accounts** because the token program id
  is a PDA seed (see §3). Balances do not "carry over."

So migration is never a state mutation — it is **"mint a new token and move holders to it."**

### 1.1 Migration strategies (all require a brand-new mint)

| Strategy | How it works | Best for |
|---|---|---|
| **Snapshot + airdrop** | Snapshot holders of the old SPL mint at a block; create the new Token-2022 mint; `mintTo` each holder's new ATA (or publish a Merkle claim). Old token is deprecated/abandoned or burned by holders. | Governance/utility tokens with a known holder set; no need for continuous convertibility. |
| **Lock-and-mint swap (migrator program)** | A custom program takes the old token (transfers it to a vault or burns it) and mints/releases the new Token-2022 token 1:1 on demand. Two-way or one-way. | Tokens with ongoing liquidity that need a gradual, permissionless migration window. |
| **Wrapped / escrow** | A program escrows the old SPL token and issues a Token-2022 representation; redeemable back. | When you must keep the old token alive (e.g. existing integrations) but want extension features for new flows. |

There is no built-in "converter" program — the swap/escrow contract is yours to write (or adopt from
an existing token-migration tool). The new mint follows the standard Token-2022 creation flow in
[SKILL.md](../SKILL.md#creating-a-mint-with-extensions--the-critical-order); choose every extension up
front because you cannot add them later (and you cannot migrate *again* cheaply).

> Liquidity/UX note: a migration fragments liquidity (two mints, two sets of pools/ATAs) until the old
> token is fully retired. Plan DEX pool creation, CEX listings, and oracle/price-feed updates for the
> **new** mint, and communicate a clear deprecation timeline for the old one.

---

## 2. Behavioral differences from classic SPL Token

Token-2022 is a **superset**: every classic instruction (`InitializeMint`, `MintTo`,
`TransferChecked`, `Burn`, `Approve`, `SetAuthority`, `CloseAccount`, …) exists with an **identical
binary layout**. The differences are additive plus a few stricter defaults.

| Area | Classic SPL Token | Token-2022 |
|---|---|---|
| Program id | `Tokenkeg…623VQ5DA` | `Tokenz…PxuEb` |
| Extensions | None | TLV extensions on mint and/or account (see [resources/extensions-reference.md](../resources/extensions-reference.md)) |
| Mint account size | Fixed 82 bytes | 82-byte base **+ TLV**; size via `getMintLen([...])` |
| Token account size | Fixed 165 bytes | 165-byte base **+ TLV**; size via `getAccountLen([...])` |
| ATA address | PDA seeded by `[owner, TOKEN_PROGRAM_ID, mint]` | PDA seeded by `[owner, TOKEN_2022_PROGRAM_ID, mint]` → **different address** |
| ATA program | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` (same) | Same ATA program, different derived address |
| Transfers | `transfer` (unchecked) still common | **Always `transferChecked`** — extensions (fees, hooks) require `mint`+`decimals`; unchecked transfer can fail or be wrong |
| Transfer side effects | None | A transfer may withhold a **fee**, CPI a **hook program**, or be blocked by **pause/non-transferable/default-frozen** |
| In-mint metadata | No (use Metaplex Token Metadata) | `MetadataPointer` + `TokenMetadata` store name/symbol/uri **in the mint** |
| Wrapped SOL mint | `NATIVE_MINT` = `So111…112` | `NATIVE_MINT_2022` = `9pan9bMn5HatX4EJdBwg9VgCa7Uz5HL8N1m5D3NdXejP` |
| Rust crate / JS pkg | `spl-token` 9.0.0 / `@solana/spl-token` (legacy default) | `spl-token-2022` 11.0.0 / `@solana/spl-token` with `TOKEN_2022_PROGRAM_ID`, or kit `@solana-program/token-2022` 0.12.0 |

The practical client-side deltas that break naïve code:

1. **Nothing defaults to Token-2022.** Every optional `programId` argument in `@solana/spl-token`
   defaults to the **legacy** `TOKEN_PROGRAM_ID`. If you forget to pass `TOKEN_2022_PROGRAM_ID`, you
   silently target the wrong program/ATA.
2. **`transferChecked`, not `transfer`.** Carry `decimals` everywhere. For fee mints use
   `createTransferCheckedWithFeeInstruction`; for hook mints use the async
   `createTransferCheckedWithTransferHookInstruction` (a plain checked transfer on a hook mint fails
   with missing accounts — see [docs/transfer-hooks.md](./transfer-hooks.md)).
3. **Transfers can have side effects.** A `TransferFeeConfig` mint withholds a fee on the recipient;
   a `Pausable` mint can reject transfers; `DefaultAccountState = Frozen` means a fresh ATA must be
   thawed before it can receive tokens. Integrations must tolerate these.

---

## 3. Why the ATA address differs (and why it bites migrations)

The Associated Token Account program is **one program** for both token programs, but the **token
program id is a seed** of the ATA PDA:

```
seeds   = [ owner_pubkey, token_program_id, mint_pubkey ]
program = ASSOCIATED_TOKEN_PROGRAM_ID   // ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL
```

So for the same `(owner, mint)`, the ATA under `TOKEN_PROGRAM_ID` and the ATA under
`TOKEN_2022_PROGRAM_ID` are **distinct accounts at distinct addresses**. There is no shared balance.
Any code that derives an ATA with the wrong program id gets a different address and then fails
downstream with `TokenInvalidAccountOwnerError` / `IncorrectProgramId` / "account not found."

This is the single most common dual-program bug. The fix is always the same: **detect the mint's
owning program first, then thread that program id through every derivation and instruction.**

---

## 4. Writing dual-program client code

An app that handles arbitrary mints (a wallet, DEX, indexer, payments backend) must branch on each
mint's owning program. The owning program is the **mint account's `owner` field** — never anything
inside the mint data. There is **no `getTokenProgramForMint` helper in `@solana/spl-token`**; detect
it yourself, then pass it everywhere.

### 4.1 web3.js + `@solana/spl-token`

```ts
import {
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  getMint, getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount,
  createTransferCheckedInstruction, programSupportsExtensions,
} from '@solana/spl-token';
import { Connection, PublicKey, Keypair, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';

/** Detect which token program owns a mint by reading the account's `owner`. */
async function getTokenProgramForMint(connection: Connection, mint: PublicKey): Promise<PublicKey> {
  const info = await connection.getAccountInfo(mint);
  if (!info) throw new Error('Mint not found');
  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  if (info.owner.equals(TOKEN_PROGRAM_ID))      return TOKEN_PROGRAM_ID;
  throw new Error(`Not a token mint, owner=${info.owner.toBase58()}`);
}

async function transferAny(
  connection: Connection, payer: Keypair, mint: PublicKey, recipient: PublicKey, amount: bigint,
) {
  // 1. Detect ONCE.
  const programId = await getTokenProgramForMint(connection, mint);

  // 2. programSupportsExtensions(programId) === true only for Token-2022 — use it to gate
  //    extension reads (fee/hook detection, metadata, etc.).
  const isToken2022 = programSupportsExtensions(programId);

  // 3. Pass the detected programId to getMint (it is REQUIRED, not optional-with-correct-default).
  const { decimals } = await getMint(connection, mint, 'confirmed', programId);

  // 4. Derive/create ATAs under the SAME program (the program id is an ATA seed).
  const source = getAssociatedTokenAddressSync(mint, payer.publicKey, false, programId);
  const dest = await getOrCreateAssociatedTokenAccount(
    connection, payer, mint, recipient, false, 'confirmed', undefined,
    programId,                         // <-- mint's owning token program
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  // 5. Always transferChecked; pass the detected programId. (For fee/hook mints, swap the builder —
  //    see §4.4 and docs/transfer-hooks.md.)
  const ix = createTransferCheckedInstruction(
    source, mint, dest.address, payer.publicKey, amount, decimals, [], programId,
  );
  await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer]);
  return { programId, isToken2022 };
}
```

`getMint(connection, mint, commitment?, programId?)`, `getAssociatedTokenAddressSync(mint, owner,
allowOwnerOffCurve?, programId?, associatedTokenProgramId?)`, and `getOrCreateAssociatedTokenAccount(...,
programId?, associatedTokenProgramId?)` all take the program id as a **trailing optional** that
defaults to legacy. Treat "pass the detected programId" as mandatory in dual-program code.

> A ready-to-copy, fully commented version of these helpers (`getTokenProgramForMint`, program-aware
> ATA, ordered mint creation, and a `transferSmart` that auto-selects the checked / with-fee /
> with-hook builder) is in [templates/token2022-client.ts](../templates/token2022-client.ts).

### 4.2 kit (`@solana/kit` + `@solana-program/token-2022`)

```ts
import { address, type Address, createSolanaRpc } from '@solana/kit';
import { TOKEN_2022_PROGRAM_ADDRESS } from '@solana-program/token-2022';
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';

const rpc = createSolanaRpc('https://api.devnet.solana.com');

async function getTokenProgramForMint(mint: Address): Promise<Address> {
  const { value } = await rpc.getAccountInfo(mint, { encoding: 'base64' }).send();
  if (!value) throw new Error('Mint not found');
  if (value.owner === TOKEN_2022_PROGRAM_ADDRESS) return TOKEN_2022_PROGRAM_ADDRESS;
  if (value.owner === TOKEN_PROGRAM_ADDRESS)       return TOKEN_PROGRAM_ADDRESS;
  throw new Error(`Unexpected owner ${value.owner}`);
}
```

In kit, `owner` is a base58 `Address` string, so compare with `===` (not `.equals()`). The kit
program-id constants are `TOKEN_2022_PROGRAM_ADDRESS` (from `@solana-program/token-2022` 0.12.0) and
`TOKEN_PROGRAM_ADDRESS` (from `@solana-program/token` 0.14.0). Do **not** mix kit `Address` strings
with web3.js `PublicKey` objects — they are different types.

### 4.3 Enumerating a wallet's token accounts across both programs

There is **no single RPC call** that returns token accounts from both programs. Call
`getTokenAccountsByOwner` **once per program id** and merge:

```ts
const [classic, token2022] = await Promise.all([
  connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }),
  connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }),
]);
const allAccounts = [...classic.value, ...token2022.value];
```

The same applies to `getProgramAccounts`-style indexing, balance dashboards, and "all my tokens"
views: query both program ids or you will silently miss every Token-2022 holding.

### 4.4 Branching on extensions before transferring

Once you know a mint is Token-2022, read its extensions to pick the correct transfer builder.
`getMint(... programId)` exposes a `tlvData` buffer; `@solana/spl-token` ships per-extension getters
that unpack it. Detect a fee or hook before building the transfer:

```ts
import {
  getMint, getTransferFeeConfig, getTransferHook,
  createTransferCheckedInstruction, createTransferCheckedWithFeeInstruction,
  createTransferCheckedWithTransferHookInstruction, TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';

const mintState = await getMint(connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID);
const fee  = getTransferFeeConfig(mintState);  // null if no transfer fee
const hook = getTransferHook(mintState);       // null if no transfer hook

let ix;
if (hook) {
  // async — reads the ExtraAccountMetaList PDA via RPC and appends resolved accounts
  ix = await createTransferCheckedWithTransferHookInstruction(
    connection, source, mint, dest, owner, amount, decimals, [], 'confirmed', TOKEN_2022_PROGRAM_ID,
  );
} else if (fee) {
  const { transferFeeBasisPoints, maximumFee } = fee.newerTransferFee;
  const feeAmount = bigintMin((amount * BigInt(transferFeeBasisPoints)) / 10_000n, maximumFee);
  ix = createTransferCheckedWithFeeInstruction(
    source, mint, dest, owner, amount, decimals, feeAmount, [], TOKEN_2022_PROGRAM_ID,
  );
} else {
  ix = createTransferCheckedInstruction(source, mint, dest, owner, amount, decimals, [], TOKEN_2022_PROGRAM_ID);
}

function bigintMin(a: bigint, b: bigint) { return a < b ? a : b; }
```

If you would rather not branch, `createTransferCheckedWithTransferHookInstruction` is **safe on
non-hook mints** too (it just resolves zero extra accounts), so a payments backend can call it
unconditionally for Token-2022 mints and only special-case fee mints. See
[docs/extensions-guide.md](./extensions-guide.md) and [docs/transfer-hooks.md](./transfer-hooks.md)
for the per-extension specifics.

---

## 5. Ecosystem support gotchas

Token-2022 is broadly supported, but support is **per-extension**, not all-or-nothing. The on-chain
program being live does not mean every wallet, explorer, DEX, indexer, or CEX renders and transacts
your specific extension correctly.

- **Wallets.** Most handle plain Token-2022 mints, transfer fees, and in-mint metadata. Transfer
  hooks, confidential transfers, and scaled-UI amount have historically rendered or transacted
  inconsistently. Wallets also **warn on `PermanentDelegate`** (the authority can move/burn anyone's
  tokens) and may warn on `NonTransferable` and default-frozen mints. Test display *and* a real send
  on every wallet you target before mainnet.
- **DEXs / AMMs.** An integrator that hard-codes `TOKEN_PROGRAM_ID` will simply reject your mint.
  Even one that supports Token-2022 may not support a **transfer hook** — the hook CPI requires extra
  accounts a naïve pool never passes, so swaps revert. A **transfer fee** also changes amount math
  (the pool receives less than the gross amount). Confirm both "Token-2022 supported" *and* "my
  specific extensions supported" with each venue.
- **Indexers / data providers.** Anything that enumerates balances must query **both** program ids
  (§4.3). Indexers that only watch `TOKEN_PROGRAM_ID` will miss your token entirely; price/TVL feeds
  must account for transfer fees and scaled-UI/interest display multipliers (the displayed UI amount
  is not the raw amount — see [docs/extensions-guide.md](./extensions-guide.md)).
- **CEXs / on-ramps.** Listing support for Token-2022 (and for individual extensions like transfer
  fees, which affect deposit/withdrawal accounting) varies by exchange. Confirm before depending on
  it for a stablecoin or payments token.
- **Two wrapped-SOL mints.** Wrapping SOL under Token-2022 uses `NATIVE_MINT_2022`, not the legacy
  `NATIVE_MINT`. Pick the mint that matches the token program you are working with.

Because support is uneven, **the existence of an extension on-chain is a launch decision, not a free
upgrade.** A transfer hook or confidential-transfer requirement can exclude your token from venues
that haven't integrated it.

---

## 6. When should a project choose Token-2022?

Default to **classic SPL Token** for a no-frills fungible token that prizes maximum
wallet/DEX/CEX compatibility and needs none of the extension behaviors. It remains the safest,
most universally supported primitive.

Choose **Token-2022** when you need a capability that classic SPL Token cannot express — and accept
the support/testing burden. Strong fits:

| You need… | Extension | Notes |
|---|---|---|
| Protocol fee skimmed on every transfer | `TransferFeeConfig` | bps + per-transfer cap; withheld on recipient, harvested by an authority |
| Compliance freeze / clawback / forced recovery | `PermanentDelegate`, `DefaultAccountState=Frozen` | Powerful + a trust hazard; wallets warn. Common in regulated stablecoins/RWAs |
| Emergency stop | `Pausable` | Halt transfers/mints/burns mint-wide |
| Private balances with an optional auditor | `ConfidentialTransferMint` | kit + `@solana/zk-sdk` only; verify the ZK proof feature gate per cluster — see [docs/confidential-transfers.md](./confidential-transfers.md) |
| Royalty enforcement / allowlists / per-transfer logic | `TransferHook` | CPI a custom program each transfer; can break naïve integrators |
| Name/symbol/uri without a Metaplex account | `MetadataPointer` + `TokenMetadata` | Metadata stored in the mint itself |
| Rebasing / stock-split / interest display | `ScaledUiAmount`, `InterestBearingConfig` | Changes the *displayed* amount only; no tokens move |
| Soul-bound / non-transferable | `NonTransferable` | Credentials, tickets, non-tradeable points |

Decision checklist before committing:

1. **Is a needed behavior impossible under classic SPL Token?** If no, use classic.
2. **Do your launch venues (wallets, DEXs, CEXs, indexers) support Token-2022 *and* your specific
   extensions?** Verify, don't assume (§5).
3. **Have you chosen every extension up front?** You cannot add or migrate them later (§1). Most are
   permanent or can only be locked by setting their authority to `null`.
4. **Have you accounted for the trust implications?** `PermanentDelegate`, transfer hooks, and
   confidential auditor keys change the security model holders are agreeing to. Document them.

Most regulated/programmable-money projects (stablecoins, RWAs, payment tokens) land on Token-2022;
most plain community/utility tokens that want frictionless listing stay on classic SPL Token.

---

## Common Errors

### Error: "I can't find an instruction to convert my SPL mint to Token-2022"
**Cause** There is none — the owning program is fixed at account allocation and cannot be reassigned.
**Solution** Create a new Token-2022 mint and move holders with a snapshot+airdrop or a lock-and-mint
swap (§1.1). Plan liquidity/CEX/oracle updates for the new mint.

### Error: `TokenInvalidAccountOwnerError` / `IncorrectProgramId` / "account not found" after detecting Token-2022
**Cause** An ATA was derived or created with the wrong (usually default legacy) token program. The
program id is an ATA seed, so the address differs per program.
**Solution** Pass the detected `programId` to `getAssociatedTokenAddressSync`,
`createAssociatedTokenAccount[Idempotent]Instruction`, and `getOrCreateAssociatedTokenAccount` (§3, §4.1).

### Error: a Token-2022 holding is missing from my "all tokens" view
**Cause** Only `TOKEN_PROGRAM_ID` was queried. No RPC call returns both programs' accounts.
**Solution** Call `getTokenAccountsByOwner` (or your indexer query) once per program id and merge (§4.3).

### Error: transfer reverts on a mint you support
**Cause** The mint has a `TransferHook` (missing extra accounts) or a `TransferFeeConfig` (a plain
checked transfer didn't account for the fee), or it is paused / non-transferable / default-frozen.
**Solution** Read extensions first and branch (§4.4): use
`createTransferCheckedWithTransferHookInstruction` for hook mints,
`createTransferCheckedWithFeeInstruction` for fee mints; thaw default-frozen destinations; surface
pause/non-transferable to the user. See [docs/troubleshooting.md](./troubleshooting.md).

### Error: type errors mixing `PublicKey` and `Address`
**Cause** Mixing web3.js (`@solana/spl-token`) values with kit (`@solana-program/token-2022`) values.
**Solution** Pick one stack per code path. `@solana/spl-token` uses `PublicKey`/`Connection`; the kit
client uses `Address`/`Rpc`. See [resources/sdk-reference.md](../resources/sdk-reference.md).

---

## References

- Token-2022 program docs (extensions, behavior): https://www.solana-program.com/docs/token-2022
- Token-2022 program source (Rust `spl-token-2022` 11.0.0): https://github.com/solana-program/token-2022
- Associated Token Account program: https://github.com/solana-program/associated-token-account
- `@solana/spl-token` (web3.js SDK, 0.4.14): https://www.npmjs.com/package/@solana/spl-token
- `@solana-program/token-2022` (kit SDK, 0.12.0): https://www.npmjs.com/package/@solana-program/token-2022
- `@solana-program/token` (kit classic SPL client, 0.14.0): https://www.npmjs.com/package/@solana-program/token
- Token extensions developer guides: https://solana.com/developers/guides/token-extensions

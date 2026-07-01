# Token-2022 Program Addresses & Versions

Every program id, canonical mint address, and pinned package version the Token-2022 skill depends on.
Addresses are verified from `@solana/spl-token` 0.4.14 (`constants.js`) and the program sources
(`solana-program/token-2022`, `anza-xyz/solana-sdk`); versions from the npm registry and crates.io.

> This is the lookup behind [SKILL.md → Program IDs & ATAs](../SKILL.md#program-ids--atas). The ATA
> derivation rule is summarized below and applied throughout
> [docs/migration-from-spl.md](../docs/migration-from-spl.md). Function-by-function SDK mapping is in
> [sdk-reference.md](./sdk-reference.md).

---

## Program IDs & canonical addresses

| Constant | Address | Notes |
|---|---|---|
| `TOKEN_PROGRAM_ID` (classic SPL Token) | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | The original token program |
| `TOKEN_2022_PROGRAM_ID` (Token Extensions) | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` | The "Token-2022" / Token Extensions program |
| `ASSOCIATED_TOKEN_PROGRAM_ID` | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` | **One ATA program shared by BOTH token programs** |
| `NATIVE_MINT` (wrapped SOL, classic) | `So11111111111111111111111111111111111111112` | wSOL under classic SPL Token |
| `NATIVE_MINT_2022` (wrapped SOL, Token-2022) | `9pan9bMn5HatX4EJdBwg9VgCa7Uz5HL8N1m5D3NdXejP` | wSOL under Token-2022 |
| ZK ElGamal Proof program | `ZkE1Gama1Proof11111111111111111111111111111` | Native proof program used by Confidential Transfer |
| ZK Token Proof program (**DEPRECATED, removed**) | `ZkTokenProof1111111111111111111111111111111` | Replaced by the ZK ElGamal Proof program per SIMD-0153 — do not use |

All six live constants are exported by `@solana/spl-token` except the two ZK proof program ids (those
are passed automatically by the confidential-transfer flow / SDKs). Same addresses on
**devnet, testnet, and mainnet-beta** — Solana program ids are cluster-independent.

### web3.js vs kit constant names

| | web3.js (`@solana/spl-token`) | kit |
|---|---|---|
| Classic token program | `TOKEN_PROGRAM_ID` (`PublicKey`) | `TOKEN_PROGRAM_ADDRESS` (`Address`, from `@solana-program/token` 0.14.0) |
| Token-2022 | `TOKEN_2022_PROGRAM_ID` (`PublicKey`) | `TOKEN_2022_PROGRAM_ADDRESS` (`Address`, from `@solana-program/token-2022` 0.12.0) |
| ATA program | `ASSOCIATED_TOKEN_PROGRAM_ID` | `ASSOCIATED_TOKEN_PROGRAM_ADDRESS` (from `@solana-program/token`) |

The kit constants are base58 **strings** typed as `Address`; the web3.js constants are `PublicKey`
objects. Compare kit owners with `===` and web3.js owners with `.equals()`. Do not mix the two types
(see [docs/migration-from-spl.md](../docs/migration-from-spl.md#42-kit-solanakit--solana-programtoken-2022)).

---

## The ATA derivation rule (why addresses differ per program)

There is **one** Associated Token Account program, but the **token program id is a PDA seed**, so the
derived ATA address depends on which token program owns the mint:

```
seeds   = [ owner_pubkey, token_program_id, mint_pubkey ]
program = ASSOCIATED_TOKEN_PROGRAM_ID   // ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL
```

For the same `(owner, mint)`:

- ATA under `TOKEN_PROGRAM_ID` ≠ ATA under `TOKEN_2022_PROGRAM_ID` — **different accounts**.
- Deriving with the wrong token program → a different address → downstream
  `TokenInvalidAccountOwnerError` / `IncorrectProgramId` / "account not found."

Always pass the mint's owning token program when deriving:

```ts
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
// getAssociatedTokenAddressSync(mint, owner, allowOwnerOffCurve?, programId?, associatedTokenProgramId?)
const ata = getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID);
```

Detect the owning program from the mint account's `owner` field before deriving — see
[docs/migration-from-spl.md → Writing dual-program client code](../docs/migration-from-spl.md#4-writing-dual-program-client-code).

---

## Verified package versions

### npm (JavaScript / TypeScript)

| Package | Version | Role |
|---|---|---|
| `@solana/spl-token` | **0.4.14** | Classic web3.js-based SDK. Use with `TOKEN_2022_PROGRAM_ID`. **No confidential-transfer module.** |
| `@solana/spl-token-metadata` | **0.1.6** | `TokenMetadata` interface client (`createInitializeInstruction`, `pack`, `TokenMetadata`). Re-exported by `@solana/spl-token`. |
| `@solana/spl-token-group` | **0.0.7** | `TokenGroup` / `TokenGroupMember` interface client. |
| `@solana-program/token-2022` | **0.12.0** | Kit-native (Codama-generated) Token-2022 client for `@solana/kit`. Has confidential + hook helpers. |
| `@solana-program/token` | **0.14.0** | Kit-native classic SPL Token client (provides `TOKEN_PROGRAM_ADDRESS`). |
| `@solana/kit` | **7.0.0** | Modern Solana JS framework (successor to web3.js 2.x). |
| `@solana/web3.js` | **1.98.4** | Legacy web3.js (1.x); `@solana/spl-token` peers on this. |
| `@solana/zk-sdk` | **0.4.2** | WASM ElGamal/AES + proof generation for JS confidential transfers. |

### crates.io (Rust)

| Crate | Version | Role |
|---|---|---|
| `spl-token-2022` | **11.0.0** | On-chain program + state/extension types (`ExtensionType` enum). |
| `spl-token` | **9.0.0** | Classic token program crate. |
| `spl-associated-token-account` | **8.0.0** | ATA program crate. |
| `spl-token-metadata-interface` | **1.0.1** | `TokenMetadata` TLV interface. |
| `spl-token-group-interface` | **0.7.2** | `TokenGroup` / member interface. |
| `spl-transfer-hook-interface` | **2.1.0** | Transfer-hook `Execute` / `InitializeExtraAccountMetaList` interface. |
| `spl-tlv-account-resolution` | **0.11.1** | `ExtraAccountMeta` + `ExtraAccountMetaList` (resolves hook extra accounts). |
| `spl-pod` | **0.7.3** | `PodBool`, `OptionalNonZeroPubkey`, `PodElGamalPubkey`, etc. |
| `spl-token-confidential-transfer-proof-generation` | **0.6.1** | Build range/equality/validity proofs (Rust). |
| `spl-token-confidential-transfer-proof-extraction` | **0.6.1** | Extract/verify proof context (Rust). |
| `anchor-lang` / `anchor-spl` | **1.1.2** | For Anchor transfer-hook programs (see [docs/transfer-hooks.md](../docs/transfer-hooks.md)). |

Install:

```bash
# web3.js path (primary throughout this skill)
npm i @solana/spl-token@0.4.14 @solana/web3.js@1.98.4

# kit path (modern; REQUIRED for confidential transfers)
npm i @solana-program/token-2022@0.12.0 @solana-program/token@0.14.0 @solana-program/system \
      @solana/kit@7.0.0 @solana/zk-sdk@0.4.2
```

```toml
# Rust (on-chain program / transfer hook)
[dependencies]
spl-token-2022 = "11.0.0"
spl-transfer-hook-interface = "2.1.0"
spl-tlv-account-resolution = "0.11.1"
```

---

## Source / host notes

- The SPL programs moved from `solana-labs/solana-program-library` to
  **`github.com/solana-program/token-2022`**. The old doc host **`spl.solana.com/token-2022`
  308-redirects to `www.solana-program.com/docs/token-2022`** — update bookmarks/links.
- **Confidential Transfers** require the ZK ElGamal Proof program
  (`ZkE1Gama1Proof11111111111111111111111111111`) to be enabled on the cluster. It was disabled
  Jun 2025 after a soundness bug and re-enabled on mainnet-beta ~2026-06-29. **Verify the feature gate
  per cluster/epoch** before relying on it — see [docs/confidential-transfers.md](../docs/confidential-transfers.md).

---

## References

- `@solana/spl-token` (constants `TOKEN_PROGRAM_ID`/`TOKEN_2022_PROGRAM_ID`/`NATIVE_MINT`/`NATIVE_MINT_2022`): https://www.npmjs.com/package/@solana/spl-token
- Token-2022 program source: https://github.com/solana-program/token-2022
- Associated Token Account program: https://github.com/solana-program/associated-token-account
- ZK ElGamal Proof program id (Anza sdk-ids): https://github.com/anza-xyz/solana-sdk
- SIMD-0153 (ZK ElGamal Proof program replaces ZK Token Proof program): https://github.com/solana-foundation/solana-improvement-documents/blob/main/proposals/0153-elgamal-proof-program.md
- Token-2022 docs: https://www.solana-program.com/docs/token-2022

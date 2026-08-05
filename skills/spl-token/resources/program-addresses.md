# Program Addresses

All addresses are identical across devnet, testnet, and mainnet-beta. The SPL programs are deployed to the same addresses on every cluster.

## Core Program IDs

| Program | Address | Export |
|---------|---------|--------|
| **SPL Token (classic)** | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | `TOKEN_PROGRAM_ID` |
| **Associated Token Account** | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` | `ASSOCIATED_TOKEN_PROGRAM_ID` |
| **Token-2022 (Token Extensions)** | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` | `TOKEN_2022_PROGRAM_ID` |
| **Wrapped SOL (NATIVE_MINT)** | `So11111111111111111111111111111111111111112` | `NATIVE_MINT` |

## Cluster Endpoints

| Cluster | RPC URL | Airdrop |
|---------|---------|---------|
| **Devnet** | `https://api.devnet.solana.com` | Available (rate-limited) |
| **Testnet** | `https://api.testnet.solana.com` | Available (rate-limited) |
| **Mainnet-beta** | `https://api.mainnet-beta.solana.com` | Not available — must use a funded keypair |

Use `clusterApiUrl('devnet')` from `@solana/web3.js` to get the cluster endpoint. For production, use a dedicated RPC provider (Helius, QuickNode, Triton, etc.) to avoid rate limits and get enhanced APIs.

## Program ID Selection

The single most important rule: **pass the correct program ID to every call.**

- A **classic Token** mint is owned by `TOKEN_PROGRAM_ID`.
- A **Token-2022** mint is owned by `TOKEN_2022_PROGRAM_ID`.
- The **Associated Token Account** program is the same for both — `ASSOCIATED_TOKEN_PROGRAM_ID` — but you must pass the *token program ID* as the final parameter to `getAssociatedTokenAddressSync` so the PDA is derived correctly.

```typescript
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';

// Classic mint ATA:
const classicAta = getAssociatedTokenAddressSync(
  classicMint,
  owner,
  false,
  TOKEN_PROGRAM_ID,
);

// Token-2022 mint ATA:
const t22Ata = getAssociatedTokenAddressSync(
  t22Mint,
  owner,
  false,
  TOKEN_2022_PROGRAM_ID,
);
```

If you omit the program ID, the SDK defaults to `TOKEN_PROGRAM_ID` (classic). This is correct for classic mints and wrong for Token-2022 mints. Always be explicit.

## How to Detect Which Program Owns a Mint

Read the account owner from the on-chain data:

```typescript
import { getMint, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

// Try classic first; if it fails, try Token-2022.
try {
  const mintInfo = await getMint(connection, mint, undefined, TOKEN_PROGRAM_ID);
  // mintInfo.address exists — this is a classic Token mint
} catch {
  const mintInfo = await getMint(connection, mint, undefined, TOKEN_2022_PROGRAM_ID);
  // this is a Token-2022 mint
}
```

Alternatively, check `connection.getAccountInfo(mint)` and inspect `.owner`:

```typescript
const accountInfo = await connection.getAccountInfo(mint);
if (accountInfo?.owner.equals(TOKEN_PROGRAM_ID)) {
  // classic Token program
} else if (accountInfo?.owner.equals(TOKEN_2022_PROGRAM_ID)) {
  // Token-2022
}
```

## NATIVE_MINT (Wrapped SOL)

`NATIVE_MINT` is `So11111111111111111111111111111111111111112` — a mint with 9 decimals that represents native SOL. Wrapping SOL into a WSOL ATA makes it compatible with any program that expects a standard SPL token account. Unwrapping closes the ATA and returns the lamports to the owner.

- **Wrap**: transfer lamports to the WSOL ATA, then `syncNative` to update the token program's recorded balance.
- **Unwrap**: `closeAccount` on the WSOL ATA — lamports go to the owner.

## Related Skills

- [Token-2022 Skill](../token-2022/SKILL.md) — for Token Extensions (transfer fees, metadata, soulbound, permanent delegate, transfer hooks, etc.)
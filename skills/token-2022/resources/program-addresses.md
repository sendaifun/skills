# Token-2022 Program Addresses

These addresses are the same on devnet, testnet, and mainnet-beta.

| Program | Address | Library constant |
|---------|---------|------------------|
| **Token-2022 (Token Extensions)** | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` | `TOKEN_2022_PROGRAM_ID` |
| **SPL Token (classic)** | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | `TOKEN_PROGRAM_ID` |
| **Associated Token Account** | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` | `ASSOCIATED_TOKEN_PROGRAM_ID` |

## Importing

```typescript
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
```

## Why the program ID matters

Token-2022 and the classic Token program are **separate on-chain programs** with
separate IDs. A Token-2022 mint account is owned by `TOKEN_2022_PROGRAM_ID`, so
every operation against it — deriving and creating ATAs, minting, transferring,
burning — must be told to use that program ID. The library helpers default to
the classic `TOKEN_PROGRAM_ID`, so omitting the argument silently targets the
wrong program and fails.

```typescript
// Correct for a Token-2022 mint:
const ata = getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID);
const ix = createAssociatedTokenAccountInstruction(
  payer, ata, owner, mint, TOKEN_2022_PROGRAM_ID,
);
```

## RPC endpoints

| Cluster | HTTP endpoint |
|---------|---------------|
| Devnet | `https://api.devnet.solana.com` (`clusterApiUrl('devnet')`) |
| Mainnet-beta | `https://api.mainnet-beta.solana.com` (`clusterApiUrl('mainnet-beta')`) |

Always develop and test on devnet first.

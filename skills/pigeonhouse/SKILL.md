---
name: pigeonhouse
creator: noegppgeon-boop
description: Complete PigeonHouse Protocol guide for building token launches with automatic PIGEON burn on Solana. Covers token creation on bonding curves, buying/selling with multi-quote support (PIGEON, SOL, SKR), deflationary burn mechanics, graduation to Raydium CPMM, referral system, and API integration.
---

# PigeonHouse Protocol Integration Guide

A comprehensive guide for building applications with PigeonHouse — a Solana token launchpad where every trade permanently burns PIGEON tokens.

## Overview

PigeonHouse is a deflationary token launch protocol on Solana:
- **Bonding Curve Trading** — Create Token-2022 tokens with instant trading, no initial liquidity required
- **Automatic PIGEON Burn** — 1.5% of every PIGEON-paired trade is permanently burned
- **Multi-Quote Support** — Launch and trade tokens against PIGEON, SOL, or SKR
- **Graduation** — Tokens that hit threshold auto-migrate to Raydium CPMM with locked LP
- **Referral System** — 0.5% fee share for referrers
- **Verified Build** — OtterSec verified, open source, IDL on-chain

## Program IDs

| Program | Address |
|---------|---------|
| PigeonHouse | `BV1RxkAaD5DjXMsnofkVikFUUYdrDg1v8YgsQ3iyDNoL` |
| Hook Program | `49NjaVFxXUhWg59g4bEDtcNQxsArFz9MnyeQGPxUDugi` |
| Raydium CPMM | `CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C` |

## Token Addresses

| Token | Mint |
|-------|------|
| PIGEON | `4fSWEw2wbYEUCcMtitzmeGUfqinoafXxkhqZrA9Gpump` |
| SOL (wSOL) | `So11111111111111111111111111111111111111112` |
| SKR | `SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3` |

## Quick Start

### Installation

```bash
# Core Solana dependencies
npm install @solana/web3.js @solana/spl-token @coral-xyz/anchor

# For frontend wallet integration
npm install @solana/wallet-adapter-react @solana/wallet-adapter-wallets
```

### Basic Setup

```typescript
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";

const PIGEON_HOUSE_PROGRAM_ID = new PublicKey("BV1RxkAaD5DjXMsnofkVikFUUYdrDg1v8YgsQ3iyDNoL");
const PIGEON_MINT = new PublicKey("4fSWEw2wbYEUCcMtitzmeGUfqinoafXxkhqZrA9Gpump");

const connection = new Connection("https://api.mainnet-beta.solana.com");
```

## Account Structures

### GlobalConfig

On-chain configuration for the entire protocol.

```typescript
interface GlobalConfig {
  authority: PublicKey;           // Program authority
  pigeonMint: PublicKey;          // PIGEON token mint
  treasury: PublicKey;            // Treasury wallet
  platformFeeBps: number;        // Platform fee (200 = 2%)
  graduationPigeonAmount: bigint; // PIGEON threshold for graduation
  virtualPigeonReserves: bigint;  // Default virtual PIGEON reserves
  virtualTokenReserves: bigint;   // Default virtual token reserves
  totalTokensLaunched: bigint;    // Counter
  totalPigeonBurned: bigint;      // Total PIGEON burned
  bump: number;
}
```

### BondingCurve

Per-token bonding curve state.

```typescript
interface BondingCurve {
  tokenMint: PublicKey;           // Token mint address
  creator: PublicKey;             // Token creator
  quoteMint: PublicKey;           // Quote asset (PIGEON, SOL, or SKR)
  virtualPigeonReserves: bigint;  // Virtual quote reserves
  virtualTokenReserves: bigint;   // Virtual token reserves
  realPigeonReserves: bigint;     // Real quote deposited
  realTokenReserves: bigint;      // Real tokens remaining
  tokenTotalSupply: bigint;       // Total supply (1B, 6 decimals)
  complete: boolean;              // True if graduated
  createdAt: bigint;              // Unix timestamp
  name: string;                   // Token name
  symbol: string;                 // Token symbol
  uri: string;                    // Metadata URI (Arweave)
  bump: number;
}
```

### QuoteAssetConfig

Configuration per quote asset (PIGEON, SOL, SKR).

```typescript
interface QuoteAssetConfig {
  mint: PublicKey;
  symbol: string;
  decimals: number;               // 6 for PIGEON, 9 for SOL, 6 for SKR
  kind: "Pigeon" | "Sol" | "Other";
  tokenProgram: PublicKey;
  enabledForLaunch: boolean;
  enabledForTrade: boolean;
  graduationThreshold: bigint;    // Quote amount to trigger graduation
  virtualQuoteReserves: bigint;
  virtualTokenReserves: bigint;
  platformFeeBps: number;         // 200 = 2%
  pigeonBurnBps: number;          // 150 = 1.5% (PIGEON pairs only)
  reserveBps: number;             // 150 = 1.5% (SOL/SKR pairs)
  treasuryBps: number;            // 50 = 0.5%
  referralBps: number;            // 0 (included in burn/reserve)
  reserveEnabled: boolean;
  reserveCap: bigint;
  bump: number;
}
```

## Deriving PDAs

```typescript
// GlobalConfig PDA
function getGlobalConfigPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pigeon_house_config")],
    PIGEON_HOUSE_PROGRAM_ID
  );
}

// BondingCurve PDA (per token)
function getBondingCurvePDA(tokenMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bonding_curve"), tokenMint.toBuffer()],
    PIGEON_HOUSE_PROGRAM_ID
  );
}

// FeeVault PDA
function getFeeVaultPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("fee_vault")],
    PIGEON_HOUSE_PROGRAM_ID
  );
}

// QuoteAssetConfig PDA
function getQuoteAssetPDA(quoteMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("quote_asset"), quoteMint.toBuffer()],
    PIGEON_HOUSE_PROGRAM_ID
  );
}

// BurnAccrualVault PDA (for non-PIGEON quote assets)
function getBurnAccrualVaultPDA(quoteMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("burn_accrual"), quoteMint.toBuffer()],
    PIGEON_HOUSE_PROGRAM_ID
  );
}

// StrategicReserveVault PDA (for non-PIGEON quote assets)
function getReserveVaultPDA(quoteMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("strategic_reserve"), quoteMint.toBuffer()],
    PIGEON_HOUSE_PROGRAM_ID
  );
}
```

## Instructions

### Create Token

Creates a new Token-2022 token with a bonding curve. All tokens start at 1B supply with 6 decimals.

```typescript
import {
  Connection, PublicKey, Transaction, TransactionInstruction,
  SystemProgram, Keypair, SYSVAR_RENT_PUBKEY
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync
} from "@solana/spl-token";
import crypto from "crypto";

async function createToken(
  connection: Connection,
  payer: Keypair,
  name: string,
  symbol: string,
  uri: string,   // Arweave/Irys metadata URI
  quoteMint: PublicKey = PIGEON_MINT,
  initialBuyAmount?: bigint  // Optional: buy tokens in same TX
): Promise<{ mint: PublicKey; signature: string }> {

  const mint = Keypair.generate();
  const [globalConfig] = getGlobalConfigPDA();
  const [bondingCurve, bondingCurveBump] = getBondingCurvePDA(mint.publicKey);
  const [feeVault] = getFeeVaultPDA();
  const [quoteAsset] = getQuoteAssetPDA(quoteMint);

  // Bonding curve's token ATA (Token-2022)
  const bondingCurveTokenAta = getAssociatedTokenAddressSync(
    mint.publicKey, bondingCurve, true, TOKEN_2022_PROGRAM_ID
  );

  // Bonding curve's quote ATA
  const quoteTokenProgram = quoteMint.equals(PIGEON_MINT)
    ? TOKEN_2022_PROGRAM_ID  // PIGEON is Token-2022
    : TOKEN_2022_PROGRAM_ID; // Adjust based on quote asset
  const bondingCurveQuoteAta = getAssociatedTokenAddressSync(
    quoteMint, bondingCurve, true, quoteTokenProgram
  );

  // Fee vault's PIGEON ATA
  const feeVaultPigeonAta = getAssociatedTokenAddressSync(
    PIGEON_MINT, feeVault, true, TOKEN_2022_PROGRAM_ID
  );

  // Build instruction data
  const disc = crypto.createHash("sha256")
    .update("global:create_token").digest().subarray(0, 8);

  const nameBytes = Buffer.from(name, "utf8");
  const symbolBytes = Buffer.from(symbol, "utf8");
  const uriBytes = Buffer.from(uri, "utf8");

  const data = Buffer.alloc(
    8 + 4 + nameBytes.length + 4 + symbolBytes.length + 4 + uriBytes.length + 1 + 8
  );
  let offset = 0;
  disc.copy(data, offset); offset += 8;
  data.writeUInt32LE(nameBytes.length, offset); offset += 4;
  nameBytes.copy(data, offset); offset += nameBytes.length;
  data.writeUInt32LE(symbolBytes.length, offset); offset += 4;
  symbolBytes.copy(data, offset); offset += symbolBytes.length;
  data.writeUInt32LE(uriBytes.length, offset); offset += 4;
  uriBytes.copy(data, offset); offset += uriBytes.length;

  // initial_buy_pigeon: Option<u64>
  if (initialBuyAmount !== undefined) {
    data.writeUInt8(1, offset); offset += 1;
    data.writeBigUInt64LE(initialBuyAmount, offset);
  } else {
    data.writeUInt8(0, offset);
  }

  const ix = new TransactionInstruction({
    programId: PIGEON_HOUSE_PROGRAM_ID,
    keys: [
      { pubkey: globalConfig, isSigner: false, isWritable: true },
      { pubkey: mint.publicKey, isSigner: true, isWritable: true },
      { pubkey: bondingCurve, isSigner: false, isWritable: true },
      { pubkey: bondingCurveTokenAta, isSigner: false, isWritable: true },
      { pubkey: bondingCurveQuoteAta, isSigner: false, isWritable: true },
      { pubkey: feeVault, isSigner: false, isWritable: true },
      { pubkey: feeVaultPigeonAta, isSigner: false, isWritable: true },
      { pubkey: quoteMint, isSigner: false, isWritable: false },
      { pubkey: quoteAsset, isSigner: false, isWritable: false },
      { pubkey: PIGEON_MINT, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.sign(payer, mint);

  const sig = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction(sig);

  return { mint: mint.publicKey, signature: sig };
}
```

> **Important:** After `create_token`, you must create the user's Token-2022 ATA for the new mint in a separate transaction before buying.

### Buy Tokens

Buy tokens on the bonding curve by spending quote asset (PIGEON/SOL/SKR).

```typescript
async function buyTokens(
  connection: Connection,
  payer: Keypair,
  tokenMint: PublicKey,
  quoteMint: PublicKey,
  quoteAmountIn: bigint,    // Amount of quote to spend (in smallest units)
  minTokensOut: bigint,      // Slippage protection
  referrer?: PublicKey        // Optional referrer wallet
): Promise<string> {

  const [globalConfig] = getGlobalConfigPDA();
  const [bondingCurve] = getBondingCurvePDA(tokenMint);
  const [feeVault] = getFeeVaultPDA();
  const [quoteAsset] = getQuoteAssetPDA(quoteMint);

  const quoteTokenProgram = quoteMint.equals(PIGEON_MINT)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_2022_PROGRAM_ID;

  const bondingCurveTokenAta = getAssociatedTokenAddressSync(
    tokenMint, bondingCurve, true, TOKEN_2022_PROGRAM_ID
  );
  const bondingCurveQuoteAta = getAssociatedTokenAddressSync(
    quoteMint, bondingCurve, true, quoteTokenProgram
  );
  const userTokenAta = getAssociatedTokenAddressSync(
    tokenMint, payer.publicKey, false, TOKEN_2022_PROGRAM_ID
  );
  const userQuoteAta = getAssociatedTokenAddressSync(
    quoteMint, payer.publicKey, false, quoteTokenProgram
  );
  const feeVaultPigeonAta = getAssociatedTokenAddressSync(
    PIGEON_MINT, feeVault, true, TOKEN_2022_PROGRAM_ID
  );

  // Build buy instruction data
  const disc = crypto.createHash("sha256")
    .update("global:buy").digest().subarray(0, 8);
  const data = Buffer.alloc(24);
  disc.copy(data, 0);
  data.writeBigUInt64LE(quoteAmountIn, 8);
  data.writeBigUInt64LE(minTokensOut, 16);

  const keys = [
    { pubkey: globalConfig, isSigner: false, isWritable: true },
    { pubkey: bondingCurve, isSigner: false, isWritable: true },
    { pubkey: bondingCurveTokenAta, isSigner: false, isWritable: true },
    { pubkey: bondingCurveQuoteAta, isSigner: false, isWritable: true },
    { pubkey: feeVault, isSigner: false, isWritable: true },
    { pubkey: feeVaultPigeonAta, isSigner: false, isWritable: true },
    { pubkey: userTokenAta, isSigner: false, isWritable: true },
    { pubkey: userQuoteAta, isSigner: false, isWritable: true },
    { pubkey: tokenMint, isSigner: false, isWritable: false },
    { pubkey: quoteMint, isSigner: false, isWritable: false },
    { pubkey: PIGEON_MINT, isSigner: false, isWritable: true },
    { pubkey: quoteAsset, isSigner: false, isWritable: false },
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: quoteTokenProgram, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // For non-PIGEON quotes: must include burn accrual + reserve vault ATAs
  if (!quoteMint.equals(PIGEON_MINT)) {
    const [burnAccrualVault] = getBurnAccrualVaultPDA(quoteMint);
    const [reserveVault] = getReserveVaultPDA(quoteMint);
    const burnAccrualAta = getAssociatedTokenAddressSync(
      quoteMint, burnAccrualVault, true, quoteTokenProgram
    );
    const reserveAta = getAssociatedTokenAddressSync(
      quoteMint, reserveVault, true, quoteTokenProgram
    );
    keys.push(
      { pubkey: burnAccrualAta, isSigner: false, isWritable: true },
      { pubkey: reserveAta, isSigner: false, isWritable: true }
    );
  }

  // Optional referrer (appended as remaining_account)
  if (referrer) {
    const referrerQuoteAta = getAssociatedTokenAddressSync(
      quoteMint, referrer, false, quoteTokenProgram
    );
    keys.push({ pubkey: referrerQuoteAta, isSigner: false, isWritable: true });
  }

  const ix = new TransactionInstruction({
    programId: PIGEON_HOUSE_PROGRAM_ID, keys, data,
  });

  const tx = new Transaction().add(ix);
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.sign(payer);

  return connection.sendRawTransaction(tx.serialize());
}
```

### Sell Tokens

Sell tokens back to the bonding curve for quote asset.

```typescript
async function sellTokens(
  connection: Connection,
  payer: Keypair,
  tokenMint: PublicKey,
  quoteMint: PublicKey,
  tokenAmountIn: bigint,    // Tokens to sell
  minQuoteOut: bigint,       // Slippage protection
  referrer?: PublicKey
): Promise<string> {

  const [globalConfig] = getGlobalConfigPDA();
  const [bondingCurve] = getBondingCurvePDA(tokenMint);
  const [feeVault] = getFeeVaultPDA();
  const [quoteAsset] = getQuoteAssetPDA(quoteMint);

  const quoteTokenProgram = quoteMint.equals(PIGEON_MINT)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_2022_PROGRAM_ID;

  const bondingCurveTokenAta = getAssociatedTokenAddressSync(
    tokenMint, bondingCurve, true, TOKEN_2022_PROGRAM_ID
  );
  const bondingCurveQuoteAta = getAssociatedTokenAddressSync(
    quoteMint, bondingCurve, true, quoteTokenProgram
  );
  const userTokenAta = getAssociatedTokenAddressSync(
    tokenMint, payer.publicKey, false, TOKEN_2022_PROGRAM_ID
  );
  const userQuoteAta = getAssociatedTokenAddressSync(
    quoteMint, payer.publicKey, false, quoteTokenProgram
  );
  const feeVaultPigeonAta = getAssociatedTokenAddressSync(
    PIGEON_MINT, feeVault, true, TOKEN_2022_PROGRAM_ID
  );

  const disc = crypto.createHash("sha256")
    .update("global:sell").digest().subarray(0, 8);
  const data = Buffer.alloc(24);
  disc.copy(data, 0);
  data.writeBigUInt64LE(tokenAmountIn, 8);
  data.writeBigUInt64LE(minQuoteOut, 16);

  // Note: sell has different account layout than buy
  // No SystemProgram or ASSOCIATED_TOKEN_PROGRAM_ID
  const keys = [
    { pubkey: globalConfig, isSigner: false, isWritable: true },
    { pubkey: bondingCurve, isSigner: false, isWritable: true },
    { pubkey: bondingCurveTokenAta, isSigner: false, isWritable: true },
    { pubkey: bondingCurveQuoteAta, isSigner: false, isWritable: true },
    { pubkey: feeVault, isSigner: false, isWritable: true },
    { pubkey: feeVaultPigeonAta, isSigner: false, isWritable: true },
    { pubkey: userTokenAta, isSigner: false, isWritable: true },
    { pubkey: userQuoteAta, isSigner: false, isWritable: true },
    { pubkey: tokenMint, isSigner: false, isWritable: false },
    { pubkey: quoteMint, isSigner: false, isWritable: false },
    { pubkey: PIGEON_MINT, isSigner: false, isWritable: true },
    { pubkey: quoteAsset, isSigner: false, isWritable: false },
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: quoteTokenProgram, isSigner: false, isWritable: false },
  ];

  // Non-PIGEON quotes: remaining_accounts
  if (!quoteMint.equals(PIGEON_MINT)) {
    const [burnAccrualVault] = getBurnAccrualVaultPDA(quoteMint);
    const [reserveVault] = getReserveVaultPDA(quoteMint);
    keys.push(
      { pubkey: getAssociatedTokenAddressSync(quoteMint, burnAccrualVault, true, quoteTokenProgram), isSigner: false, isWritable: true },
      { pubkey: getAssociatedTokenAddressSync(quoteMint, reserveVault, true, quoteTokenProgram), isSigner: false, isWritable: true }
    );
  }

  if (referrer) {
    keys.push({
      pubkey: getAssociatedTokenAddressSync(quoteMint, referrer, false, quoteTokenProgram),
      isSigner: false, isWritable: true
    });
  }

  const ix = new TransactionInstruction({
    programId: PIGEON_HOUSE_PROGRAM_ID, keys, data,
  });

  const tx = new Transaction().add(ix);
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.sign(payer);

  return connection.sendRawTransaction(tx.serialize());
}
```

## Bonding Curve Math

PigeonHouse uses the constant product formula (x * y = k) for price discovery.

```typescript
// Calculate tokens received for a given quote input
function getQuoteBuy(
  quoteAmountIn: bigint,
  virtualQuoteReserves: bigint,
  virtualTokenReserves: bigint,
  feeBps: number
): bigint {
  const fee = (quoteAmountIn * BigInt(feeBps)) / BigInt(10000);
  const netInput = quoteAmountIn - fee;
  const newQuoteReserves = virtualQuoteReserves + netInput;
  const newTokenReserves = (virtualQuoteReserves * virtualTokenReserves) / newQuoteReserves;
  return virtualTokenReserves - newTokenReserves;
}

// Calculate quote received for a given token input
function getQuoteSell(
  tokenAmountIn: bigint,
  virtualQuoteReserves: bigint,
  virtualTokenReserves: bigint,
  feeBps: number
): bigint {
  const newTokenReserves = virtualTokenReserves + tokenAmountIn;
  const newQuoteReserves = (virtualQuoteReserves * virtualTokenReserves) / newTokenReserves;
  const grossOutput = virtualQuoteReserves - newQuoteReserves;
  const fee = (grossOutput * BigInt(feeBps)) / BigInt(10000);
  return grossOutput - fee;
}

// Calculate current token price in quote asset
function getCurrentPrice(
  virtualQuoteReserves: bigint,
  virtualTokenReserves: bigint,
  quoteDecimals: number = 6
): number {
  return Number(virtualQuoteReserves) / Number(virtualTokenReserves);
}
```

## Fee Structure

| Quote Asset | Total Fee | Burn | Reserve | Treasury |
|-------------|-----------|------|---------|----------|
| PIGEON | 2% | 1.5% 🔥 | — | 0.5% |
| SOL | 2% | — | 1.5% | 0.5% |
| SKR | 2% | — | 1.5% | 0.5% |

**Referral:** When a referrer is provided via `remaining_accounts`, 0.5% goes to the referrer (deducted from burn or reserve portion).

For PIGEON-paired trades, the 1.5% burn fee is applied as `BurnChecked` — tokens are permanently destroyed on every trade.

## Graduation

When a bonding curve's real quote reserves reach the graduation threshold, anyone can call `graduate` to migrate liquidity to Raydium CPMM.

**Graduation thresholds:**
- PIGEON: 4,487,179 PIGEON
- SOL: 84 SOL (84,000,000,000 lamports)
- SKR: 659,687 SKR

After graduation:
- Remaining tokens + quote reserves are deposited into a Raydium CPMM pool
- LP tokens are locked (sent to dead address)
- The bonding curve is marked `complete = true`
- Post-graduation trading happens on Raydium with 1.20% creator fee

## API Endpoints

PigeonHouse provides REST APIs at `https://941pigeon.fun`:

### List All Tokens
```
GET /api/platform
```
Returns all active tokens with bonding curve data, prices, and market caps.

### Get Token Details
```
GET /api/token/{mint}
```
Returns bonding curve state, name, symbol, URI, and config for a specific token.

### Get Trades
```
GET /api/trades/{mint}?limit=30
```
Returns recent trades for a token with price, amount, trader, and direction.

### Get USD Prices
```
GET /api/prices
```
Returns USD prices for PIGEON, SOL, and SKR via DexScreener.

### Leaderboard
```
GET /api/leaderboard
```
Returns top traders and creators by volume and PnL.

### Jupiter Quote (SOL → PIGEON swap)
```
GET /api/jupiter-quote?inputMint=So111...&outputMint=4fSW...&amount=1000000000
```
Proxies Jupiter API for swap quotes.

## Solana Actions (Blinks)

PigeonHouse supports Solana Actions for one-click buys from any URL:

```
GET /api/actions/buy/{mint}     → ActionGetResponse (token info + buy buttons)
POST /api/actions/buy/{mint}    → ActionPostResponse (signable transaction)
```

Share a blink URL:
```
https://dial.to/?action=solana-action:https://941pigeon.fun/api/actions/buy/{mint}
```

## Fetching On-Chain Data

### Read Bonding Curve State

```typescript
import * as anchor from "@coral-xyz/anchor";

async function getBondingCurveState(
  connection: Connection,
  tokenMint: PublicKey
): Promise<BondingCurve | null> {
  const [pda] = getBondingCurvePDA(tokenMint);
  const accountInfo = await connection.getAccountInfo(pda);
  if (!accountInfo) return null;

  // Use Anchor IDL to decode
  // IDL available at: https://941pigeon.fun/idl/pigeon_house.json
  const coder = new anchor.BorshAccountsCoder(idl as anchor.Idl);
  return coder.decode("BondingCurve", accountInfo.data);
}
```

### Read Global Config

```typescript
async function getGlobalConfig(connection: Connection): Promise<GlobalConfig> {
  const [pda] = getGlobalConfigPDA();
  const accountInfo = await connection.getAccountInfo(pda);
  const coder = new anchor.BorshAccountsCoder(idl as anchor.Idl);
  return coder.decode("GlobalConfig", accountInfo!.data);
}
```

## Key Differences from PumpFun

| Feature | PigeonHouse | PumpFun |
|---------|-------------|---------|
| Token Standard | Token-2022 | SPL (legacy) + Token2022 |
| Quote Assets | PIGEON, SOL, SKR | SOL only |
| Burn Mechanism | 1.5% per trade (auto) | None |
| Graduation Target | Raydium CPMM | PumpSwap AMM |
| LP After Graduation | Locked (dead address) | Burned |
| Referral System | 0.5% to referrer | Creator fees |
| Verified Build | OtterSec verified | Not verified |
| Open Source | Yes (GitHub) | No |

## Important Notes

1. **Token-2022 throughout** — All tokens (including PIGEON) use Token-2022. Always use `TOKEN_2022_PROGRAM_ID` for token operations.

2. **Non-PIGEON quotes need remaining_accounts** — When trading SOL or SKR paired tokens, you MUST include `burn_accrual_vault_ata` and `reserve_vault_ata` as remaining accounts.

3. **Sell has different account layout** — The sell instruction does NOT include `SystemProgram` or `ASSOCIATED_TOKEN_PROGRAM_ID` (unlike buy).

4. **Create ATA separately** — After `create_token`, the user's Token-2022 ATA must be created in a separate transaction before the first buy.

5. **IDL on-chain** — The full Anchor IDL is stored on-chain at account `4NSPSSeBaTBSDivYoXA3aAz4V8Q5CBEmfjstbuyhdSvn` and available at `https://941pigeon.fun/idl/pigeon_house.json`.

## Resources

- **Website:** https://941pigeon.fun
- **GitHub:** https://github.com/noegppgeon-boop/Pigeonhouse
- **OtterSec Verification:** https://verify.osec.io/status/BV1RxkAaD5DjXMsnofkVikFUUYdrDg1v8YgsQ3iyDNoL
- **IDL:** https://941pigeon.fun/idl/pigeon_house.json
- **X/Twitter:** https://x.com/941pigeondotfun

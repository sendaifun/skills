---
name: depeg-public
description: DEPEG protocol integration guide for AI agents — Solana program that wraps pump.fun memecoins as 1:1 USDC-backed stablecoins with staking, boosters, and yield distribution. Covers read access to on-chain state (Config / StakingPool / StakePosition / UserPoolState) and the user-facing instruction surface (swap USDC↔stablecoin, stake, claim rewards, unstake, buy booster). Includes PDA derivation, transaction construction examples, and parsing the DEPEG_PROTOCOL on-chain log format. For external trading bots, indexers, and integrators.
---

# DEPEG Protocol — Agent Integration Guide

DEPEG (https://depeg.app) is a Solana protocol layered on top of pump.fun. For every pump.fun coin registered with DEPEG, the program mints a paired **stablecoin** backed 1:1 by USDC. Trade fees from pump.fun's bonding curve are split five ways — into the USDC vault, the staking pool, and protocol/creator buckets.

Holders can:
- **Swap** USDC ↔ stablecoin at 1:1
- **Stake** stablecoins for lock-period-boosted yield in USDC (delivered as more stablecoin)
- **Buy boosters** with SOL to amplify their reward share for 7 days

This skill covers everything an external integrator needs to read state and submit user-facing transactions. It does not document protocol-operational instructions; those are handled by the DEPEG team and bots.

---

## Program

- **Program ID** (mainnet + devnet): `Be3rdwxjwhoYFvRwm7j8jGKPctgHz2btsuoQSqWvvJzj`
- **IDL**: distributed via the `@depegprotocol/sdk` npm package.

## External programs DEPEG interacts with

| Program | Address | Why |
|---|---|---|
| pump.fun | `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` | Source memecoin |
| Metaplex Token Metadata | `metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s` | Stablecoin metadata |

## Token mints

- **USDC mainnet**: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (6 decimals)
- **USDC devnet**: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (6 decimals)

---

## PDAs

### Per-coin (one set per `coin_mint` registered with DEPEG)

```ts
import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";

const PROGRAM = new PublicKey("Be3rdwxjwhoYFvRwm7j8jGKPctgHz2btsuoQSqWvvJzj");
const seed = (s: string) => Buffer.from(s);

const [config]        = PublicKey.findProgramAddressSync([seed("config"),        coinMint.toBuffer()], PROGRAM);
const [stablecoinMint]= PublicKey.findProgramAddressSync([seed("scoin_mint"),    coinMint.toBuffer()], PROGRAM); // the 1:1 USDC-backed companion token
const [stakingPool]   = PublicKey.findProgramAddressSync([seed("staking_pool"),  coinMint.toBuffer()], PROGRAM);
const [stakingVault]  = PublicKey.findProgramAddressSync([seed("staking_vault"), coinMint.toBuffer()], PROGRAM);
const [buybackVault]  = PublicKey.findProgramAddressSync([seed("buyback_vault"), coinMint.toBuffer()], PROGRAM);

// ATAs (standard SPL ATA, owned by the config PDA)
const usdcVault       = getAssociatedTokenAddressSync(USDC_MINT,      config, true, TOKEN_PROGRAM_ID);
const stablecoinVault = getAssociatedTokenAddressSync(stablecoinMint, config, true, TOKEN_PROGRAM_ID);
```

The seed `scoin_mint` is a legacy internal label — the resulting PDA is the **stablecoin mint** (Token-2022, 6 decimals).

### Per-user (one per `(coin_mint, user)`)

```ts
const [userPoolState] = PublicKey.findProgramAddressSync(
  [seed("user_pool_state"), coinMint.toBuffer(), user.toBuffer()],
  PROGRAM,
);

// One per position. position_id is caller-chosen u64.
const positionIdBuf = Buffer.alloc(8); positionIdBuf.writeBigUInt64LE(BigInt(positionId));
const [position] = PublicKey.findProgramAddressSync(
  [seed("position"), coinMint.toBuffer(), user.toBuffer(), positionIdBuf],
  PROGRAM,
);
```

---

## Account layouts (state reads)

All accounts use the standard Anchor 8-byte discriminator prefix.

### `Config` (per-coin)

```
struct Config {
  admin: Pubkey,              // 32
  creator: Pubkey,            // 32
  coin_mint: Pubkey,          // 32
  stablecoin_mint: Pubkey,    // 32 (IDL field name: scoin_mint)
  usdc_mint: Pubkey,          // 32
  usdc_vault: Pubkey,         // 32 — invariant: balance == stablecoin_supply
  stablecoin_vault: Pubkey,   // 32 (IDL: scoin_vault)
  paused: bool,               //  1 — if true, swaps reject
  is_platform_pool: bool,     //  1
  creator_bps: u16,           //  2
  vault_bps: u16,             //  2
  platform_bps: u16,          //  2
  treasury_bps: u16,          //  2
  staking_bps: u16,           //  2
  bump: u8,                   //  1
}
```

### `StakingPool` (per-coin)

```
struct StakingPool {
  coin_mint: Pubkey,            // 32
  stablecoin_mint: Pubkey,      // 32 (IDL: scoin_mint)
  staking_vault: Pubkey,        // 32
  total_staked_amount: u64,     //  8 — sum of raw amounts (no boost)
  total_effective_stake: u128,  // 16 — sum of (amount × boost / 10_000)
  acc_rewards_per_stake: u128,  // 16 — MasterChef accumulator (×1e12)
  bump: u8,                     //  1
}
```

To compute pending rewards for a position **client-side**:

```ts
const REWARDS_SCALE = 1_000_000_000_000n; // 1e12
const BPS_DENOM = 10_000n;

// user_boost_bps comes from UserPoolState. Default to 10_000n (no booster).
const userBoostBps = userState?.boostExpiresAt && Date.now() / 1000 < userState.boostExpiresAt
  ? BigInt(userState.boostBps)
  : BPS_DENOM;

const effectiveWithBoost = (position.effectiveStake * userBoostBps) / BPS_DENOM;
const totalDue = (effectiveWithBoost * pool.accRewardsPerStake) / REWARDS_SCALE;
const pending = totalDue > position.rewardDebt
  ? Number(totalDue - position.rewardDebt)
  : 0;
```

### `StakePosition` (per-(user, coin_mint, position_id))

```
struct StakePosition {
  owner: Pubkey,         // 32
  coin_mint: Pubkey,     // 32
  position_id: u64,      //  8
  amount: u64,           //  8 — staked stablecoin (6 decimals)
  lock_period: u8,       //  1 — enum: 0=OneDay, 1=ThreeDays, 2=OneWeek,
                         //          3=TwoWeeks, 4=OneMonth, 5=ThreeMonths,
                         //          6=SixMonths, 7=OneYear
  effective_stake: u128, // 16 — BASE effective: amount × lock_boost_bps / 10_000
  locked_until: i64,     //  8 — unix timestamp; unstake rejects before this
  reward_debt: u128,     // 16 — snapshot for the MasterChef accumulator
  bump: u8,              //  1
}
```

### `UserPoolState` (per-(user, coin_mint))

```
struct UserPoolState {
  owner: Pubkey,           // 32
  coin_mint: Pubkey,       // 32
  position_count: u8,      //  1 — max 4
  boost_bps: u16,          //  2 — 0 means no active booster (use 10_000n in math)
  boost_expires_at: i64,   //  8
  bump: u8,                //  1
}
```

When `boost_bps > 0` and `now < boost_expires_at`, the user's effective stake on **every** position they own in this pool is multiplied by `boost_bps / 10_000` for reward distribution.

---

## User-facing instructions

Each ix below emits a `Program log: DEPEG_PROTOCOL [depeg::<name>] ...` line with **decimal-formatted amounts** (6 digits for USDC/stablecoin, 9 for SOL).

### `swap_usdc_to_stablecoin(amount: u64)`

Deposit USDC, receive newly-minted stablecoin 1:1. Invariant after every swap: `usdc_vault.amount == stablecoin_supply`.

> The on-chain ix is registered as `swap_usdc_to_scoin` in the IDL (legacy internal name). The SDK exposes it as `swapUsdcToStablecoin`.

```ts
await program.methods
  .swapUsdcToScoin(new BN(1_000_000))   // 1 USDC (6 decimals)
  .accounts({
    user: wallet.publicKey,
    coinMint,
    config,
    usdcMint: USDC_MINT,
    scoinMint: stablecoinMint,
    usdcVault,                           // ATA(usdcMint, config)
    userUsdcAta,                         // ATA(usdcMint, user)
    userScoinAta: userStablecoinAta,     // ATA(stablecoinMint, user) — caller must pre-create
    usdcTokenProgram: TOKEN_PROGRAM_ID,
    scoinTokenProgram: TOKEN_PROGRAM_ID,
  })
  .rpc();
```

Log:
```
DEPEG_PROTOCOL [depeg::swap_usdc_to_stablecoin] {user} swapped 1.000000 USDC for stablecoin {mint} (coin {coinMint})
```

### `swap_stablecoin_to_usdc(amount: u64)`

Burn stablecoin, receive USDC 1:1. Rejects if vault doesn't have enough USDC.

IDL: `swapScoinToUsdc`. Same accounts as above.

Log:
```
DEPEG_PROTOCOL [depeg::swap_stablecoin_to_usdc] {user} burned 1.000000 stablecoin {mint} for USDC (coin {coinMint})
```

### `stake(position_id: u64, amount: u64, lock_period: LockPeriod)`

Lock `amount` (raw 6-decimal) of stablecoin into the staking vault for the chosen `lock_period`. Creates a new `StakePosition`. `position_id` is caller-chosen.

**Constraints**:
- `amount` ≥ 1_000_000 (1 stablecoin)
- max 4 positions per (user, coin)

```ts
await program.methods
  .stake(new BN(positionId), new BN(amountRaw), { oneMonth: {} })
  .accounts({
    owner: wallet.publicKey,
    coinMint,
    config,
    scoinMint: stablecoinMint,
    ownerScoinAta,                       // ATA(stablecoinMint, owner)
    stakingPool,
    stakingVault,
    userPoolState,
    position,                            // derived from (coinMint, owner, positionId)
    scoinTokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

**Lock periods + boost multipliers** (`boost = round(days^1.5 × 10000)`):

| LockPeriod | Duration | boost_bps | Multiplier |
|---|---|---|---|
| OneDay (0) | 1 day | 10_000 | 1.000× |
| ThreeDays (1) | 3 days | 51_962 | 5.196× |
| OneWeek (2) | 7 days | 185_203 | 18.520× |
| TwoWeeks (3) | 14 days | 523_832 | 52.383× |
| OneMonth (4) | 30 days | 1_643_168 | 164.317× |
| ThreeMonths (5) | 90 days | 8_538_150 | 853.815× |
| SixMonths (6) | 180 days | 24_150_362 | 2,415.036× |
| OneYear (7) | 365 days | 69_747_419 | 6,974.742× |

Effective stake is `amount × boost_bps / 10_000`. Boosters multiply this further at reward-settle time.

Log:
```
DEPEG_PROTOCOL [depeg::stake] {owner} is staking 100.000000 stablecoin of coin {coinMint} for 30 days (position #N, locked_until=T)
```

### `claim_rewards()` (per position)

Settles pending rewards on one position; principal stays locked.

```ts
await program.methods
  .claimRewards()
  .accounts({
    owner: wallet.publicKey,
    coinMint, config, scoinMint: stablecoinMint,
    ownerScoinAta,
    stakingPool, stakingVault,
    userPoolState,
    position,
    scoinTokenProgram: TOKEN_PROGRAM_ID,
  })
  .rpc();
```

Logs:
```
DEPEG_PROTOCOL [depeg::claim_rewards] {owner} claimed 3.456789 stablecoin rewards from position #N of coin {coinMint}
DEPEG_PROTOCOL [depeg::claim_rewards] {owner} called claim on position #N of coin {coinMint} but had no pending rewards (no-op)
```

### `unstake()` (per position, after `locked_until`)

Withdraws principal + claims pending rewards in one tx. Closes the position account; rent refunded to owner. Rejects with `StillLocked` if `now < position.locked_until`.

```ts
await program.methods
  .unstake()
  .accounts({
    owner: wallet.publicKey,
    coinMint, config, scoinMint: stablecoinMint,
    ownerScoinAta,
    stakingPool, stakingVault,
    userPoolState,
    position,
    scoinTokenProgram: TOKEN_PROGRAM_ID,
  })
  .rpc();
```

Log:
```
DEPEG_PROTOCOL [depeg::unstake] {owner} unstaked position #N of coin {coinMint}: principal=100.000000 stablecoin, rewards=3.456789 stablecoin
```

### `buy_booster(tier: u8)`

Pays SOL into the per-coin `buyback_vault`, activates a 7-day reward multiplier on **all** the user's positions in this coin. Re-buying replaces any active boost (loses unused time).

**Requires `remaining_accounts`** to be every one of the user's current `StakePosition` accounts in this pool, in any order, **all writable**. Length must equal `user_pool_state.position_count` exactly.

**Booster tiers** (hardcoded):

| tier | boost | SOL price | Discount |
|---|---|---|---|
| 0 | 1.25× | 0.05 SOL | baseline |
| 1 | 1.5× | 0.09 SOL | 10% off |
| 2 | 1.75× | 0.1275 SOL | 15% off |
| 3 | 2× | 0.16 SOL | 20% off |
| 4 | 2.5× | 0.225 SOL | 25% off |
| 5 | 3× | 0.28 SOL | 30% off |

Duration: **7 days**.

```ts
const positionPdas = positionIds.map((id) => ({
  pubkey: derivePosition(coinMint, owner, id),
  isSigner: false,
  isWritable: true,
}));

await program.methods
  .buyBooster(tier)
  .accounts({
    user: wallet.publicKey,
    coinMint, config, scoinMint: stablecoinMint,
    userScoinAta,
    stakingPool, stakingVault,
    userPoolState,
    buybackVault,
    scoinTokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .remainingAccounts(positionPdas)
  .rpc();
```

Log:
```
DEPEG_PROTOCOL [depeg::buy_booster] {user} bought tier-N booster (Xbps multiplier) on coin {coinMint} for 0.050000000 SOL — applies to N position(s), expires_at=T (replaced_previous=…)
```

### Permissionless keeper instructions

These can be called by anyone — useful if you're running a keeper bot:

| Ix | Purpose |
|---|---|
| `deactivate_expired_boost` | Settle a user's positions at their expired boost (pays out earned-at-boost rewards), then drop their `boost_bps` to 0. Call **before** the next fee/yield event for that pool, after the user's `boost_expires_at`. Accounts: user, user_pool_state, staking_pool, staking_vault, scoin_mint, owner_scoin_ata, scoin_token_program + all of the user's positions in `remaining_accounts` (writable). |
| `sweep_pump_creator` | Drain accumulated pump.fun trade fees from DEPEG's per-coin `pump_creator` PDA, split 5 ways and deliver. Permissionless — anyone pays gas. |
| `collect_and_distribute_creator_fees` | Older variant of the same — CPIs into pump.fun's `collect_creator_fee` before the split. Use this for coins where DEPEG's PDA is still the bonding-curve creator. |
| `collect_amm_creator_fees` | Same idea for post-graduation AMM creator fees on PumpSwap. |

All four emit `DEPEG_PROTOCOL [depeg::...]` logs.

### Pool launch

| Ix | Purpose |
|---|---|
| `initialize_user_pool(stablecoin_name, stablecoin_symbol, stablecoin_uri, seed_amount, vault_bps, staking_bps)` | Wrap a pump.fun coin as a DEPEG pool. Co-signed by the deployer and the DEPEG platform signer (the latter handled by https://depeg.app's co-sign endpoint). Atomically initialises Config + stablecoin mint (Token-2022, 6 decimals) + Metaplex metadata + USDC vault + stablecoin vault + StakingPool + StakingVault, then pulls `seed_amount` USDC from the deployer into the USDC vault and mints matching stablecoin into the stablecoin vault. Caps: `seed_amount ≥ 5_000_000` (5 USDC), `vault_bps ≥ 500`, `staking_bps ≥ 500`, `vault_bps + staking_bps + 1000` (the fixed platform+treasury share) ≤ 10000. Whatever's left becomes `creator_bps`. SDK helper: `client.ix.initializeUserPool({...})`. |

### Protocol operations

These instructions are part of the program's operational surface. They appear in transactions submitted by DEPEG's protocol infrastructure (yield routing, buybacks, treasury management) and are documented here so external indexers and analytics can decode the corresponding events.

| Ix | Purpose | Event emitted |
|---|---|---|
| `inject_yield(usdc_to_vault, usdc_to_staking)` | Lands USDC into a pool after an off-chain swap. The vault portion mints matching stablecoin into `scoin_vault` (yield reservoir). The staking portion mints matching stablecoin into `staking_vault` and bumps the per-share `acc_rewards_per_stake`. | `YieldInjected` |
| `record_buyback_and_burn(sol_spent, coin_amount)` | Burns pump.fun coin (post off-chain swap) and audit-logs the amount of SOL spent + coin burned for the deflationary buyback flow. | `BuybackBurned` |
| `seed_platform_from_treasury(amount)` | Drains accumulated USDC from the Treasury USDC ATA into the platform pool's USDC vault + mints matching stablecoin into `scoin_vault`. Used to deposit pre-launch protocol fees into the platform pool once it's been designated. | (emits `DEPEG_PROTOCOL [depeg::seed_platform]` log) |

These ixs are accessible via `client.program.methods.injectYield(...)` etc. when you need to build or decode them.

---

## DEPEG_PROTOCOL log format

Every successful instruction emits **exactly one** log line starting with `DEPEG_PROTOCOL [depeg::<ix_name>]`. Format guarantees:

1. The prefix `DEPEG_PROTOCOL [depeg::` is grep-able and unique within the program.
2. The ix name after the `::` matches a stable, public name (e.g. `swap_usdc_to_stablecoin`, `stake`, `claim_rewards`).
3. **Amounts are pre-formatted as decimal strings**:
   - USDC / stablecoin / pump-coin tokens: 6 decimal digits (e.g. `1.000000`)
   - SOL: 9 decimal digits (e.g. `0.050000000`)
4. bps values, position IDs, counts, unix timestamps: raw integers.
5. Pubkeys: base58.

### Indexer pattern

```ts
import { Connection } from "@solana/web3.js";

const PROGRAM = new PublicKey("Be3rdwxjwhoYFvRwm7j8jGKPctgHz2btsuoQSqWvvJzj");
const PATTERN = /^Program log: DEPEG_PROTOCOL \[depeg::([a-z_]+)\] (.+)$/;

connection.onLogs(PROGRAM, ({ logs, signature, err }) => {
  if (err) return;
  for (const line of logs) {
    const m = line.match(PATTERN);
    if (!m) continue;
    const [, ixName, body] = m;
    handleEvent(signature, ixName, body);
  }
}, "confirmed");
```

For typed event data (with raw u64 amounts etc.), Anchor `emit!()` events are also present in the tx — fetch via `connection.getTransaction(sig, { maxSupportedTransactionVersion: 0 })` and decode with the IDL's `EventParser`. The public events you can rely on are:

- `Staked`, `Unstaked`, `RewardsClaimed`
- `BoosterPurchased`, `BoosterDeactivated`
- `CreatorFeesCollected`, `AmmCreatorFeesCollected`
- `BuybackInitiated`, `BuybackBurned`
- `YieldInjected`

---

## Constants reference

```
PROGRAM_ID                            = Be3rdwxjwhoYFvRwm7j8jGKPctgHz2btsuoQSqWvvJzj
USDC_MAINNET                          = EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v

BPS_DENOM                             = 10_000
REWARDS_SCALE                         = 1_000_000_000_000   // ×1e12 fixed-point

MIN_STAKE_AMOUNT                      = 1_000_000           // 1 stablecoin (6 decimals)
MAX_POSITIONS_PER_USER_PER_COIN       = 4

BOOSTER_DURATION_SEC                  = 604_800             // 7 days

LockPeriod boost_bps & duration:        see table above
BOOSTER_TIERS (boost_bps, sol_price):    see table above
```

---

## Common gotchas

- **IDL is not on-chain.** Use the IDL distributed with `@depegprotocol/sdk`.
- **`scoin_vault` / `scoin_mint` legacy names.** The on-chain accounts/ixs still use the legacy `scoin` label internally. SDK and logs surface it as `stablecoin`. When using anchor.Program with the raw IDL, you'll see `scoinMint`/`scoinVault` field names in the accounts struct.
- **`scoin_vault` is an ATA, not a PDA of our program.** Same for `usdc_vault`. They're derived via `getAssociatedTokenAddressSync(mint, config, true, TOKEN_PROGRAM_ID)` with `allowOwnerOffCurve=true` because `config` is a PDA.
- **The stablecoin mint is Token-2022**, but USDC is classic SPL. Pass the right token program for each side. The stablecoin mint's owner is `TOKEN_2022_PROGRAM_ID`.
- **All `amount` parameters are raw u64 in calldata.** Decimal formatting only applies to the `DEPEG_PROTOCOL` log lines on-chain.
- **`buy_booster` must include every position the user has in this pool** in `remaining_accounts`, all writable. Off-by-one triggers `PositionCountMismatch`.
- **`unstake` only works after `locked_until`.** No early-exit by the user.
- **Booster expiry doesn't auto-deactivate.** A keeper bot must call `deactivate_expired_boost` to settle the user's positions back to base rate. Until that runs, the user keeps the higher boost — by design.

---

## Quick recipes

**Fetch all of a user's positions for a coin** (`position_count` lives in `UserPoolState`):

```ts
import bs58 from "bs58";

const userState = await program.account.userPoolState.fetch(userPoolStatePda);
// position_ids aren't enumerable on-chain — either index them from DEPEG_PROTOCOL
// [depeg::stake] logs, or:
const positions = await connection.getProgramAccounts(PROGRAM_ID, {
  filters: [
    { memcmp: { offset: 0,  bytes: bs58.encode(POSITION_DISCRIMINATOR) } },
    { memcmp: { offset: 8,  bytes: owner.toBase58() } },     // StakePosition.owner
    { memcmp: { offset: 40, bytes: coinMint.toBase58() } },  // StakePosition.coin_mint
  ],
});
```

**Fetch all DEPEG pools**:

```ts
const pools = await connection.getProgramAccounts(PROGRAM_ID, {
  filters: [
    { memcmp: { offset: 0, bytes: bs58.encode(CONFIG_DISCRIMINATOR) } },
  ],
});
// coin_mint is at offset 8 + 32 + 32 = 72 from start of data
```

Discriminators come from the IDL (`accounts[].discriminator`), or compute as `sha256("account:<Name>")[0..8]`.

**Subscribe to live protocol activity** (see the `Indexer pattern` section above).

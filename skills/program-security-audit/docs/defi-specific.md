# DeFi-Specific Security Patterns on Solana

## Overview

DeFi programs on Solana face a category of vulnerabilities beyond standard account validation. These arise from the economic logic of AMMs, lending protocols, staking programs, and oracle integrations. Load this file when auditing any program that handles swaps, liquidity, borrowing, or price feeds.

---

## 1. Oracle Price Manipulation

**Severity**: Critical (in DeFi contexts)

Protocols that read a spot price from a single DEX pool are vulnerable to flash-loan or large-trade price manipulation within the same block.

### Vulnerable Pattern
```rust
// VULNERABLE: reads spot price from a single Raydium pool
pub fn get_price(pool: &PoolState) -> Result<u64> {
    Ok(pool.token_b_amount / pool.token_a_amount) // manipulable spot price
}
```

### Safe Patterns

**Use Pyth or Switchboard oracle feeds:**
```rust
use pyth_sdk_solana::load_price_feed_from_account_info;

pub fn get_safe_price(pyth_account: &AccountInfo) -> Result<u64> {
    let price_feed = load_price_feed_from_account_info(pyth_account)
        .map_err(|_| ErrorCode::InvalidOracle)?;
    
    let price = price_feed.get_price_no_older_than(
        &Clock::get()?,
        60, // reject prices older than 60 seconds
    ).ok_or(ErrorCode::StalePrice)?;
    
    // Check confidence interval is tight enough
    require!(
        price.conf < price.price as u64 / 100, // confidence < 1% of price
        ErrorCode::OraclePriceTooUncertain
    );
    
    Ok(price.price as u64)
}
```

**Use TWAPs for on-chain price references:**
- Orca Whirlpools provides TWAP
- Raydium CLMM provides TWAP
- Never use `token_a_reserve / token_b_reserve` as a price in the same instruction that allows deposits/withdrawals

### Audit Checklist
- [ ] No spot price reads from a single pool in the same instruction that acts on that price
- [ ] Pyth/Switchboard price staleness checked (reject prices older than 60–120s)
- [ ] Pyth confidence interval validated
- [ ] TWAP used for collateral valuation in lending protocols

---

## 2. Slippage and Minimum Output Checks

**Severity**: High

Without slippage protection, users can be sandwich-attacked — a bot front-runs their transaction to move the price, then back-runs to profit.

### Vulnerable Pattern
```rust
// VULNERABLE: no minimum output enforced
pub fn swap(ctx: Context<Swap>, amount_in: u64) -> Result<()> {
    let amount_out = calculate_output(amount_in, &ctx.accounts.pool)?;
    // transfers amount_out regardless of how bad the rate is
    token::transfer(cpi_ctx, amount_out)?;
    Ok(())
}
```

### Fix
```rust
pub fn swap(ctx: Context<Swap>, amount_in: u64, min_amount_out: u64) -> Result<()> {
    let amount_out = calculate_output(amount_in, &ctx.accounts.pool)?;
    require!(amount_out >= min_amount_out, ErrorCode::SlippageExceeded);
    token::transfer(cpi_ctx, amount_out)?;
    Ok(())
}
```

### Audit Checklist
- [ ] All swap instructions have a `min_amount_out` parameter
- [ ] All liquidity addition instructions have `min_lp_tokens` parameter
- [ ] All liquidity removal instructions have `min_token_a` and `min_token_b` parameters
- [ ] `min_amount_out = 0` is rejected or flagged in documentation

---

## 3. Flash Loan Attack Surface

**Severity**: High (protocol-dependent)

Flash loans allow borrowing large amounts within a single transaction. Protocols that use spot prices or allow large single-transaction state changes are vulnerable.

### Common Flash Loan Attack Patterns on Solana

**Price manipulation:** Borrow → move pool price → interact with vulnerable protocol → repay → profit

**Governance attacks:** Borrow tokens → vote → repay (if voting uses spot balance)

**Collateral manipulation:** Borrow → inflate collateral value → borrow against it → repay initial → keep profit

### Defense Patterns
```rust
// 1. Use oracle prices, not spot prices (see Oracle section above)

// 2. Add a deposit lock: prevent withdraw in same slot as deposit
pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
    let clock = Clock::get()?;
    require!(
        clock.slot > ctx.accounts.position.deposit_slot + 1,
        ErrorCode::WithdrawTooSoon
    );
    // ...
}

// 3. For lending: validate health factor AFTER the instruction
pub fn borrow(ctx: Context<Borrow>, amount: u64) -> Result<()> {
    // Execute borrow
    ctx.accounts.position.borrowed += amount;
    // Validate health AFTER state change
    let health = calculate_health_factor(&ctx.accounts.position, &oracle_price)?;
    require!(health >= MIN_HEALTH_FACTOR, ErrorCode::Undercollateralized);
    Ok(())
}
```

---

## 4. LP Token Price Manipulation

**Severity**: High (lending protocols that accept LP tokens as collateral)

LP token price is often calculated as `pool_value / lp_supply`. If the pool value can be inflated via a donation attack (sending tokens directly to the pool without minting LP tokens), the LP price is inflated.

### Fix
```rust
// VULNERABLE: uses current reserve balances
let lp_price = (pool.token_a_reserve + pool.token_b_reserve) / pool.lp_supply;

// SAFER: use time-weighted or minimum of spot vs oracle
let lp_price = calculate_fair_lp_price(
    pool,
    &pyth_price_a,
    &pyth_price_b,
)?;
```

Always use fair value pricing for LP tokens in lending. Reference: [Euler Finance LP price manipulation](https://github.com/euler-xyz/euler-contracts/blob/master/audits/euler-security-audit.pdf)

---

## 5. Missing Liquidation Incentive

**Severity**: Medium (lending protocols)

If the liquidation bonus is too low or the liquidation threshold is too close to the collateral ratio, liquidators have no incentive to act, leaving the protocol with bad debt.

### Audit Checklist
- [ ] Liquidation bonus ≥ 5% of collateral (typical minimum)
- [ ] Liquidation threshold has sufficient gap from collateral ratio
- [ ] Partial liquidations are allowed for large positions
- [ ] Liquidator receives bonus in a token they can easily sell

---

## 6. Reward Calculation Timing Attacks

**Severity**: Medium (staking/farming programs)

If rewards are calculated based on a snapshot that can be gamed (e.g., staking just before a reward snapshot and unstaking after), users can extract disproportionate rewards.

### Vulnerable Pattern
```rust
// VULNERABLE: rewards based on balance at snapshot time
pub fn distribute_rewards(ctx: Context<Distribute>) -> Result<()> {
    let user_share = ctx.accounts.position.staked_amount / ctx.accounts.pool.total_staked;
    let reward = total_reward * user_share;
    // Attacker stakes large amount, claims reward, unstakes — same slot
}
```

### Fix
```rust
// SAFE: time-weighted average balance (TWAB) or lock period
pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
    let clock = Clock::get()?;
    ctx.accounts.position.stake_slot = clock.slot;
    ctx.accounts.position.staked_amount += amount;
    Ok(())
}

pub fn claim_rewards(ctx: Context<ClaimRewards>) -> Result<()> {
    let clock = Clock::get()?;
    let slots_staked = clock.slot - ctx.accounts.position.stake_slot;
    require!(slots_staked >= MIN_STAKE_SLOTS, ErrorCode::StakeTooShort);
    // rewards proportional to time staked
}
```

---

## 7. Rounding Direction in Financial Math

**Severity**: Medium

Rounding errors that consistently favor users over the protocol can be exploited at scale. Always round in the protocol's favor.

```rust
// Lending: when calculating how much a user owes, round UP
let debt = principal
    .checked_mul(interest_rate)
    .ok_or(ErrorCode::Overflow)?
    .checked_add(PRECISION - 1)  // round up
    .ok_or(ErrorCode::Overflow)?
    .checked_div(PRECISION)
    .ok_or(ErrorCode::DivisionByZero)?;

// Lending: when calculating how much collateral to release, round DOWN
let collateral_release = debt_repaid
    .checked_mul(collateral_per_debt)
    .ok_or(ErrorCode::Overflow)?
    .checked_div(PRECISION)  // round down (no +PRECISION-1)
    .ok_or(ErrorCode::DivisionByZero)?;
```

---

## DeFi Audit Checklist Summary

### Oracles
- [ ] No single-source spot price used for any financial decision
- [ ] Pyth/Switchboard staleness and confidence checked
- [ ] TWAP used for collateral valuation

### Swaps & AMMs
- [ ] `min_amount_out` enforced on all swaps
- [ ] `min_lp_tokens` enforced on liquidity add
- [ ] `min_token_a/b` enforced on liquidity remove
- [ ] No zero-slippage allowed in production paths

### Lending
- [ ] Health factor validated after every borrow
- [ ] Liquidation bonus is meaningful (≥5%)
- [ ] LP token collateral uses fair value pricing
- [ ] Partial liquidations supported for large positions

### Staking/Farming
- [ ] Flash staking prevented (deposit lock or TWAB)
- [ ] Reward calculation uses time-weighted balance
- [ ] No same-block deposit-and-claim path

### General DeFi
- [ ] Rounding favors protocol (round debt up, collateral release down)
- [ ] Flash loan vectors assessed for all price-sensitive instructions
- [ ] Emergency pause exists and is tested

## References

- [Neodyme: Solana DeFi Security](https://blog.neodyme.io/posts/solana_common_pitfalls/)
- [OtterSec: Common Solana Vulnerabilities](https://osec.io/blog)
- [Pyth Price Feed Integration Guide](https://docs.pyth.network/price-feeds/use-real-time-data/solana)
- [Euler Finance Post-Mortem](https://medium.com/@euler_mab/post-mortem-euler-finance-hack-march-13-2023-d97abcdb3736)

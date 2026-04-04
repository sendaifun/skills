# Credit Vault — Structured Lending

The Credit Vault is a 3-tranche structured lending pool where LPs deposit USDC and agents borrow against their Krexit Score. Share-based accounting ensures fair pro-rata distribution of yield and losses.

## Tranche Structure

| Tranche | Allocation | Target APR | Risk Profile |
|---------|-----------|-----------|--------------|
| Senior | 50% | 10% | Last to absorb losses. Safest. |
| Mezzanine | 30% | 12% | Middle risk-reward balance. |
| Junior | 20% | 20% | First-loss tranche. Protocol-owned. |

The Junior tranche absorbs losses first, shielding Mezzanine and Senior depositors. It is seeded and maintained by the protocol treasury.

## Share-Based Accounting

When you deposit USDC, you receive LP shares proportional to the current pool value:

```
shares_minted = deposit_amount * total_shares / total_deposits
```

When you withdraw, your shares are burned and you receive the proportional USDC:

```
withdrawal_amount = shares_burned * total_deposits / total_shares
```

This means share value increases as interest accrues — you earn yield simply by holding shares.

**Minimum deposit:** 0.001 USDC (prevents share price inflation attacks on empty vaults).

## Utilization Cap

The vault enforces an **80% utilization cap**:

```
utilization = total_borrowed / total_deposits
```

If utilization would exceed 80% after a new borrow, the borrow is rejected. This ensures:
- LPs can always withdraw (at least 20% liquidity buffer)
- The vault remains solvent during demand spikes

## Insurance Fund

The insurance fund targets **20% of total deposits**. It absorbs losses from defaults before any tranche takes a haircut.

When the insurance fund is **below target**, interest payments are split:
- 40% of interest -> Insurance fund
- 60% of interest -> Treasury

When the insurance fund is **at or above target**, all interest flows to the treasury and tranche yield distribution.

## Deposit -> Lend -> Repay -> Withdraw Flow

### 1. Deposit
```
LP deposits 1000 USDC
  -> Vault mints proportional shares
  -> USDC added to available liquidity pool
  -> Tranche allocation updated
```

### 2. Lend (Agent Borrow)
```
Agent requests 500 USDC credit
  -> Credit Router checks Krexit Score & eligibility
  -> Vault checks utilization cap (must stay <= 80%)
  -> USDC transferred to agent PDA wallet
  -> Loan record created with daily accrual rate
  -> total_borrowed increases
```

### 3. Repay
```
Revenue flows through Revenue Router
  -> 10% protocol fee -> Treasury
  -> Debt service portion -> Vault (reduces outstanding balance)
  -> Interest portion split:
     - If insurance < 20% target: 40% insurance, 60% treasury
     - If insurance >= 20% target: 100% treasury/tranche yield
  -> Principal portion -> Returns to available liquidity
```

### 4. Withdraw
```
LP requests withdrawal
  -> Vault checks available liquidity (withdrawal buffer: 120%)
  -> LP shares burned
  -> Proportional USDC returned (principal + accrued yield)
  -> Tranche allocation updated
```

## Idle Capital: Meteora Dynamic Vaults

USDC sitting idle in the vault (not lent out) is automatically routed to **Meteora Dynamic Vaults** to earn additional yield. This means:

- LPs earn Krexa lending APR on utilized capital
- LPs earn Meteora yield on idle capital
- Capital is recalled from Meteora when needed for new borrows or withdrawals

## Yield Distribution Waterfall

When interest payments arrive, they flow through this waterfall:

1. **Protocol fee (10%)** -> Treasury
2. **Insurance fund replenishment** (if below 20% target) -> 40% of remaining interest
3. **Junior tranche yield** -> First from remaining interest (highest rate, first-loss)
4. **Mezzanine tranche yield** -> Second priority
5. **Senior tranche yield** -> Last priority (lowest rate, most protected)

## Loss Waterfall (Default Scenario)

When an agent defaults:

1. **Insurance fund** absorbs losses first
2. **Junior tranche** (protocol-owned) absorbs next
3. **Mezzanine tranche** absorbs next
4. **Senior tranche** absorbs last (only in catastrophic scenarios)

## Key Constants

| Parameter | Value |
|-----------|-------|
| Utilization cap | 80% |
| Insurance fund target | 20% of total deposits |
| Protocol fee | 10% |
| Minimum deposit | 0.001 USDC |
| Withdrawal buffer | 120% |
| Senior APR | 10% |
| Mezzanine APR | 12% |
| Junior APR | 20% |

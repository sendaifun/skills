# PDA Wallets — Agent Custody and Safety Layers

Every registered agent gets a Program Derived Address (PDA) wallet. PDAs have no private key — they are controlled entirely by the Agent Wallet program. This ensures the protocol can enforce safety rules on every transaction.

## PDA Derivation

```rust
let (wallet_pda, bump) = Pubkey::find_program_address(
    &[b"agent_wallet", agent_pubkey.as_ref()],
    &agent_wallet_program_id,
);
```

The wallet PDA is deterministic: given an agent's public key, anyone can derive the wallet address. The bump seed is stored in the wallet account for future CPI calls.

## 8 Safety Layers

Every outbound transaction from a PDA wallet passes through all 8 safety checks in order. If any check fails, the transaction is rejected.

### Layer 1: Wallet Not Frozen

```
if wallet.is_frozen {
    return Err(WalletFrozen);
}
```

A frozen wallet cannot send any transactions. Wallets are frozen during:
- Liquidation proceedings
- Pending ownership transfer
- Manual admin freeze (emergency)

### Layer 2: Per-Trade Limit (20% of balance)

```
if trade_amount > wallet.balance * 0.20 {
    return Err(PerTradeLimitExceeded);
}
```

No single outbound transaction can exceed 20% of the wallet's current USDC balance. This prevents an agent from draining its wallet in a single trade.

### Layer 3: Daily Spend Limit

```
if daily_spent + trade_amount > daily_limit {
    return Err(DailySpendLimitExceeded);
}
```

The daily spend limit resets every **24 hours** from the first transaction of the day. The limit is calculated based on the agent's credit level and outstanding balance.

### Layer 4: Per-Venue Concentration (50% max)

```
if venue_exposure + trade_amount > wallet.balance * 0.50 {
    return Err(VenueConcentrationExceeded);
}
```

No more than 50% of the wallet's balance can be exposed to a single venue (DEX, protocol, or counterparty). This forces diversification and limits venue-specific risk.

### Layer 5: Health Factor Gate

```
if agent.health_factor < minimum_for_trading {
    return Err(HealthFactorTooLow);
}
```

Agents in Orange or Red health zones cannot initiate new outbound transactions (except repayments). This prevents agents from digging deeper into trouble.

### Layer 6: Venue Whitelisted

```
if !venue_whitelist.contains(destination) {
    return Err(VenueNotWhitelisted);
}
```

The destination address must be on the Venue Whitelist. The whitelist is maintained by the Venue Whitelist program and includes approved DEXs (Jupiter, Raydium, Orca), lending protocols, and infrastructure providers.

### Layer 7: Credit Level Sufficient

```
if required_level > agent.credit_level {
    return Err(CreditLevelInsufficient);
}
```

Some venues or transaction types require a minimum credit level. For example, larger position sizes may require L2+.

### Layer 8: Venue Exposure Tracking

```
venue_tracker.record(venue, amount, timestamp);
```

Even if all previous checks pass, the transaction is recorded in the venue exposure tracker. This updates:
- Per-venue running totals
- Daily spend counter
- Transaction history for scoring

## Daily Spend Limit Reset

The daily spend counter resets **24 hours** after the first transaction of the current period. This is a rolling window, not a calendar-day reset.

```
if current_time - daily_reset_timestamp > 86400 {
    daily_spent = 0;
    daily_reset_timestamp = current_time;
}
```

## Venue Concentration Tracking

The wallet tracks exposure to each venue independently:

```
venue_exposures: HashMap<Pubkey, u64>
```

When positions at a venue are closed or tokens are returned, the exposure decreases. The 50% limit applies to the **net** exposure at any given time.

## Freeze and Unfreeze

### Freeze Triggers
- **Liquidation** — wallet frozen automatically when liquidation begins
- **Admin action** — protocol authority can freeze wallets in emergencies
- **Ownership transfer** — wallet frozen during the transfer process
- **Health factor critical** — automatic freeze when health drops below critical threshold

### Unfreeze Conditions
- **Post-liquidation** — unfrozen after liquidation completes (if surplus remains)
- **Admin action** — manual unfreeze by protocol authority
- **Ownership transfer complete** — unfrozen after new owner confirmed
- **Health recovery** — automatic unfreeze when health returns above threshold

## Ownership Transfer (2-Step)

Ownership transfer is a 2-step process to prevent accidental or malicious transfers:

### Step 1: Initiate Transfer
```
Current owner calls: initiate_transfer(new_owner_pubkey)
  -> Wallet state: pending_transfer = true
  -> Wallet state: pending_owner = new_owner_pubkey
  -> Wallet frozen during transfer
```

### Step 2: Accept Transfer
```
New owner calls: accept_transfer(wallet_pda)
  -> Wallet state: owner = new_owner_pubkey
  -> Wallet state: pending_transfer = false
  -> Wallet unfrozen
  -> Agent Registry updated with new owner
```

If the new owner does not accept within a timeout period, the transfer is cancelled and the wallet unfreezes.

## Liquidation Sequence

When an agent's health factor drops below the liquidation threshold:

### 1. Freeze
```
Wallet frozen immediately
No outbound transactions allowed
Inbound revenue still flows through Revenue Router
```

### 2. Calculate
```
total_owed = principal + accrued_interest
recovery_target = total_owed + keeper_reward
```

### 3. Distribute
```
Recovered USDC distributed:
  1. Outstanding debt -> Credit Vault
  2. Keeper reward (0.5%) -> Keeper who triggered liquidation
  3. Surplus -> Agent owner (if any remains)
```

### 4. Update Registry
```
Agent Registry updated:
  - Status: Liquidated
  - Active credit: 0
  - Liquidation count: +1
```

### 5. Score Update
```
Krexit Score penalty:
  - Minimum -40 points
  - Repayment component decreased
  - Behavioral health component decreased
```

### 6. Return Surplus
```
If recovered amount > total_owed + keeper_reward:
  surplus sent to agent owner's wallet (not PDA)
```

## Keeper Reward

Keepers are external actors who monitor agent health and trigger liquidations. They receive **0.5% of the total recovered amount** as an incentive.

```
keeper_reward = recovered_amount * 0.005
```

This ensures liquidations happen promptly — keepers are economically motivated to monitor and act quickly.

## Key Constants

| Parameter | Value |
|-----------|-------|
| Per-trade limit | 20% of balance |
| Per-venue concentration | 50% of balance |
| Daily spend reset | 24 hours (rolling) |
| Keeper reward | 0.5% of recovered amount |
| Withdrawal buffer | 120% |
| Ownership transfer | 2-step (initiate + accept) |

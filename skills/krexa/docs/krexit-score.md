# Krexit Score — On-Chain Credit Scoring

The Krexit Score is a composite behavioral credit score (200-850) stored on-chain as a PDA. It determines an agent's credit level, borrowing limits, and interest rates. Any Solana program can read it via CPI.

## Score Range and Defaults

| Parameter | Value |
|-----------|-------|
| Minimum score | 200 |
| Maximum score | 850 |
| Default score (new agent) | 350 |
| Score expiry | 90 days (must transact to keep score active) |

A new agent starts at 350, which qualifies for L1 Micro credit ($500 max at 36.50% APR).

## Five Scoring Components

Each component is stored as a value in basis points (0-10000 BPS, i.e., 0.00%-100.00%).

### 1. Repayment History (30% weight)

Measures whether the agent pays on time, late, or misses payments entirely.

- **On-time payments** increase this component
- **Late payments** decrease it moderately
- **Missed payments** decrease it severely
- **Default** sets this component to 0 permanently and triggers blacklist

This is the heaviest-weighted component because repayment behavior is the strongest predictor of future credit risk.

### 2. Profitability (25% weight)

Measures the agent's ability to generate returns from borrowed capital.

- **P&L ratio** — overall profit/loss relative to capital deployed
- **Sharpe ratio** — risk-adjusted returns (higher is better)
- **Maximum drawdown** — largest peak-to-trough decline (lower is better)

Agents that consistently generate profit with controlled risk score highest here.

### 3. Behavioral Health (20% weight)

Measures time spent in each health zone:

| Zone | Threshold | Impact |
|------|-----------|--------|
| Green | >= 80% health | Positive signal |
| Yellow | 50-79% health | Neutral |
| Orange | 25-49% health | Negative signal |
| Red | < 25% health | Strongly negative |

An agent that stays in Green most of the time scores well. Frequent dips into Red drag this component down significantly.

### 4. Usage Patterns (15% weight)

Measures consistency and diversification of on-chain activity.

- **Venue entropy** — trading across multiple whitelisted venues (higher entropy = more diversified = better)
- **Transaction consistency** — regular, predictable transaction patterns score higher than erratic bursts
- **Volume distribution** — even distribution across time periods vs concentration

### 5. Account Maturity (10% weight)

Measures how established the agent is in the protocol.

- **Account age** — older accounts score higher
- **Lifetime volume** — total USDC transacted through the protocol
- **Completed credit cycles** — number of borrow-repay cycles completed successfully

This component naturally increases over time, rewarding long-term participation.

## Score Update Mechanics

### Normal Updates
- Maximum change per update: **+/- 100 BPS** (1.00%)
- Applied after each significant on-chain event (repayment, trade, revenue)

### Critical Updates
- Maximum change per update: **+/- 200 BPS** (2.00%)
- Triggered by critical events: liquidation, default, missed payment, large drawdown

### Cooldown
- **60 seconds** between score updates
- **Bypassed** for critical events (liquidation, default)

### Liquidation Penalty
- Score must drop by **at least 40 points** when an agent is liquidated
- This ensures liquidation has a lasting impact on creditworthiness

### Default (Permanent)
- Agent is **permanently blacklisted**
- Repayment component set to **0**
- Score cannot recover — agent must register a new identity

## Score History

A **30-entry ring buffer** stores recent score snapshots on-chain. This allows:
- Trend analysis (is the agent improving or degrading?)
- Anomaly detection (sudden score drops)
- Historical verification by other programs via CPI

## Score Expiry

If an agent has no on-chain activity for **90 days**, the score expires. An expired score:
- Cannot be used for new credit requests
- Must be reactivated through a new transaction
- Does not reset to default — it retains its last value but is marked inactive

## Reading the Score (CPI)

Any Solana program can read an agent's Krexit Score via Cross-Program Invocation:

```rust
// PDA derivation for score account
let (score_pda, _bump) = Pubkey::find_program_address(
    &[b"krexit_score", agent_pubkey.as_ref()],
    &krexit_score_program_id,
);
```

The score PDA contains:
- `score`: u16 (200-850)
- `components`: [u16; 5] (each 0-10000 BPS)
- `last_updated`: i64 (Unix timestamp)
- `history`: [(u16, i64); 30] (score, timestamp ring buffer)
- `is_blacklisted`: bool

## Score to Credit Level Mapping

| Score Range | Credit Level | Max Credit |
|------------|-------------|-----------|
| 200-499 | L1 Micro | $500 |
| 500-649 | L2 Standard | $20,000 |
| 650-749 | L3 Growth | $50,000 |
| 750-850 | L4 Prime | $500,000 |

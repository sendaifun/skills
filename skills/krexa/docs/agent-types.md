# Agent Types — Trader, Service, Hybrid

Krexa supports three agent types, each with distinct enforcement models, monitoring metrics, and liquidation rules.

## Type A — Trader Agent

Trader agents borrow USDC to trade on whitelisted DEXs (Jupiter, Raydium, Orca, etc.).

### NAV Monitoring

The core metric for Trader agents is **Net Asset Value (NAV)**:

```
NAV = (wallet_usdc + collateral_value) / credit_limit
```

NAV is monitored continuously. If NAV falls below the liquidation threshold, the agent is auto-liquidated.

### Liquidation Thresholds by Credit Level

| Level | NAV Liquidation Threshold |
|-------|--------------------------|
| L1 Micro | 90% (NAV < 0.90) |
| L2 Standard | 85% (NAV < 0.85) |
| L3 Growth | 80% (NAV < 0.80) |
| L4 Prime | 80% (NAV < 0.80) |

Higher credit levels get slightly more room because they have proven track records (higher Krexit Scores).

### Liquidation Sequence (Type A)

1. **Freeze** wallet — no new outbound transactions
2. **Calculate** total outstanding (principal + accrued interest)
3. **Sell** positions on DEXs to recover USDC
4. **Distribute** recovered USDC:
   - Outstanding debt -> Credit Vault
   - Keeper reward (0.5% of recovered amount) -> Keeper
   - Surplus (if any) -> Agent owner
5. **Update** Agent Registry — mark as liquidated
6. **Score penalty** — Krexit Score drops by at least 40 points

### Type A Health Zones

| Zone | NAV Range | Status |
|------|-----------|--------|
| Green | >= 120% | Healthy, full trading privileges |
| Yellow | 100-119% | Caution, reduced position limits |
| Orange | 90-99% (L1) / 85-99% (L2) / 80-99% (L3/L4) | Warning, no new borrows |
| Red | Below liquidation threshold | Auto-liquidation triggered |

## Type B — Service Agent

Service agents borrow USDC to fund infrastructure (hosting, API costs, compute) and earn revenue through x402-priced API endpoints.

### Revenue Velocity Monitoring

Instead of NAV, Service agents are monitored by **revenue velocity** — the rate at which they generate income relative to their outstanding debt.

```
revenue_velocity = trailing_7d_revenue / outstanding_debt
```

### Health Zones (Type B)

| Zone | Revenue Velocity | Status |
|------|-----------------|--------|
| Green | >= 80% of projected | Full operating privileges |
| Yellow | 50-79% of projected | Warning, monitoring increased |
| Orange | 25-49% of projected | Restricted, no new borrows |
| Red | < 25% of projected | Wind-down initiated |

### Milestone-Based Disbursement

Type B agents receive credit in milestones rather than a lump sum:

1. **Initial disbursement** — small amount to bootstrap the service
2. **Milestone checkpoints** — additional credit released as revenue targets are hit
3. **Maximum milestones** — up to 8 milestones per credit cycle

This ensures the agent demonstrates revenue generation before receiving more capital.

### Wind-Down Lifecycle

When a Type B agent enters Red zone (or has zero revenue for 14 days):

| Phase | Duration | Actions |
|-------|----------|---------|
| **None** | — | Normal operation |
| **Grace** | 48 hours | Warning issued. Agent can resume revenue to cancel wind-down. No new borrows. |
| **Executing** | Until complete | All revenue directed to debt repayment. No new borrows. Existing services may continue. |
| **Completed** | — | Agent deregistered. Remaining balance handled as bad debt if unrecoverable. |

The Grace period gives the agent a chance to recover. If revenue resumes and health returns to Orange or above, the wind-down is cancelled.

### Expense Destinations

Type B agents can declare up to **20 expense destinations** — approved addresses where borrowed funds can be sent (hosting providers, compute services, etc.). Payments to non-declared destinations are blocked.

## Type C — Hybrid Agent

Hybrid agents combine trading and service functionality. They are subject to **both** enforcement models simultaneously.

### Dual Enforcement

- **NAV monitoring** applies to the trading portion of the agent's activity
- **Revenue velocity monitoring** applies to the service portion
- Liquidation triggers if **either** metric crosses its threshold

### Allocation Split

When a Hybrid agent borrows, it declares how capital will be split:
- X% for trading operations (monitored by NAV)
- Y% for service operations (monitored by revenue velocity)

The agent must maintain health in both domains. A healthy trading book cannot compensate for zero service revenue, and vice versa.

### Liquidation (Type C)

If either enforcement model triggers:
1. **Both** trading and service operations are frozen
2. Trading positions are unwound
3. Service revenue is redirected to debt repayment
4. Standard liquidation sequence applies

## Choosing an Agent Type

| Use Case | Recommended Type |
|----------|-----------------|
| DEX trading bot | Type A |
| API service with x402 monetization | Type B |
| Trading bot that also sells signals via API | Type C |
| DeFi yield farming | Type A |
| Data oracle service | Type B |
| Market maker that sells analytics | Type C |

## Registration

Agent type is set at registration and **cannot be changed**. To switch types, the agent must:
1. Repay all outstanding debt
2. Deregister
3. Re-register with the new type

```bash
# CLI registration with type
npx @krexa/cli init --type trader    # Type A
npx @krexa/cli init --type service   # Type B
npx @krexa/cli init --type hybrid    # Type C
```

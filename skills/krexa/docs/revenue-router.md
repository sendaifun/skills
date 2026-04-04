# Revenue Router — Auto-Repayment and Revenue Validation

The Revenue Router sits between incoming payments and the agent's PDA wallet. Every dollar of revenue passes through 3 validation layers before being split between protocol fees, debt service, and the agent.

## Payment Flow

```
Incoming Payment ($1.00)
  |
  v
[Layer 1: Source Classification]
  |
  v
[Layer 2: Pattern Detection]
  |
  v
[Layer 3: Economic Validation]
  |
  v
Classification: Verified | Rejected | Quarantined | PendingKeeper
  |
  v (if Verified)
Payment Split:
  10% protocol fee  -> Treasury ($0.10)
  Debt service       -> Vault    ($0.40)
  Remainder          -> Agent    ($0.50)
```

## Layer 1: Source Classification

Determines whether the payment source is legitimate.

**Whitelist check:**
- Payment source must be from a whitelisted venue or known payer
- The Venue Whitelist program maintains the approved list

**Blocklist check:**
- Known bad actors, wash-trade addresses, and flagged wallets are rejected immediately

**Self-payment detection:**
- Payments from the agent's own PDA wallet are rejected
- Payments from the agent's owner wallet are flagged for review
- Circular payment chains (A -> B -> A) are detected and rejected

## Layer 2: Pattern Detection

Analyzes payment patterns to detect manipulation.

### Round-Trip Detection
- If **95% or more** of a payment amount returns to the original sender within **24 hours**, it is flagged as a round-trip
- Round-trip payments are classified as **Rejected**

### Amount Anomaly Detection
- If a single payment exceeds **10x the agent's daily average** revenue, it is flagged
- Anomalous payments are classified as **Quarantined** pending keeper review

### Rapid Return Detection
- If the same payer-agent pair transacts **3 or more times within 7 days** with similar amounts, it is flagged
- Rapid returns are classified as **PendingKeeper** for manual review

## Layer 3: Economic Validation

Validates that the payment makes economic sense relative to the agent's credit position.

### Single Payment Cap
- A single payment cannot exceed **50% of the agent's total credit line**
- Payments above this threshold are classified as **Quarantined**
- This prevents artificial inflation of revenue metrics through a single large payment

## Payment Classifications

| Classification | Action | Revenue Credit |
|---------------|--------|---------------|
| **Verified** | Processed immediately through payment split | Full credit to revenue metrics |
| **Rejected** | Returned to sender (minus gas) | No credit |
| **Quarantined** | Held in escrow pending review | No credit until released |
| **PendingKeeper** | Held until a keeper validates | No credit until approved |

## Payment Split (Verified Payments)

For every verified payment:

1. **Platform fee (10%)** -> Protocol Treasury
2. **Debt service** -> Credit Vault (reduces agent's outstanding balance)
   - The debt service percentage varies based on the agent's health zone
   - Green zone: lower repayment rate (agent keeps more)
   - Red zone: higher repayment rate (aggressive debt reduction)
3. **Remainder** -> Agent's PDA wallet

The exact debt service split depends on the agent's current credit utilization and health factor.

## Auto-Health Monitoring

The Revenue Router monitors revenue velocity and triggers health zone changes:

| Condition | Health Impact |
|-----------|--------------|
| Consistent revenue | Maintains or improves health zone |
| 7 days no revenue | Agent moves to **Orange** zone |
| 14 days no revenue | Agent moves to **Red** zone |

For **Type B (Service) agents**, the Red zone triggers the wind-down lifecycle:
1. **None** -> Normal operation
2. **Grace** (48 hours) -> Warning period, agent can resume revenue to cancel
3. **Executing** -> Wind-down in progress, no new borrows
4. **Completed** -> Agent deregistered, remaining balance liquidated

## Revenue History

The Revenue Router maintains a **50-entry history buffer** of recent revenue events per agent. This history is used by:
- The Krexit Score system (revenue velocity feeds into Behavioral Health and Usage Patterns)
- The Credit Router (eligibility checks reference recent revenue)
- Keepers (for validating quarantined payments)

## Integration: x402 Payments

When an agent earns revenue via the x402 protocol:

```
Client pays 0.25 USDC for API call
  -> Payment sent to Revenue Router address (NOT agent address)
  -> Revenue Router validates (Layers 1-3)
  -> If Verified:
     - $0.025 -> Treasury (10%)
     - $0.100 -> Vault (debt service)
     - $0.125 -> Agent PDA wallet
  -> Agent's revenue metrics updated
  -> Krexit Score components recalculated
```

The agent never receives revenue directly. All payments MUST flow through the Revenue Router to ensure debt service and accurate scoring.

## Key Constants

| Parameter | Value |
|-----------|-------|
| Platform fee | 10% |
| Round-trip threshold | 95% within 24h |
| Amount anomaly threshold | 10x daily average |
| Rapid return threshold | 3x in 7 days |
| Single payment cap | 50% of credit line |
| No-revenue Orange trigger | 7 days |
| No-revenue Red trigger | 14 days |
| Revenue history buffer | 50 entries |
| Wind-down grace period | 48 hours |

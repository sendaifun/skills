# Program IDs — Krexa Solana Programs (Devnet)

All Krexa programs are deployed on Solana Devnet.

| Program | Address | Description |
|---------|---------|-------------|
| Agent Registry | `ChJjAXy7sE4d4jst9VViG7ScanVKqH9Q1cFxtdcH78cG` | Registers agents, stores type (A/B/C), owner, status, and credit level. Entry point for all agent operations. |
| Agent Wallet | `35t8yWLsUZNTLT71ej7DF59P81HrtZTx2uZeMhwuhhf6` | Manages PDA wallets for agents. Enforces 8 safety layers on every outbound transaction. Handles freeze/unfreeze and ownership transfer. |
| Credit Vault | `26SQx3rAyujWCupxvPAMf9N3ok4cw1awyTWAVWDQfr9N` | 3-tranche structured lending pool. Accepts LP deposits, issues shares, lends USDC to agents, handles repayments and yield distribution. |
| Credit Router | `2Zy3d7C28Z9dfazdysKVBQUXnvvWNshxtDEFKftG83u8` | Routes credit requests. Checks eligibility (score, level, utilization), calculates terms (APR, limits), and coordinates with the Vault for disbursement. |
| Krexit Score | `2GwtAXnjY5LehfZfT77ZH3XSshwbni8LP9zXeA84WUqh` | On-chain credit scoring (200-850). Stores 5 component scores, 30-entry history ring buffer, blacklist status. Readable via CPI by any program. |
| Service Plan | `Eqc48c6TtKAPRosTMoC6Nasi85iqdLuzwbu6WBrsPFdt` | Manages Type B service agent plans. Handles milestone-based disbursement, expense destinations, revenue velocity tracking, and wind-down lifecycle. |
| Venue Whitelist | `HyWQrHG14Sw6KpKYSMiBDmVj5u7PXfLWvim6FHbBLmua` | Maintains the approved list of DEXs, protocols, and infrastructure providers. Agent Wallet checks this before every outbound payment. |

## PDA Derivation Seeds

| PDA | Seeds |
|-----|-------|
| Agent account | `["agent", agent_pubkey]` |
| Agent wallet | `["agent_wallet", agent_pubkey]` |
| Krexit Score | `["krexit_score", agent_pubkey]` |
| Vault share account | `["vault_shares", depositor_pubkey]` |
| Service plan | `["service_plan", agent_pubkey]` |
| Venue entry | `["venue", venue_pubkey]` |

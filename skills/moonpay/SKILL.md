---
name: moonpay
description: Execute fiat on-ramp, off-ramp, token swaps, transfers, wallet management, and prediction markets through the MoonPay MCP server. Use when the user wants to buy crypto with a credit card or bank transfer, sell crypto for fiat, swap or transfer tokens, manage MoonPay wallets, or interact with MoonPay prediction markets.
license: MIT
metadata:
  author: moonpay
  version: "1.0.0"
tags:
  - moonpay
  - fiat
  - on-ramp
  - off-ramp
  - buy
  - sell
  - swap
  - transfer
  - wallet
  - payments
  - prediction-markets
  - defi
---

# MoonPay MCP

Use the `moonpay` MCP server to buy/sell crypto with fiat, swap tokens, transfer assets, and manage wallets — all without leaving the agent conversation.

## Setup

```bash
claude mcp add moonpay --transport http https://mcp.moonpay.com/mcp
```

On first use, call `moonpay_login` with the user's email. MoonPay sends a magic link; once clicked, call `moonpay_verify` with the code to complete authentication.

```
moonpay_login    → sends magic link to email
moonpay_verify   → completes login with the code from the link
```

Sessions are token-based. Call `moonpay_refresh` to renew an expired session.

## Available Tools

### Auth
| Tool | Description |
|------|-------------|
| `moonpay_login` | Send a magic-link sign-in email |
| `moonpay_verify` | Complete login with the verification code |
| `moonpay_refresh` | Refresh an expired session token |
| `moonpay_logout` | End the current session |
| `moonpay_user_retrieve` | Get the authenticated user's profile |

### On-Ramp (Fiat → Crypto)
| Tool | Description |
|------|-------------|
| `moonpay_buy` | Initiate a fiat purchase of crypto (credit card, bank transfer, etc.) |
| `moonpay_deposit_create` | Create a fiat deposit |
| `moonpay_deposit_retrieve` | Retrieve deposit details by ID |
| `moonpay_deposit_transaction_list` | List transactions for a deposit |

### Off-Ramp (Crypto → Fiat) via Virtual Accounts
| Tool | Description |
|------|-------------|
| `moonpay_virtual-account_create` | Create a virtual account for off-ramp |
| `moonpay_virtual-account_retrieve` | Get virtual account details |
| `moonpay_virtual-account_offramp_create` | Initiate a crypto → fiat off-ramp |
| `moonpay_virtual-account_offramp_retrieve` | Get off-ramp details |
| `moonpay_virtual-account_offramp_list` | List all off-ramps |
| `moonpay_virtual-account_offramp_cancel` | Cancel a pending off-ramp |
| `moonpay_virtual-account_onramp_create` | Initiate a fiat → crypto on-ramp via virtual account |
| `moonpay_virtual-account_onramp_retrieve` | Get on-ramp details |
| `moonpay_virtual-account_transaction_list` | List virtual account transactions |

### Token Operations
| Tool | Description |
|------|-------------|
| `moonpay_token_swap` | Swap one token for another |
| `moonpay_token_transfer` | Transfer tokens to an address |
| `moonpay_token_quote` | Get a swap quote without executing |
| `moonpay_token_retrieve` | Get token details by ID or symbol |
| `moonpay_token_search` | Search for supported tokens |
| `moonpay_token_balance_list` | List token balances for a wallet |
| `moonpay_token_bridge` | Bridge tokens across chains |
| `moonpay_token_check` | Check token support and availability |
| `moonpay_token_trending_list` | Get trending tokens |
| `moonpay_token_holder_list` | List holders for a token |

### Wallet Management
| Tool | Description |
|------|-------------|
| `moonpay_wallet_list` | List all wallets |
| `moonpay_wallet_create` | Create a new MoonPay wallet |
| `moonpay_wallet_retrieve` | Get wallet details |
| `moonpay_wallet_rename` | Rename a wallet |
| `moonpay_wallet_delete` | Delete a wallet |
| `moonpay_wallet_import` | Import an external wallet |
| `moonpay_wallet_export` | Export wallet keys |
| `moonpay_wallet_discover` | Discover wallets associated with an address |
| `moonpay_wallet_pnl_retrieve` | Get wallet PnL |
| `moonpay_wallet_activity_list` | List wallet activity |
| `moonpay_wallet_hardware_add` | Add a hardware wallet |
| `moonpay_wallet_hardware_refresh` | Refresh hardware wallet state |

### Transactions
| Tool | Description |
|------|-------------|
| `moonpay_transaction_list` | List transactions |
| `moonpay_transaction_retrieve` | Get a transaction by ID |
| `moonpay_transaction_prepare` | Prepare a transaction for signing |
| `moonpay_transaction_sign` | Sign a prepared transaction |
| `moonpay_transaction_send` | Broadcast a signed transaction |
| `moonpay_transaction_register` | Register an external transaction |
| `moonpay_swaps_transaction_build` | Build a swap transaction |

### Prediction Markets
| Tool | Description |
|------|-------------|
| `moonpay_prediction-market_market_search` | Search prediction markets |
| `moonpay_prediction-market_market_trending_list` | Get trending markets |
| `moonpay_prediction-market_market_price_retrieve` | Get current market price |
| `moonpay_prediction-market_market_price_history_list` | Get price history |
| `moonpay_prediction-market_market_event_retrieve` | Get event details |
| `moonpay_prediction-market_market_tag_list` | List market tags/categories |
| `moonpay_prediction-market_position_buy` | Buy a position |
| `moonpay_prediction-market_position_sell` | Sell a position |
| `moonpay_prediction-market_position_list` | List open positions |
| `moonpay_prediction-market_position_redeem` | Redeem a winning position |
| `moonpay_prediction-market_trade_list` | List trade history |
| `moonpay_prediction-market_activity_list` | List all market activity |
| `moonpay_prediction-market_pnl_retrieve` | Get prediction market PnL |
| `moonpay_prediction-market_user_create` | Create a prediction market user profile |

### Chains & Prices
| Tool | Description |
|------|-------------|
| `moonpay_chain_list` | List all supported chains |
| `moonpay_chain_retrieve` | Get details for a specific chain |
| `moonpay_getCurrentPrice` | Get current price for a token |
| `moonpay_getHistoricalPrice` | Get historical price data |
| `moonpay_getFeeRates` | Get current network fee rates |

### Bitcoin
| Tool | Description |
|------|-------------|
| `moonpay_bitcoin_balance_retrieve` | Get Bitcoin wallet balance |
| `moonpay_getMaxSpendableBtc` | Get max spendable BTC after fees |

### DeFi (Borrow/Supply/Withdraw)
| Tool | Description |
|------|-------------|
| `moonpay_supply` | Supply tokens to a lending protocol |
| `moonpay_borrow` | Borrow tokens |
| `moonpay_repay` | Repay a borrow position |
| `moonpay_withdraw` | Withdraw supplied tokens |
| `moonpay_quoteSupply` | Quote a supply operation |
| `moonpay_quoteBorrow` | Quote a borrow operation |
| `moonpay_quoteRepay` | Quote a repay operation |
| `moonpay_quoteWithdraw` | Quote a withdrawal |
| `moonpay_quoteSwap` | Quote a token swap |
| `moonpay_quoteTransfer` | Quote a transfer |
| `moonpay_quoteBridge` | Quote a cross-chain bridge |

## Common Flows

### Buy crypto with a credit card (on-ramp)
1. Ensure the user is logged in (`moonpay_login` + `moonpay_verify` if needed)
2. Call `moonpay_buy` with the target currency and amount
3. The user completes payment through MoonPay's hosted flow
4. Poll `moonpay_transaction_retrieve` to confirm delivery

### Sell crypto for fiat (off-ramp)
1. Call `moonpay_virtual-account_create` to set up a virtual account
2. Call `moonpay_virtual-account_offramp_create` with the crypto amount and target fiat currency
3. Transfer crypto to the provided deposit address
4. Monitor status via `moonpay_virtual-account_offramp_retrieve`

### Swap tokens
1. Call `moonpay_token_quote` to preview the rate and fees
2. Confirm with the user
3. Call `moonpay_token_swap` to execute

### Transfer tokens
1. Call `moonpay_quoteTransfer` to show fees
2. Confirm with the user
3. Call `moonpay_token_transfer` with recipient address and amount

## Important Notes

- Always confirm amounts and fees with the user before executing irreversible transactions
- Use quote tools (`moonpay_token_quote`, `moonpay_quoteSwap`, etc.) before executing to preview costs
- KYC may be required for large on-ramp or off-ramp amounts
- Supported fiat currencies and limits vary by region — check `moonpay_chain_list` for availability

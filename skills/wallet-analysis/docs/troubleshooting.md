# Wallet Analysis Troubleshooting

## Solana-specific caveats

Zerion's current wallet docs support Solana across the core wallet-analysis endpoints, but they still note a few temporary limitations:

- `positions`: Solana protocol positions may be incomplete
- `transactions`: Solana NFT transactions are not currently supported on that endpoint
- fresh Solana tokens can require a short bootstrap/retry window before appearing

When these caveats matter, state them directly instead of hiding them.

## Auth issues

### Basic auth confusion

For REST API requests, use the Zerion API key as the Basic auth username with an empty password:

```bash
curl -u "$ZERION_API_KEY:" "https://api.zerion.io/v1/chains/"
```

### x402 confusion

Use x402 only when the runtime supports the payment handshake. Prefer API keys for plain application code unless the user explicitly wants a no-key Solana-funded flow.

## Retry behavior

For wallets that have just been queried, certain Zerion endpoints can need a short warm-up period. Use bounded retries and stop after a reasonable timeout.

# Unclaimed SOL Scanner

Scan any Solana wallet to find reclaimable SOL locked in dormant token accounts and program buffer accounts.

## Instructions

1. Get the Solana wallet address from the user (base58 public key, **43–44 characters**, e.g. `7xKXq1...`)
2. Run the scan script:

```bash
bash $UNCLAIMED_SOL_DIR/scripts/scan.sh <wallet_address>
```

3. Parse the JSON response and format for the user per the examples below.

## Response Schema

```json
{
  "totalClaimableSol": 4.728391,
  "assets": 3.921482,
  "buffers": 0.806909,
  "tokenCount": 183,
  "bufferCount": 3
}
```

- `totalClaimableSol` — total reclaimable SOL (assets + buffers)
- `assets` — SOL locked in dormant token accounts
- `buffers` — SOL locked in program buffer accounts
- `tokenCount` / `bufferCount` — account counts; may be 0 or absent if not yet returned by backend

## Examples

### Both types present

> Your wallet has **4.728391 SOL** reclaimable.
> - 3.921482 SOL from 183 token accounts
> - 0.806909 SOL from 3 buffer accounts
>
> Claim at: https://unclaimedsol.com?utm_source=openclaw

### Only one type present (skip breakdown)

> Your wallet has **2.104500 SOL** reclaimable.
>
> Claim at: https://unclaimedsol.com?utm_source=openclaw

### Zero result

> This wallet has no reclaimable SOL. All accounts are active or already optimized.
>
> Learn more: https://unclaimedsol.com?utm_source=openclaw

### Script error

> Unable to scan this wallet right now. You can claim directly at https://unclaimedsol.com?utm_source=openclaw — connect your wallet there to see your reclaimable SOL.

## Guidelines

- **DO**: Show full SOL precision (`4.728391`, not `4.73`)
- **DO**: Always append `?utm_source=openclaw` to every link
- **DO**: Skip account count breakdown if `tokenCount` and `bufferCount` are both 0 or missing
- **DON'T**: Tell the user to "paste their address into a search box" — the site uses wallet connection
- **DON'T**: Ask for seed phrases, private keys, or mnemonics under any circumstances
- **DON'T**: Execute or imply any transactions — this tool is read-only

## Common Errors

### Script path not found
**Cause**: `$UNCLAIMED_SOL_DIR` is not set in the environment  
**Solution**: Export the variable before running, e.g. `export UNCLAIMED_SOL_DIR=/path/to/skill`

### Invalid wallet address
**Cause**: User provided a short string, ENS name, or EVM address  
**Solution**: Validate input is base58 and 43–44 characters; prompt: *"That doesn't look like a valid Solana address — could you double-check it?"*

### Empty or malformed JSON
**Cause**: Network timeout, API down, or unindexed wallet  
**Solution**: Use the error response template above; do not surface raw error output

### Both totals are 0, no error
**Cause**: Wallet is clean — no dormant accounts found  
**Solution**: Use the zero-result template; do not imply the scan failed

## References

- [UnclaimedSOL App](https://unclaimedsol.com?utm_source=openclaw)
- [Official Docs](https://docs.unclaimedsol.com)
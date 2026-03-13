# Sol-Incinerator Troubleshooting

## 401 Unauthorized on core routes

**Symptoms**
- Response contains auth error on `/burn`, `/close`, `/batch/close-all*`, or `/transactions/*`.

**Cause**
- Missing or invalid API key.

**Fix**
1. Mint a key via `POST /api-keys/generate`.
2. Send exactly one credential header:
   - `x-api-key: ak_xxx.yyy` or
   - `Authorization: Bearer ak_xxx.yyy`
3. Confirm there is no proxy stripping headers.

## 400 Invalid public key format

**Symptoms**
- Error mentions `userPublicKey`, `assetId`, `feePayer`, or `partnerFeeAccount`.

**Cause**
- One or more fields are not valid base58 Solana public keys.

**Fix**
- Validate keys with `new PublicKey(value)` before submitting request bodies.

## 400 Invalid burnAmount

**Symptoms**
- Error: invalid positive integer or unsafe integer.

**Cause**
- Non-integer amount, negative value, or large JS number precision issue.

**Fix**
- Pass `burnAmount` as a decimal string in atomic units (example: `"1000000"`).

## 400 partnerFee/referral validation failure

**Symptoms**
- Error on `partnerFeeBps`, missing `partnerFeeAccount`, or referral conflict.

**Cause**
- `partnerFeeAccount` and `partnerFeeBps` not provided together.
- `partnerFeeBps` out of range (`0..9800`) or non-integer.
- `referralCode` combined with partner fields.

**Fix**
- Use one monetization mode per request:
  - Partner mode: `partnerFeeAccount + partnerFeeBps`
  - Referral mode: `referralCode`

## Preview succeeds but build fails

**Symptoms**
- `/burn/preview` or `/close/preview` works, but `/burn` or `/close` fails.

**Cause**
- Asset state changed between preview and execution (already burned/closed, ownership changed, account balance changed, frozen state).

**Fix**
1. Re-run preview immediately before build.
2. Refresh wallet asset/account state.
3. Retry build with current state.

## Relay rejects transaction as unsigned

**Symptoms**
- Error says transaction has no signatures or appears unsigned.

**Cause**
- Payload from `/burn`/`/close` was not signed locally before relay.

**Fix**
1. Decode serialized tx bytes (base58 by default).
2. Sign with wallet keypair.
3. Re-encode and send to `/transactions/send`.

## Relay decoding errors (base58/base64)

**Symptoms**
- Base58/base64 decode failure in `/transactions/send*`.

**Cause**
- Wrong encoding option or malformed transaction string.

**Fix**
- If payload is base58, omit `encoding` or set `"base58"`.
- If payload is base64, set `encoding: "base64"` explicitly.

## Batch send failures under load

**Symptoms**
- Partial failures in `/transactions/send-batch`.

**Cause**
- High concurrency or RPC pressure.

**Fix**
1. Lower `maxConcurrency` (for example `2-4`).
2. Use `waitForConfirmation: true` for more deterministic sequencing.
3. Retry failed items with backoff.

## Rate limit exceeded

**Symptoms**
- HTTP `429` with retry message.

**Cause**
- Per-route limits exceeded (heavier limits on close-all routes).

**Fix**
1. Add backoff and jitter.
2. Cache previews where possible.
3. Reduce polling and duplicate calls.

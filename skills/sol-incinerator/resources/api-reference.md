# Sol-Incinerator API v2 Reference (Burn + Close Focus)

Live base URL: `https://v2.api.sol-incinerator.com`

Canonical docs: `https://api.dashboard.sol-incinerator.com/docs/v2`

## Authentication

Core routes require API key:

```http
x-api-key: ak_xxx.yyy
```

or

```http
Authorization: Bearer ak_xxx.yyy
```

Public key generation route:
- `POST /api-keys/generate`

## Public Routes

| Method | Path | Notes |
|------|------|-------|
| `GET` | `/` | Health/status |
| `POST` | `/api-keys/generate` | Mint autonomous API key |
| `GET` | `/openapi.json` | OpenAPI spec |
| `GET` | `/.well-known/api-catalog` | API catalog |
| `GET` | `/llms.txt` | LLM index |
| `GET` | `/llms.md` | LLM markdown |
| `GET` | `/llms-full.txt` | Expanded text |
| `GET` | `/DOCS.md` | Human docs |

## Burn/Close Routes (API Key Required)

| Method | Path | Purpose |
|------|------|---------|
| `POST` | `/burn` | Return base58 serialized transaction to burn asset |
| `POST` | `/burn/preview` | Return fee/reclaim preview without tx build |
| `POST` | `/burn-instructions` | Return serialized instructions only |
| `POST` | `/close` | Return base58 serialized transaction to close account |
| `POST` | `/close/preview` | Return close preview without tx build |
| `POST` | `/close-instructions` | Return serialized instructions only |
| `POST` | `/batch/close-all` | Return array of serialized transactions |
| `POST` | `/batch/close-all/preview` | Preview all closable accounts |
| `POST` | `/batch/close-all/summary` | Return aggregate count/reclaim totals |
| `POST` | `/batch/close-all-instructions` | Return grouped instructions per account |

## Relay Routes (API Key Required)

| Method | Path | Purpose |
|------|------|---------|
| `POST` | `/transactions/send` | Relay one signed tx |
| `POST` | `/transactions/send-batch` | Relay many signed txs |
| `POST` | `/transactions/status` | Query confirmation status |

## Common Request Fields

Single-asset operations:
- `userPublicKey` (required)
- `assetId` (required)

Batch operations:
- `userPublicKey` (required)

Shared optional fields:
- `feePayer`: string (pubkey)
- `asLegacyTransaction`: boolean
- `priorityFeeMicroLamports`: integer
- `offset`: integer (batch)
- `limit`: integer (batch)
- `partnerFeeAccount`: string (pubkey)
- `partnerFeeBps`: integer `0..9800`
- `referralCode`: string `2..20`, lowercase alphanumeric

Burn-specific optional fields:
- `burnAmount`: positive integer atomic units (`string` recommended for large values)
- `autoCloseTokenAccounts`: boolean

## Relay Payload Details

### `POST /transactions/send`

Required:
- `signedTransaction` (string)

Accepted alias:
- `transaction` (string)

Optional:
- `encoding`: `"base58"` (default) or `"base64"`
- `skipPreflight`: boolean
- `maxRetries`: integer `0..100`
- `minContextSlot`: integer `>= 0`
- `preflightCommitment`: `processed|confirmed|finalized`
- `waitForConfirmation`: boolean
- `confirmationCommitment`: `processed|confirmed|finalized`
- `confirmationTimeoutMs`: integer `1000..180000`
- `pollIntervalMs`: integer `100..5000`

### `POST /transactions/send-batch`

Required:
- `signedTransactions` (non-empty array, max 128)

Accepted alias:
- `transactions` (array)

Optional:
- same relay options as single send
- `maxConcurrency`: integer `1..32` (default `8`)

### `POST /transactions/status`

Required:
- `signature` (string)

Optional:
- `searchTransactionHistory`: boolean (default `true`)

## Validation Constraints

- `partnerFeeAccount` and `partnerFeeBps` must be provided together.
- `referralCode` is mutually exclusive with partner fee fields.
- Invalid pubkeys return `400`.
- Unsigned/malformed relay payloads return `400` with descriptive errors.
- Missing/invalid API key returns `401`.

## Response Shapes (high-level)

- `/burn` and `/close`: includes `serializedTransaction`, reclaimed lamports/SOL, operation type.
- `*-instructions`: includes `instructions[]` plus reclaimed lamports/SOL.
- `*-preview`: includes fee breakdown and operation metadata, no executable tx.
- `/batch/close-all`: includes `transactions[]`, `accountsClosed`, aggregate reclaim totals.
- `/transactions/send`: includes `signature`, `sent`, optional `confirmation`.
- `/transactions/status`: includes `signature`, `found`, and status payload.

# Private Payments API

The MagicBlock Private Payments API builds unsigned SPL token transactions for deposits, transfers,
withdrawals, swaps, and mint initialization across Solana and MagicBlock ERs. It also provides balance
queries and wallet challenge/login authentication for private reads and protected Private-ER routes.

The transaction-builder endpoints never sign as the user's wallet. They return a serialized transaction
for the caller to sign; gasless flows may already contain the configured sponsor's signature. After the
required user signatures are added, the client may submit directly to the declared RPC or use the API's
`POST /v1/transaction/send` endpoint.

**Base URL (mainnet):** `https://payments.magicblock.app`

**Hosted contract snapshot:** endpoint fields, routes, defaults, auth behavior, and fees below were
verified against the live `/doc` OpenAPI document on **2026-07-16**. This service is mutable. Re-fetch
`https://payments.magicblock.app/doc` before implementation and treat any field with no declared schema
default—such as `exactOut` in this snapshot—as unspecified rather than inferred.

## Contents

- [Authentication](#authentication)
- [Typical workflow](#typical-workflow)
- [Response and submission contract](#common-response-format)
- [SPL endpoints](#endpoints)
- [Swap endpoints](#get-v1swapquote)
- [Queued settlement and confirmation](#queued-settlement-and-confirmation)
- [MCP endpoint](#mcp-endpoint)

## Authentication

Endpoints that read private data inside the Private Ephemeral Rollup require a bearer token issued by a wallet challenge/login flow:

1. `GET /v1/spl/challenge?pubkey=<wallet>` — returns a `challenge` string
2. The wallet signs the challenge
3. `POST /v1/spl/login` with `{ pubkey, challenge, signature }` — returns a `token`
4. Pass `Authorization: Bearer <token>` on:
   - `GET /v1/spl/private-balance` (**required**)
   - `POST /v1/spl/stealth-pool` (**required**)
   - `POST /v1/spl/transfer` (**optional** — only when the request needs to connect to the Private Ephemeral Rollup)
   - `POST /v1/spl/undelegate-ephemeral-ata` (**optional** — route-dependent when the request uses the Private Ephemeral Rollup)
   - `POST /v1/transaction/send` (**optional** — required when submitting/confirming through an authenticated private ER)

Tokens are scoped to the wallet that signed the challenge.

## Typical Workflow

```
1. GET  /health                      Health check
2. POST /v1/spl/initialize-mint      One-time per mint+validator
3. GET  /v1/spl/challenge            Get challenge to sign (read-private flows)
4. POST /v1/spl/login                Exchange signed challenge for bearer token
5. POST /v1/spl/deposit              Deposit to ER → sign → send to "base"
6. GET  /v1/spl/private-balance      Check ER balance (auth required)
7. POST /v1/spl/stealth-pool         Initialize a stealth handle (auth required)
8. POST /v1/spl/transfer             Public or private transfer (auth when Private ER is used)
9. POST /v1/spl/undelegate-ephemeral-ata  Build eATA undelegation (auth when Private ER is used)
10. GET  /v1/swap/quote              Quote a swap between two mints
11. POST /v1/swap/swap               Build swap (public or private)
12. POST /v1/spl/withdraw            Build withdrawal → sign
13. POST /v1/transaction/send        Submit a signed builder response to its declared RPC
14. GET  /v1/spl/balance             Check base balance
```

## Common Response Format

SPL transaction-building endpoints (`deposit`, `transfer`, `withdraw`, `initialize-mint`, eATA
undelegation, and stealth-pool setup) use this common response shape:

```json
{
  "kind": "deposit" | "withdraw" | "transfer" | "initializeMint" | "undelegateEphemeralAta" | "stealthPool",
  "version": "legacy" | "v0",
  "transactionBase64": "<base64-encoded unsigned transaction>",
  "sendTo": "base" | "ephemeral",
  "sendRpcEndpoint": "<exact ER RPC when sendTo is ephemeral>",
  "from": "base" | "ephemeral",
  "recentBlockhash": "<blockhash>",
  "lastValidBlockHeight": 284512337,
  "instructionCount": 3,
  "requiredSigners": ["<pubkey>"],
  "validator": "<pubkey>",
  "fees": { "lamports": "0", "tokens": "0" }
}
```

Private `base → base` transfers may return `version: "v0"` when a useful lookup table is configured (set `legacy: true` to force a legacy transaction). All other flows return `legacy`.

The client must:
1. Deserialize `transactionBase64`
2. Sign with each key in `requiredSigners`
3. Send to the chain indicated by `sendTo`. When `sendRpcEndpoint` is present, use that exact ER RPC.
   Either submit directly or call `POST /v1/transaction/send` with the signed transaction.

`from` and `fees` are transfer-specific. Fee strings are in lamports or token base units and return
`"0"` when not charged. Do not calculate user totals from `amount` alone when fees are present.

The `/v1/swap/swap` endpoint has its own response shape (see Swap section).

## Error Responses

**400 (Build/Query error):**
```json
{ "error": { "code": "<string>", "message": "<string>", "details": {} } }
```

Common 400 codes: `MISSING_AUTH_TOKEN`, `UNSUPPORTED_TRANSFER_ROUTE`.

**422 (Validation error):**
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "<string>",
    "issues": [{ "code": "<string>", "message": "<string>", "path": ["field"] }]
  }
}
```

## Endpoints

### GET /health

Returns `{ "status": "ok" }`.

---

### POST /v1/transaction/send

Submit a **signed** serialized transaction to the target returned by a builder endpoint. Send
`transactionBase64`, `sendTo`, and the builder's `sendRpcEndpoint` when targeting an ER. To request
confirmation, send `confirm: true` together with the returned `recentBlockhash` and
`lastValidBlockHeight`.

The response includes `signature`, `confirmed`, `confirmationRpcEndpoint`, and
`confirmationRequiresAuthToken`. If confirmation requires auth, pass the bearer token as a header;
never log or persist a tokenized RPC URL.

---

### GET /v1/spl/challenge

Generate a challenge string for a wallet to sign as part of the login flow.

**Query params:**

| Field | Type | Required | Description |
|---|---|---|---|
| pubkey | string (pubkey) | Yes | Wallet that will read private data |
| cluster | string | No | `"mainnet"`, `"devnet"`, or custom RPC URL |

```json
{ "challenge": "1234567890" }
```

---

### POST /v1/spl/login

Exchange a wallet-signed challenge for a bearer token.

| Field | Type | Required | Description |
|---|---|---|---|
| pubkey | string (pubkey) | Yes | The wallet that signed the challenge |
| challenge | string | Yes | Challenge string returned by `/v1/spl/challenge` |
| signature | string | Yes | Wallet signature over the challenge |
| cluster | string | No | Cluster selection |

```json
{ "token": "1234567890" }
```

Returns `403` if signature verification fails.

---

### POST /v1/spl/initialize-mint

Build an unsigned base-chain transaction that initializes and delegates a validator-scoped transfer queue for a mint. One-time setup per mint+validator pair.

| Field | Type | Required | Description |
|---|---|---|---|
| payer | string (pubkey) | Yes | Transaction fee payer |
| mint | string (pubkey) | Yes | SPL mint address |
| cluster | string | No | Cluster selection |
| validator | string (pubkey) | No | Validator override |

Response extends the standard format with:
- `transferQueue`: pubkey of the created transfer queue
- `rentPda`: pubkey of the rent PDA

---

### GET /v1/spl/is-mint-initialized

Check whether a mint has a validator-scoped transfer queue on the ephemeral RPC.

**Query params:** `mint` (required), `cluster` (optional), `validator` (optional)

```json
{
  "mint": "<pubkey>",
  "validator": "<pubkey>",
  "transferQueue": "<pubkey>",
  "initialized": true
}
```

---

### POST /v1/spl/deposit

Deposit SPL tokens from Solana into an ephemeral rollup.

| Field | Type | Required | Description |
|---|---|---|---|
| owner | string (pubkey) | Yes | Wallet address |
| amount | integer (>=1) | Yes | Base-unit token amount |
| cluster | string | No | `"mainnet"`, `"devnet"`, or custom RPC URL. Defaults to mainnet |
| mint | string (pubkey) | No | Defaults to USDC (mainnet: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, devnet: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`) |
| validator | string (pubkey) | No | Defaults to ephemeral RPC identity via `getIdentity` |
| initIfMissing | boolean | No | Initialize the owner's eATA when missing |
| initVaultIfMissing | boolean | No | Auto-initialize vault if missing |
| initAtasIfMissing | boolean | No | Auto-initialize ATAs if missing |
| idempotent | boolean | No | Per-request selector for the default shuttle deposit builder (`true`) or legacy deposit builder (`false`) |
| private | boolean | No | Defaults to `true`; add the private eATA permission instruction when enabled |

```json
{
  "owner": "3rXKwQ1kpjBd5tdcco32qsvqUh1BnZjcYnS5kYrP7AYE",
  "amount": 1,
  "initIfMissing": true,
  "initVaultIfMissing": true,
  "initAtasIfMissing": true,
  "idempotent": true,
  "private": true
}
```

---

### POST /v1/spl/transfer

Transfer SPL tokens publicly or privately through an ephemeral rollup.

**Optional header:** `Authorization: Bearer <token>` — required only when the request needs to connect to the Private Ephemeral Rollup.

| Field | Type | Required | Description |
|---|---|---|---|
| from | string (pubkey) | Yes | Sender address |
| to | string (pubkey or initialized stealth handle) | Yes | Recipient owner or exact stealth handle |
| mint | string (pubkey) | Yes | SPL mint address |
| amount | integer (>=0) | Yes | Base-unit amount. Zero is reserved for supported private base→ephemeral setup flows; ordinary value transfers should be positive |
| visibility | `"public"` \| `"private"` | No | Defaults to `"private"` |
| fromBalance | `"base"` \| `"ephemeral"` | No | Source balance location; set it explicitly |
| toBalance | `"base"` \| `"ephemeral"` | No | Destination balance location; set it explicitly |
| cluster | string | No | Cluster selection |
| validator | string (pubkey) | No | Validator override |
| initIfMissing | boolean | No | Initialize the relevant eATA when missing |
| initAtasIfMissing | boolean | No | Auto-initialize ATAs |
| initVaultIfMissing | boolean | No | Auto-initialize vault when requested |
| memo | string | No | Appends a Memo Program instruction with this UTF-8 message |
| minDelayMs | string (numeric) | No | Private only. Min delay in ms. Defaults to `"0"` |
| maxDelayMs | string (numeric) | No | Private only. Max delay. Defaults to `"0"` or `minDelayMs` |
| clientRefId | string (numeric) | No | Private only. Encrypted client reference ID for confirming a payment |
| split | integer (1-15) | No | Private only. Split into N sub-transfers. Defaults to 1. Cannot exceed `amount` |
| exactOut | boolean | No | Private fee policy: `true` deducts fees from sender; `false` deducts them from recipient amount. The live schema declares no default |
| platformFeeBps | integer (0-10000) | No | Token-denominated platform fee supported only for base-source transfers |
| platformFeeAccount | string (token account pubkey) | When fee > 0 | Initialized token account for the transferred mint |
| gasless | boolean | No | When `true`, the API uses the configured sponsor as fee payer and prepends a relay-fee token transfer to the sponsor ATA |
| legacy | boolean | No | Force a legacy transaction (skip lookup-table compilation). Defaults to `false` |

```json
{
  "from": "3rXKwQ1kpjBd5tdcco32qsvqUh1BnZjcYnS5kYrP7AYE",
  "to": "Bt9oNR5cCtnfuMmXgWELd6q5i974PdEMQDUE55nBC57L",
  "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "amount": 1000000,
  "visibility": "private",
  "fromBalance": "base",
  "toBalance": "base",
  "initIfMissing": true,
  "initAtasIfMissing": true,
  "initVaultIfMissing": false,
  "memo": "Order #1042",
  "minDelayMs": "0",
  "maxDelayMs": "0",
  "clientRefId": "42",
  "split": 1,
  "gasless": true
}
```

Supported routes in the current SDK-backed API are public base→base, public
ephemeral→ephemeral, and private base→base, base→ephemeral, ephemeral→ephemeral, or
ephemeral→base. Other combinations return `UNSUPPORTED_TRANSFER_ROUTE`.

The live request schema accepts `amount: 0` for specific private base→ephemeral setup/delegation flows;
do not generalize zero as a meaningful payment amount for other routes. With `exactOut: true`, the
recipient receives `amount` and the sender pays the platform fee in addition; with `false`, the fee is
deducted from the recipient amount. Gasless mode requires a configured sponsor,
an approved stablecoin mint (mainnet USDC/USDT or devnet USDC), and a transfer of at least 0.5
USDC/USDT. It charges a 0.2 USDC/USDT relay fee. If `from` is an
off-curve PDA owner, gasless mode is ignored because the supported flow requires a wallet sender.

For a stealth handle destination, first initialize it through `POST /v1/spl/stealth-pool`. Handle bytes
are exact and case-sensitive; the service does not trim, lowercase, or normalize them. A handle may map
to one to ten destination owners, with optional split distribution. Handle transfers are private
base→base flows: set `visibility`, `fromBalance`, and `toBalance` explicitly rather than relying on
undeclared balance-location defaults. Stealth-pool initialization requires bearer authorization. Treat
pool authority, rotation, ER update completion, and user-visible canonicalization as product security
decisions.

---

### POST /v1/spl/withdraw

Withdraw SPL tokens from an ephemeral rollup back to Solana.

| Field | Type | Required | Description |
|---|---|---|---|
| owner | string (pubkey) | Yes | Wallet address |
| mint | string (pubkey) | Yes | SPL mint on Solana |
| amount | integer (>=1) | Yes | Base-unit amount |
| cluster | string | No | Cluster selection |
| validator | string (pubkey) | No | Validator override |
| initIfMissing | boolean | No | Initialize the owner's eATA when missing |
| initAtasIfMissing | boolean | No | Auto-initialize ATAs |
| escrowIndex | integer (>=0) | No | Escrow index |
| idempotent | boolean | No | Per-request selector for the default shuttle withdrawal builder (`true`) or legacy direct withdrawal builder (`false`) |

```json
{
  "owner": "3rXKwQ1kpjBd5tdcco32qsvqUh1BnZjcYnS5kYrP7AYE",
  "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "amount": 1000000,
  "idempotent": true
}
```

---

### GET /v1/spl/balance

Get the base-chain SPL token balance for an address. Reads the owner's ATA on the base RPC.

**Query params:**

| Field | Type | Required | Description |
|---|---|---|---|
| address | string (pubkey) | Yes | Owner wallet pubkey |
| mint | string (pubkey) | Yes | SPL mint pubkey |
| cluster | string | No | Cluster selection |

```json
{
  "address": "<pubkey>",
  "mint": "<pubkey>",
  "ata": "<pubkey>",
  "location": "base",
  "balance": "1000000"
}
```

`balance` is a base-unit string.

---

### GET /v1/spl/private-balance

Get the ephemeral-rollup SPL token balance for an address. Reads the owner's ATA on the ephemeral RPC.

**Required header:** `Authorization: Bearer <token>` (from `/v1/spl/login`)

**Query params:** same as `/v1/spl/balance` (`address`, `mint`, optional `cluster`).

Response has `"location": "ephemeral"`. Returns `400 MISSING_AUTH_TOKEN` if the header is absent.

---

### GET /v1/swap/quote

Get a swap quote between two SPL mints. Proxies the configured Triton Metis Swap API. The quote response can be passed as-is into `POST /v1/swap/swap`.

**Query params:**

| Field | Type | Required | Description |
|---|---|---|---|
| inputMint | string (pubkey) | Yes | Input token mint |
| outputMint | string (pubkey) | Yes | Output token mint |
| amount | string (numeric) | Yes | Raw amount before decimals |
| slippageBps | integer | No | Slippage in basis points |
| swapMode | `"ExactIn"` \| `"ExactOut"` | No | Defaults to `ExactIn` |
| dexes | string | No | Comma-separated DEX labels to include |
| excludeDexes | string | No | Comma-separated DEX labels to exclude |
| restrictIntermediateTokens | boolean | No | Restrict intermediates to a stable set |
| onlyDirectRoutes | boolean | No | Single-hop only |
| asLegacyTransaction | boolean | No | Request legacy-compatible route |
| platformFeeBps | integer | No | Platform fee in bps |
| maxAccounts | integer | No | Approximate max account budget |
| instructionVersion | `"V1"` \| `"V2"` | No | Instruction format |
| dynamicSlippage | boolean | No | Compatibility flag |
| forJitoBundle | boolean | No | Exclude routes incompatible with Jito bundles |
| supportDynamicIntermediateTokens | boolean | No | Allow dynamic intermediate selection |

The response is a Jupiter-style quote containing fields such as `inputMint`, `inAmount`, `outputMint`,
`outAmount`, `otherAmountThreshold`, `swapMode`, `slippageBps`, `priceImpactPct`, and `routePlan`. Pass
the complete response as `quoteResponse` to `/v1/swap/swap`.

---

### POST /v1/swap/swap

Build an unsigned swap transaction from a quote.

**Visibility modes:**

- **`visibility: "public"`** (default) — passes the request and response through Jupiter/Metis.
- **`visibility: "private"`** — routes Jupiter's output to a program-owned stash ATA derived from
  `(userPublicKey, quoteResponse.outputMint)`, prepends an idempotent ATA creation, and appends a
  `schedule_private_transfer` instruction for a one-shot Hydra crank. The crank invokes the on-chain
  private-transfer flow to deliver the tokens to `destination` under the requested delay/split policy.

| Field | Type | Required | Description |
|---|---|---|---|
| userPublicKey | string (pubkey) | Yes | Wallet that will sign the swap |
| quoteResponse | object | Yes | Quote response from `/v1/swap/quote` |
| visibility | `"public"` \| `"private"` | No | Defaults to `"public"` |
| destination | string (pubkey) | If private | Final private-transfer recipient |
| minDelayMs | string (numeric) | If private | Min delay in ms |
| maxDelayMs | string (numeric) | If private | Max delay in ms. Must be ≤ 600000 (10 min) |
| split | integer (1-14) | If private | Number of queue splits |
| clientRefId | string (numeric) | No | u64 correlation id attached to each split |
| validator | string (pubkey) | No | Defaults to `MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57` |
| payer | string (pubkey) | No | Optional fee payer override |
| wrapAndUnwrapSol | boolean | No | Wrap/unwrap native SOL when needed |
| useSharedAccounts | boolean | No | Allow shared accounts for routing |
| feeAccount | string (pubkey) | No | Token account to collect platform fees |
| destinationTokenAccount | string (pubkey) | No | Output token account. Server-controlled when `visibility="private"` — must match the derived stash ATA or returns `400` |
| asLegacyTransaction | boolean | No | Not allowed when `visibility="private"` |
| dynamicComputeUnitLimit | boolean | No | Auto compute unit limit |
| computeUnitPriceMicroLamports | integer | No | Exact compute unit price |
| prioritizationFeeLamports | integer \| object | No | Priority fee config |
| nativeDestinationAccount | string (pubkey) | No | Native SOL output account for supported public swaps; rejected for private swaps |
| trackingAccount | string (pubkey) | No | Public key used for downstream tracking |
| skipUserAccountsRpcCalls | boolean | No | Skip extra RPC checks for user accounts |
| dynamicSlippage | boolean | No | Allow the upstream builder to overwrite slippage |
| blockhashSlotsToExpiry | integer (>=0) | No | Number of slots until the transaction blockhash expires |
| positiveSlippage | object `{ bps: integer >=0, feeAccount?: string }` | No | Positive-slippage configuration; `bps` is required and `feeAccount` is optional |

**Public response:**
```json
{
  "swapTransaction": "<base64 unsigned transaction>",
  "lastValidBlockHeight": 318120000
}
```

**Private response** (adds diagnostic `privateTransfer` block):
```json
{
  "swapTransaction": "<base64 unsigned v0 transaction with appended ATA-create + schedule_private_transfer>",
  "lastValidBlockHeight": 318120000,
  "privateTransfer": {
    "stashAta": "<pubkey>",
    "hydraCrankPda": "<pubkey>",
    "shuttleId": 2147483647
  }
}
```

The returned transaction is unsigned — the client signs with `userPublicKey` and submits.

```json
{
  "userPublicKey": "3rXKwQ1kpjBd5tdcco32qsvqUh1BnZjcYnS5kYrP7AYE",
  "quoteResponse": { /* from /v1/swap/quote */ },
  "visibility": "private",
  "destination": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  "minDelayMs": "0",
  "maxDelayMs": "60000",
  "split": 1
}
```

## Queued Settlement and Confirmation

Confirmation has two layers:

1. `POST /v1/transaction/send` with `confirm: true` (or direct RPC confirmation) proves that the source
   transaction was accepted on its declared runtime.
2. A private queued transfer or private swap delivery is complete only after every scheduled split has
   credited the destination or entered the refund/recovery path.

The delay window controls when work becomes eligible for scheduling, not a guaranteed completion time.
Queue entries are removed when settlement actions are scheduled, before payout callbacks report their
result. Therefore source transaction confirmation and an empty queue are both insufficient evidence of
recipient payment.

Use `clientRefId` to correlate a private payment, then reconcile destination/private balance and the
relevant callback/receipt or refund evidence. The current public HTTP surface does not provide a single
general “final settlement status” endpoint, so applications that promise payment completion must own
this observation and support pending, settled, and refunded/failed states. For splits, reconcile the
full group total, not only the first credit.

## MCP Endpoint

### POST /mcp

Stateless Streamable HTTP MCP endpoint (JSON-RPC 2.0). Each request creates a fresh server with no session state.

**Headers:** `Content-Type: application/json`, `Accept: application/json`

**Registered MCP tools** (subset of the REST surface):

| Tool name | Description |
|---|---|
| `spl.deposit` | Build an unsigned base-chain deposit transaction |
| `spl.withdraw` | Build an unsigned ER → base withdraw transaction |
| `spl.transfer` | Build an unsigned public or private SPL transfer |
| `spl.getBalance` | Read the owner ATA balance on the base RPC |
| `spl.getPrivateBalance` | Read the owner ATA balance on the ephemeral RPC |

`initialize-mint`, `is-mint-initialized`, `challenge`, `login`, and the swap endpoints are **not** exposed as MCP tools — call them via REST.

**Initialize:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-11-25",
    "capabilities": {},
    "clientInfo": { "name": "my-client", "version": "1.0.0" }
  }
}
```

**Tool call:**
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "spl.deposit",
    "arguments": {
      "owner": "3rXKwQ1kpjBd5tdcco32qsvqUh1BnZjcYnS5kYrP7AYE",
      "amount": 1,
      "initIfMissing": true,
      "initAtasIfMissing": true,
      "initVaultIfMissing": false,
      "idempotent": true
    }
  }
}
```

MCP responses include `result.structuredContent` with the same fields as the REST response.

`GET /mcp` returns a human-readable info document and `GET /.well-known/mcp.json` returns the MCP discovery document.

## Constraints and defaults

- Amounts are always in base units (e.g., 1 USDC = 1,000,000 with 6 decimals)
- `mint` defaults to USDC when omitted on deposit
- `validator` defaults to the ephemeral RPC identity resolved via `getIdentity` when omitted, or to `MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57` for swaps
- `cluster` accepts `"mainnet"`, `"devnet"`, `"mainnet-private"`, `"devnet-private"`, or a custom `http(s)` base RPC override
- Private transfers and private swaps support `split` and `minDelayMs`/`maxDelayMs` for timing obfuscation. Transfers allow `split` 1–15; swaps allow 1–14 with `maxDelayMs ≤ 600000` (10 min). These delays control scheduling eligibility, not guaranteed settlement time
- Set `initIfMissing`, `initAtasIfMissing`, and `initVaultIfMissing` all to `true` for the simplest deposit integration
- `initIfMissing` initializes an eATA, not the validator-scoped transfer queue; mint initialization is a
  separate endpoint
- `idempotent` selects a builder for that deposit or withdrawal request; the request does not establish
  an account-level lifecycle setting. Deposit and withdrawal choose independently. The SDK's explicit
  `undelegateIx` has no mode flag
- SPL SOL routes use the native WSOL mint `So11111111111111111111111111111111111111112`. The API can wrap a deficient base-source balance, but WSOL token balance and wallet lamports remain distinct; private swaps do not accept `nativeDestinationAccount`
- Transfer platform fees require `platformFeeAccount`, are charged in the transferred token, and are supported only when `fromBalance` is `"base"`
- `gasless` transfers require a configured sponsor, an approved stablecoin, and at least 0.5 USDC/USDT; they prepend a 0.2 USDC/USDT relay-fee transfer. Off-curve senders do not receive gasless handling
- Auth: `/v1/spl/private-balance` and `/v1/spl/stealth-pool` always require `Authorization: Bearer <token>`. `/v1/spl/transfer`, `/v1/spl/undelegate-ephemeral-ata`, and `/v1/transaction/send` require it when their route or confirmation uses the Private ER; ordinary public builder routes do not

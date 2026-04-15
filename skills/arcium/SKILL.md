---
name: arcium
description: >
  Build and debug encrypted Solana applications with Arcium — data stays
  private during computation, no single party sees it. Use when writing Arcis
  circuits (#[encrypted], #[instruction]), wiring Anchor programs with
  init/queue_computation/callback flows, choosing Shared vs Mxe encrypted
  state, encrypting inputs with @arcium-hq/client (RescueCipher, x25519),
  or debugging ArgBuilder ordering, nonce, callback, or computation
  finalization failures. Covers dark pools, sealed-bid auctions, encrypted
  voting, hidden game state, confidential DeFi, secure randomness, and
  threshold signing. Also use for getting started with your first
  Arcium app.
license: MIT
compatibility: Bundled mcp.json configures the Arcium MCP server automatically.
metadata:
  author: arcium-hq
  version: "2.1"
---

# Arcium

Encrypted computation on Solana via MPC. Data stays encrypted during computation. The `arcium` CLI (wraps Anchor) handles init, build, test, and deploy — use MCP for current flags and options.

**MCP Tools**: `search_arcium_docs` for discovery, then `query_docs_filesystem_arcium_docs` with `head`/`cat` on the returned `.mdx` path for full-page reads (e.g., `cat /developers/arcis/mental-model.mdx`).

## When to Use

**Use when:**
- You need trustless computation -- cryptographically guaranteed, no single party sees the data
- Multiple parties compute on combined data without revealing inputs
- On-chain state must remain encrypted but computable
- Privacy: sealed-bid auctions, voting, hidden game state, dark pools, confidential DeFi

**Constraints:**
- Fixed loop bounds required (no variable-length iteration)

## Mental Model

Arcium apps have three coupled surfaces. Most bugs are mismatches across their boundaries:

| Surface | Responsibility | Common Boundary Bugs |
|---------|---------------|----------------------|
| **Circuit** (Arcis/Rust) | Pure fixed-shape MPC logic | Variable loops, dynamic collections, `.reveal()` inside conditionals |
| **Program** (Anchor/Rust) | Orchestration: init + queue + callback | Macro name mismatch, callback accounts not writable, wrong ArgBuilder order |
| **Client** (TypeScript) | Key exchange, encryption, submission, decryption | Nonce reuse, missing `.x25519_pubkey()` for Shared, param order ≠ circuit order |

**MPC constraints** (from how secret sharing works):
- Both branches of `if/else` always execute — cost = sum of both branches, not max
- Loops must have fixed bounds — no `while`, `break`, `continue`
- Comparisons are expensive; arithmetic (add/multiply) is nearly free
- `.reveal()` and `.from_arcis()` cannot be called inside conditionals
- All data must be fixed-size — no `Vec`, `String`, `HashMap`; use `[T; N]`

## Intent Router

Identify what you're building, then read the linked reference before coding. For API details, CLI flags, deployment, and versions, use MCP directly.

| Intent | Read | MCP Query |
|--------|------|-----------|
| First Arcium app | [minimal-circuit.md](examples/minimal-circuit.md) | "hello world tutorial" |
| Choose a pattern (stateless, stateful, multi-party) | [patterns.md](examples/patterns.md) | "arcium examples" |
| Circuit syntax (`#[encrypted]`, `#[instruction]`) | [patterns.md](examples/patterns.md) | "arcis encrypted instruction" |
| Shared vs Mxe encryption | See [Encryption Context](#encryption-context) below | "Shared vs Mxe encryption" |
| ArgBuilder ordering / ciphertext errors | [troubleshooting.md -- ArgBuilder Ordering Errors](references/troubleshooting.md#argbuilder-ordering-errors) | "ArgBuilder encrypted plaintext" |
| Callback not firing / computation stuck | [troubleshooting.md -- Computation Never Finalizes](references/troubleshooting.md#computation-never-finalizes) | "arcium_callback queue_computation" |
| Nonce / decryption errors | [troubleshooting.md -- Nonce Errors](references/troubleshooting.md#nonce-errors) | "RescueCipher encrypt nonce" |
| Client-side encryption (RescueCipher, x25519) | [minimal-circuit.md](examples/minimal-circuit.md) -- Test section | "RescueCipher encrypt nonce" |
| Threshold signing / secure randomness | — | "MXESigningKey sign" or "ArcisRNG" |
| Deployment (devnet/mainnet) | — | "arcium deploy cluster-offset" |
| Version / installation requirements | — | "arcium installation anchor solana" |

## Core Pattern: Three Functions

Every computation needs three functions in your Solana program:

| Function | Purpose | When Called |
|----------|---------|-------------|
| `init_<name>_comp_def` | Initialize computation definition | Once per instruction |
| `<name>` | Build args + queue computation | Each request |
| `<name>_callback` | Handle result from ARX nodes | After MPC completes |

```rust
const COMP_DEF_OFFSET_FLIP: u32 = comp_def_offset("flip");

// 1. INIT (once per instruction type)
pub fn init_flip_comp_def(ctx: Context<InitFlipCompDef>) -> Result<()> {
    init_comp_def(ctx.accounts, None, None)
}

// 2. QUEUE (each computation)
pub fn flip(ctx: Context<Flip>, offset: u64, ...) -> Result<()> {
    let args = ArgBuilder::new()...build();
    queue_computation(ctx.accounts, offset, args,
        vec![FlipCallback::callback_ix(offset, &ctx.accounts.mxe_account, &[])?],
        1, 0,
    )?;
    Ok(())
}

// 3. CALLBACK (after MPC completes)
#[arcium_callback(encrypted_ix = "flip")]
pub fn flip_callback(ctx: Context<FlipCallback>,
    output: SignedComputationOutputs<FlipOutput>) -> Result<()> {
    let result = output.verify_output(...)?;
    // Use result...
}
```

**Encryption size**: RescueCipher encrypts any scalar to 32 bytes regardless of type.
Formula: `ciphertext_size = 32 * number_of_scalar_values`. See [troubleshooting.md](references/troubleshooting.md) for the full size table.

## Encryption Context

| Scenario | Use |
|----------|-----|
| User inputs, results returned to user | `Enc<Shared, T>` |
| Internal state users shouldn't access | `Enc<Mxe, T>` |
| State persisted across computations | `Enc<Mxe, T>` |
| Final reveal to all parties | `.reveal()` |

## Gotchas

> Reference during development to avoid common mistakes.

**NEVER:**
- NEVER reuse a nonce — every `cipher.encrypt()` call needs a fresh `randomBytes(16)`
- NEVER combine multiple ciphertexts into one ArgBuilder call — each encrypted scalar is its own `[u8; 32]` call
- NEVER omit `.x25519_pubkey()` for `Enc<Shared, T>` (silent failure); `Enc<Mxe, T>` skips it

### Critical (silent failures)
- **Macro string matching**: All macro strings must exactly match `#[instruction] fn NAME` across `#[arcium_callback]`, `comp_def_offset()`, `#[init_computation_definition_accounts]`, `#[queue_computation_accounts]`, `#[callback_accounts]`
- **ArgBuilder ordering**: Calls must match circuit parameter order left-to-right. For `Enc<Shared, T>`: `.x25519_pubkey()` then `.plaintext_u128(nonce)` then ciphertexts. For `Enc<Mxe, T>`: `.plaintext_u128(nonce)` then ciphertexts. Missing `.x25519_pubkey()` for Shared = silent failure.
- **Division by secret zero**: Guard divisors with the safe divisor pattern -- both branches execute in MPC, so the division always runs. See [patterns.md — Safe Division](examples/patterns.md).
- **Combined ciphertext arrays**: Each encrypted scalar needs a separate `[u8; 32]` ArgBuilder call — do NOT pass `[u8; 64]` for a two-scalar type. See [troubleshooting.md — Ciphertext Size Mismatch](references/troubleshooting.md#ciphertext-size-mismatch).

### Warning (wrong results)
- **Nonce reuse**: Same nonce for multiple encryptions = garbled output. Use unique `randomBytes(16)` per encryption.
- **Callback account writability**: Pass extra accounts via `CallbackAccount { pubkey, is_writable: true }` in `callback_ix(..., &[...])`. Also mark `#[account(mut)]` in callback struct. Accounts cannot be created or resized during callbacks.
- **Output struct naming**: Circuit `fn add_together` generates `AddTogetherOutput`. Single returns use `field_0` (a `SharedEncryptedStruct<1>` or `MXEEncryptedStruct<1>` with `.ciphertexts` and `.nonce`). Tuple returns nest `field_0`, `field_1`, etc.

### Tips
- Prefer arithmetic over comparisons (cheaper in MPC)
- Comparisons/divisions are cheaper with narrower types (`u64` vs `u128`); storage cost is identical

## Debug Triage Order

> Start here when a computation fails or returns wrong results.

When a computation fails, returns wrong results, or never finalizes — check in this order:

1. **Names match exactly** — `#[instruction] fn NAME` must match across `#[arcium_callback(encrypted_ix = "NAME")]`, `comp_def_offset("NAME")`, and all account macros
2. **Comp def initialized** — `init_*_comp_def` must be called once before any computation
3. **ArgBuilder param order** — calls must match circuit fn parameters left-to-right
4. **Shared params include pubkey** — `.x25519_pubkey()` before `.plaintext_u128(nonce)` before ciphertexts (missing = silent failure)
5. **Nonce is unique** — fresh `randomBytes(16)` per encryption, same nonce passed to program
6. **Callback registered and writable** — `callback_ix(...)` passed in `queue_computation` call, accounts set in BOTH `CallbackAccount { pubkey, is_writable: true }` AND `#[account(mut)]` in callback struct
7. **Environment correct** — cluster offset matches network, MXE public key available (retry with backoff), RPC endpoint reliable

For detailed error solutions: [troubleshooting.md](references/troubleshooting.md)

## Verification Checklist

> Pre-deploy gate. Run through before deploying or submitting a PR.

**Circuit:**
- [ ] `arcium build` compiles without errors
- [ ] No `break`/`continue`/`return`/variable-length loops
- [ ] `#[instruction]` fn names are consistent across all macros

**Program:**
- [ ] `init_*_comp_def` called before first computation (once per instruction type)
- [ ] Every circuit fn has init + invoke + callback instructions
- [ ] `#[arcium_callback(encrypted_ix = "...")]` matches circuit fn name exactly
- [ ] Extra callback accounts passed via `CallbackAccount { pubkey, is_writable: true }` AND `#[account(mut)]` in callback struct

**Client:**
- [ ] Unique nonce per encryption (no reuse across calls)
- [ ] ArgBuilder call order matches circuit fn parameter order left-to-right
- [ ] `.x25519_pubkey()` included for every `Enc<Shared, T>` parameter
- [ ] Cluster offset matches deployment environment

**Deploy:**
- [ ] `arcium test` passes locally before deploy
- [ ] RPC endpoint is reliable (not default Solana RPC)

## Resources

- **MCP tools** (primary for API details, CLI flags, deployment, versions): `search_arcium_docs` + `query_docs_filesystem_arcium_docs` — [docs.arcium.com/mcp](https://docs.arcium.com/mcp)
- **Docs**: [docs.arcium.com/developers](https://docs.arcium.com/developers/)
- **Examples**: [github.com/arcium-hq/examples](https://github.com/arcium-hq/examples)
- **TypeScript SDK**: [ts.arcium.com](https://ts.arcium.com/)
- **Patterns**: [patterns.md](examples/patterns.md) — 15 curated circuit patterns
- **Troubleshooting**: [troubleshooting.md](references/troubleshooting.md) — hard-to-debug errors
- **Minimal working app**: [minimal-circuit.md](examples/minimal-circuit.md) — circuit + program + test

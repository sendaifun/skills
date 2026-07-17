# Ephemeral Accounts

Ephemeral Accounts are created, used, resized, and closed only inside an Ephemeral Rollup. They never
settle to Solana. Use them for high-frequency or temporary state whose loss at ER teardown is an
accepted product property, such as chat messages, transient match state, caches, or session-local data.

## Durability boundary

An ordinary delegated account begins on Solana and can commit back. An Ephemeral Account is born in
the ER and dies there. Therefore:

- it is inexpensive and fast to mutate;
- it cannot be the durable source of truth for ownership, balances, rewards, or final settlement;
- anything that must survive must be summarized or settled into a durable delegated/base account
  before the Ephemeral Account is closed or the ER state is discarded.

Choose Ephemeral Accounts for their ER-only lifecycle, not only for lower initialization cost.

## Account roles

The Anchor `#[ephemeral_accounts]` context macro recognizes:

- `sponsor` inside `#[account(...)]`: the account that pays ER rent. A context requires exactly one.
- `eph` inside `#[account(...)]`: an account managed as ER-only state.

```rust
#[ephemeral_accounts]
#[derive(Accounts)]
pub struct CreateTemporary<'info> {
    #[account(mut, sponsor)]
    pub sponsor: Signer<'info>,
    /// CHECK: Managed by the generated helper; seeds let the program sign creation.
    #[account(
        mut,
        eph,
        seeds = [b"temporary", sponsor.key().as_ref()],
        bump,
    )]
    pub temporary: AccountInfo<'info>,
}
```

The sponsor pays `32 lamports` per allocated byte, with a `60-byte` overhead per Ephemeral Account in
the current documented model. Verify current pricing before production sizing.

Generated helpers cover four lifecycle operations:

| Operation | Use |
|---|---|
| Create | Allocate a new ER-only account of an explicit length |
| Init if needed | Reuse or initialize an account when the flow is intentionally idempotent |
| Resize | Add or remove capacity as the temporary state grows or shrinks |
| Close | Delete it and return remaining sponsored rent according to the close flow |

Creation allocates bytes; the application is still responsible for writing a valid discriminator and
serialized data. Do not assume allocation automatically initializes an Anchor account value.

## Authorization and routing

- The sponsor must be delegated to the target ER first, must sign the lifecycle operation, and must
  have enough ER-available lamports for the requested size. A wallet `Signer` is a valid sponsor. A
  PDA sponsor is also supported when the context supplies its seeds. Fund and top up either form as
  needed before creating or growing Ephemeral Accounts.
- Creation, mutation, resize, and close transactions go to that ER endpoint.
- The Ephemeral Account **must sign creation** to prevent address squatting: an oncurve account signs
  the transaction directly, while a PDA uses the seeds declared on its `eph` field so the generated
  helper invokes with those seeds. The Ephemeral Account does not sign resize or close. The sponsor
  must sign every lifecycle operation, directly or through its own declared PDA seeds.
- An `#[account(..., eph)]` field is managed by the generated lifecycle helper; do not combine it with ordinary
  Anchor `init`/`init_if_needed` constraints.

Application authorization remains separate. Being the rent sponsor does not automatically make the
sponsor the owner of the temporary content; encode and check the product's authority rules.

## Design checklist

Before choosing an Ephemeral Account, answer:

1. What exact information is allowed to disappear?
2. What durable summary, if any, must be committed elsewhere?
3. Who funds growth and who may resize or close the account?
4. What is the maximum byte size and resulting sponsor cost?
5. What happens when the sponsor is underfunded?
6. Can duplicate create/resize/close requests occur, and what is the idempotency policy?
7. Which ER owns the sponsor and all accounts touched by the operation?

Do not store custody balances, durable entitlements, irreplaceable user content, or the only copy of a
settlement result in an Ephemeral Account.

## Validation

Test create, repeated create where supported, serialization, resize up/down, maximum size, sponsor
underfunding, unauthorized mutation, close/refund, and the loss boundary. Validate on a live ER because
ordinary Solana test validators do not prove ER-only lifecycle behavior.

Working example: `magicblock-engine-examples/ephemeral-account-chats/anchor`.

Sources: [MagicBlock Ephemeral Accounts docs](https://docs.magicblock.gg/pages/ephemeral-rollups-ers/introduction/ephemeral-accounts) and
[engine examples](https://github.com/magicblock-labs/magicblock-engine-examples).

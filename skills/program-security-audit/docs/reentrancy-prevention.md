# Reentrancy Prevention on Solana

## Is Reentrancy Possible on Solana?

Yes — but it works differently than EVM. Solana **prevents recursive CPI** (a program cannot call itself via CPI), but does **not** prevent a CPI target from calling a *different* program that calls back into your program via a third instruction in the same transaction.

The main risk pattern is: **state updated after CPI** (violates checks-effects-interactions).

## The Checks-Effects-Interactions Pattern

Always apply state changes **before** making external calls:

```rust
// VULNERABLE: state updated after CPI
pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    // 1. Transfer tokens (external call)
    token::transfer(cpi_ctx, amount)?;
    // 2. Update balance — attacker may have manipulated state via CPI callback
    ctx.accounts.pool.balance -= amount;
}

// SAFE: state updated before CPI
pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    // 1. Update state first
    ctx.accounts.pool.balance = ctx.accounts.pool.balance
        .checked_sub(amount)
        .ok_or(ErrorCode::InsufficientFunds)?;
    // 2. Then make external call
    token::transfer(cpi_ctx, amount)?;
}
```

## Stale Account Data After CPI

When you make a CPI that modifies an account, the local reference to that account's data becomes stale. Always reload accounts after CPIs that may have changed them.

```rust
pub fn compound(ctx: Context<Compound>) -> Result<()> {
    // CPI that modifies vault balance
    some_protocol::harvest(cpi_ctx)?;

    // WRONG: ctx.accounts.vault.balance is stale after harvest CPI
    let balance = ctx.accounts.vault.balance;

    // CORRECT: reload account data
    ctx.accounts.vault.reload()?;
    let balance = ctx.accounts.vault.balance;
}
```

## Validating CPI Targets

Never accept a program ID from user input for a CPI call:

```rust
// VULNERABLE: user controls which program gets called
pub fn execute(ctx: Context<Execute>) -> Result<()> {
    invoke(
        &Instruction {
            program_id: *ctx.accounts.target_program.key, // user-supplied!
            ...
        },
        &accounts,
    )?;
}

// SAFE: hardcode the expected program
require!(
    ctx.accounts.token_program.key() == spl_token::ID,
    ErrorCode::InvalidTokenProgram
);
```

## Flash Loan Considerations

If your program provides flash loans or allows composable operations in a single transaction, verify that all invariants hold at the end of the instruction — not just during it.

```rust
// After any CPI in a lending instruction:
let pool = &ctx.accounts.pool;
require!(
    pool.total_assets >= pool.total_liabilities,
    ErrorCode::ProtocolInsolvent
);
```

## Audit Checklist for Reentrancy

- [ ] All state mutations happen before CPIs (checks-effects-interactions)
- [ ] Account data is reloaded after any CPI that may modify it
- [ ] CPI target program IDs are hardcoded or validated, not user-supplied
- [ ] CPI accounts are validated before being passed
- [ ] Flash loan invariants are checked after execution
- [ ] No composable path allows double-spending of the same assets

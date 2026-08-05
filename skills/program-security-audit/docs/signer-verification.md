# Signer Verification on Solana

## Why Signer Checks Are Different from EVM

On Ethereum, `msg.sender` is always the transaction initiator. On Solana, a transaction can have **multiple signers**, and any account can be passed as any parameter. The program must explicitly verify that the account it treats as an authority actually signed the transaction.

## The Two-Part Check

A complete authority check requires verifying **both**:
1. The account **signed** the transaction (`is_signer == true`)
2. The account is the **expected** authority (matches a stored pubkey)

Missing either half is a vulnerability.

```rust
// WRONG: checks identity but not signature
require!(ctx.accounts.admin.key() == state.admin, ErrorCode::Unauthorized);

// WRONG: checks signature but not identity
require!(ctx.accounts.admin.is_signer, ErrorCode::Unauthorized);

// CORRECT: checks both
require!(
    ctx.accounts.admin.is_signer && ctx.accounts.admin.key() == state.admin,
    ErrorCode::Unauthorized
);
```

## Anchor Patterns

### Constraint-based (preferred)
```rust
#[derive(Accounts)]
pub struct AdminAction<'info> {
    #[account(
        mut,
        has_one = admin @ ErrorCode::Unauthorized  // checks key matches state.admin
    )]
    pub state: Account<'info, State>,

    pub admin: Signer<'info>,  // Signer<> enforces is_signer automatically
}
```

`Signer<'info>` is the correct type when an account must have signed. Using `AccountInfo<'info>` with a manual check is acceptable but more error-prone.

### Common mistake: using AccountInfo instead of Signer
```rust
// RISKY: is_signer must be manually checked
pub admin: AccountInfo<'info>,

// SAFE: Anchor enforces is_signer
pub admin: Signer<'info>,
```

## PDA Signers

PDAs (Program Derived Addresses) cannot hold a private key, so they sign via `invoke_signed`. When your program receives a PDA as a signer in a CPI, verify it was derived from the expected seeds.

```rust
// When your program calls invoke_signed:
let seeds = &[b"vault", user.key().as_ref(), &[bump]];
let signer_seeds = &[&seeds[..]];
invoke_signed(&instruction, &account_infos, signer_seeds)?;
```

## Authority Hierarchy Patterns

### Single authority
```rust
pub struct State {
    pub authority: Pubkey,
}

// Instruction check:
require!(ctx.accounts.authority.key() == ctx.accounts.state.authority, ErrorCode::Unauthorized);
```

### Multisig authority (via Squads or similar)
When a multisig controls a program, validate that the signing account is the multisig PDA, not an individual key.

```rust
require!(
    ctx.accounts.multisig_signer.key() == state.multisig,
    ErrorCode::InvalidMultisig
);
// The multisig program validates that enough members signed
```

## Audit Checklist for Signer Verification

- [ ] Every instruction that modifies state has an explicit authority signer
- [ ] `Signer<'info>` is used instead of `AccountInfo<'info>` for signers
- [ ] `has_one` constraints link signers to stored authority pubkeys
- [ ] PDA signers are derived with known, validated seeds
- [ ] No instruction accepts a "god mode" path that bypasses signer checks
- [ ] Authority upgrade/transfer requires the current authority to sign

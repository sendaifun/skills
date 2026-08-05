# Access Control Patterns on Solana

## Core Principle

Solana has no built-in roles or ownership primitives like OpenZeppelin's `Ownable`. Every access control pattern must be implemented explicitly in your program.

## Pattern 1: Single Authority

The simplest pattern — one admin pubkey stored in program state.

```rust
#[account]
pub struct Config {
    pub authority: Pubkey,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct AdminInstruction<'info> {
    #[account(
        mut,
        has_one = authority @ ErrorCode::Unauthorized,
        seeds = [b"config"],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,

    pub authority: Signer<'info>,
}
```

`has_one = authority` is Anchor shorthand for:
```rust
require!(config.authority == authority.key(), ErrorCode::Unauthorized);
```

## Pattern 2: Two-Step Authority Transfer

Single-step authority transfer is dangerous — if the new address is wrong, admin is locked out permanently.

```rust
#[account]
pub struct Config {
    pub authority: Pubkey,
    pub pending_authority: Option<Pubkey>,  // proposed new authority
}

// Step 1: current authority proposes a transfer
pub fn propose_authority(ctx: Context<ProposeAuthority>, new_authority: Pubkey) -> Result<()> {
    ctx.accounts.config.pending_authority = Some(new_authority);
    Ok(())
}

// Step 2: new authority accepts (proves they control the key)
pub fn accept_authority(ctx: Context<AcceptAuthority>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let pending = config.pending_authority.ok_or(ErrorCode::NoPendingAuthority)?;
    require!(ctx.accounts.new_authority.key() == pending, ErrorCode::Unauthorized);
    config.authority = pending;
    config.pending_authority = None;
    Ok(())
}
```

## Pattern 3: Role-Based Access Control

For programs with multiple privilege levels (e.g., admin, operator, pauser):

```rust
#[account]
pub struct Config {
    pub admin: Pubkey,       // can do everything
    pub operator: Pubkey,    // can execute operations
    pub pauser: Pubkey,      // can pause/unpause only
    pub paused: bool,
}

// Guard for admin-only instructions
pub fn require_admin(config: &Config, signer: &Signer) -> Result<()> {
    require!(config.admin == signer.key(), ErrorCode::RequiresAdmin);
    Ok(())
}

// Guard for operations that require unpaused state
pub fn require_active(config: &Config) -> Result<()> {
    require!(!config.paused, ErrorCode::ProtocolPaused);
    Ok(())
}
```

## Pattern 4: Per-User Authority (Position Ownership)

When users own their own accounts:

```rust
#[account]
pub struct Position {
    pub owner: Pubkey,
    pub amount: u64,
}

#[derive(Accounts)]
pub struct ClosePosition<'info> {
    #[account(
        mut,
        has_one = owner @ ErrorCode::NotOwner,
        close = owner,
    )]
    pub position: Account<'info, Position>,

    pub owner: Signer<'info>,
}
```

## Pattern 5: Program-Controlled PDA Authority

When a program needs to act as the authority over an account (e.g., a vault):

```rust
// Derive a PDA that the program controls
let (vault_authority, bump) = Pubkey::find_program_address(
    &[b"vault_authority"],
    program_id,
);

// Use it in CPI:
let seeds = &[b"vault_authority", &[bump]];
let signer_seeds = &[&seeds[..]];
token::transfer(
    CpiContext::new_with_signer(token_program, transfer_accounts, signer_seeds),
    amount,
)?;
```

## Common Mistakes

### Storing authority as a boolean flag
```rust
// BAD: anyone who can write to this account can grant themselves admin
pub is_admin: bool,

// GOOD: store the actual pubkey
pub admin: Pubkey,
```

### Checking authority key without checking signature
```rust
// BAD: verifies identity but not that they signed
if ctx.accounts.admin.key() == config.admin { ... }

// GOOD: Signer<> type ensures is_signer check
pub admin: Signer<'info>, // plus has_one constraint on config
```

### Hardcoded authority pubkeys in code
```rust
// BAD: requires program upgrade to change authority
const ADMIN_PUBKEY: Pubkey = pubkey!("ABC...");

// GOOD: store in upgradeable program state
pub authority: Pubkey, // can be transferred via admin instruction
```

## Audit Checklist for Access Control

- [ ] Every privileged instruction has an explicit authority check
- [ ] Authority is stored in on-chain state (not hardcoded)
- [ ] Authority transfer uses a two-step (propose + accept) pattern
- [ ] Role boundaries are clear — operators can't act as admins
- [ ] Emergency pause exists for DeFi protocols
- [ ] PDA authorities use `invoke_signed` with validated seeds
- [ ] `has_one` constraints link signer accounts to stored pubkeys
- [ ] No instruction bypasses authority checks in error paths

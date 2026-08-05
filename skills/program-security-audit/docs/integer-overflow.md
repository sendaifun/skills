# Integer Overflow & Safe Math on Solana

## The Release Build Problem

Rust panics on integer overflow in **debug** builds, but **wraps silently** in **release** builds (unless you set `overflow-checks = true` in Cargo.toml). Solana programs are compiled in release mode by default — so unchecked arithmetic is a real vulnerability.

```toml
# Cargo.toml — add this to catch overflows in release builds during testing
[profile.release]
overflow-checks = true  # enable during dev; disable for CU optimization in prod
```

Even with this setting enabled in testing, it's best practice to use checked math explicitly.

## Checked Arithmetic — Required Patterns

```rust
// Addition
let total = a.checked_add(b).ok_or(ErrorCode::Overflow)?;

// Subtraction
let remaining = balance.checked_sub(amount).ok_or(ErrorCode::Underflow)?;

// Multiplication
let value = price.checked_mul(quantity).ok_or(ErrorCode::Overflow)?;

// Division
let per_share = total.checked_div(shares).ok_or(ErrorCode::DivisionByZero)?;

// Combined (e.g., fee calculation)
let fee = amount
    .checked_mul(FEE_BPS)          // multiply first to preserve precision
    .ok_or(ErrorCode::Overflow)?
    .checked_div(10_000)
    .ok_or(ErrorCode::DivisionByZero)?;
```

## Saturating vs Checked

- **`checked_*`** — returns `None` on overflow; use when overflow means a bug or attack
- **`saturating_*`** — clamps to min/max; use when clamping is acceptable (e.g., display values)
- **`wrapping_*`** — wraps around; almost never appropriate in financial code

```rust
// Acceptable: counter that caps at u64::MAX
let display_count = count.saturating_add(1);

// NOT acceptable for balances:
let balance = old_balance.wrapping_add(deposit); // could wrap to 0!
```

## Token Amounts and Decimals

SPL tokens store amounts as `u64` with a `decimals` field. Be careful when converting between human-readable amounts and raw amounts.

```rust
// 1.5 USDC (6 decimals) = 1_500_000 raw
// Converting raw to display:
let display = raw_amount as f64 / 10f64.powi(decimals as i32);
// WARNING: never use f64 for on-chain math — use integer arithmetic only

// SAFE: multiply before divide to preserve precision
let scaled_amount = raw_amount
    .checked_mul(target_scale)
    .ok_or(ErrorCode::Overflow)?
    .checked_div(source_scale)
    .ok_or(ErrorCode::DivisionByZero)?;
```

## Large Number Intermediate Values

Intermediate calculations can overflow even when inputs and outputs are in range:

```rust
// DANGEROUS: intermediate value may overflow u64
// e.g., price = 1_000_000, quantity = 20_000_000_000 → overflow before div
let value = price * quantity / PRECISION; // overflow!

// SAFE: use u128 for intermediate calculations
let value = (price as u128)
    .checked_mul(quantity as u128)
    .ok_or(ErrorCode::Overflow)?
    .checked_div(PRECISION as u128)
    .ok_or(ErrorCode::DivisionByZero)? as u64;
```

## Anchor's `#[account]` and Numeric Types

Anchor serializes numeric fields with fixed-width types. Ensure your struct field types match the expected range:

```rust
pub struct Pool {
    pub total_deposits: u64,    // max 18.4 quintillion lamports — fine for SOL
    pub reward_rate: u64,       // rate in lamports per second
    pub last_update: i64,       // Unix timestamp — use i64 not u64
}
```

Using `i64` for timestamps is correct — `Clock::get()?.unix_timestamp` returns `i64`.

## Audit Checklist for Integer Safety

- [ ] No raw `+`, `-`, `*` on balance/amount fields in release-mode code
- [ ] All arithmetic uses `checked_*` or is proven safe by bounded inputs
- [ ] Division operations guard against zero divisor
- [ ] Intermediate calculations use `u128` where overflow is possible
- [ ] Token decimal conversions use integer arithmetic, not floats
- [ ] `i64` used for timestamps, not `u64`
- [ ] `overflow-checks = true` in dev/test Cargo profile

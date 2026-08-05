# Solana Program IDs Reference

A quick-reference for known Solana program addresses. Use during audits to validate CPI targets and sysvar accounts. If a program passes one of these as a user-supplied account, verify it matches exactly.

---

## Native Programs

| Program | Address |
|---|---|
| System Program | `11111111111111111111111111111111` |
| BPF Loader | `BPFLoaderUpgradeab1e11111111111111111111111` |
| BPF Loader (legacy) | `BPFLoader2111111111111111111111111111111111` |
| Config Program | `Config1111111111111111111111111111111111111` |
| Stake Program | `Stake11111111111111111111111111111111111111` |
| Vote Program | `Vote111111111111111111111111111111111111111` |
| Ed25519 Program | `Ed25519SigVerify111111111111111111111111111` |
| Secp256k1 Program | `KeccakSecp256k11111111111111111111111111111` |
| Address Lookup Table | `AddressLookupTab1e1111111111111111111111111` |
| Compute Budget | `ComputeBudget111111111111111111111111111111` |

---

## Sysvars

These must be validated by key when passed as accounts. Never deserialize a sysvar account without confirming the key matches.

| Sysvar | Address |
|---|---|
| Clock | `SysvarC1ock11111111111111111111111111111111` |
| Rent | `SysvarRent111111111111111111111111111111111` |
| EpochSchedule | `SysvarEpochSchedu1e111111111111111111111111` |
| Instructions | `Sysvar1nstructions1111111111111111111111111` |
| SlotHashes | `SysvarS1otHashes111111111111111111111111111` |
| StakeHistory | `SysvarStakeHistory1111111111111111111111111` |
| RecentBlockhashes (deprecated) | `SysvarRecentB1ockHashes11111111111111111111` |

**Audit note**: If a program uses `next_account_info()` to get a sysvar, check that it validates the key. Prefer `Sysvar::get()` which does not require passing the account at all.

```rust
// SAFE: no account needed, fetches directly
let clock = Clock::get()?;

// RISKY: account-based, must validate key
let clock_info = next_account_info(accounts_iter)?;
require!(
    clock_info.key == &sysvar::clock::ID,
    ErrorCode::InvalidSysvar
);
```

---

## SPL Programs

| Program | Address |
|---|---|
| SPL Token (v1) | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` |
| SPL Token 2022 | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` |
| SPL Associated Token Account | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe8bqa` |
| SPL Memo | `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr` |
| SPL Name Service | `namesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkX` |

**Audit note**: When a program accepts a `token_program` account and calls into it via CPI, always verify:
```rust
require!(
    ctx.accounts.token_program.key() == spl_token::ID
        || ctx.accounts.token_program.key() == spl_token_2022::ID,
    ErrorCode::InvalidTokenProgram
);
```

---

## Metaplex Programs

| Program | Address |
|---|---|
| Token Metadata | `metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s` |
| Candy Machine v3 | `CndyV3LdqHUfDLmE5naZjVN8rBZz4tqhdefbAnjHG3JR` |
| Bubblegum (cNFT) | `BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY` |
| Core | `CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d` |
| Auction House | `hausS13jsjafwWwGqZTUQRmWyvyxn9EQpqMwV1PBBmk` |

---

## Common DeFi Protocols

| Protocol | Program | Address |
|---|---|---|
| Jupiter v6 | Aggregator | `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4` |
| Raydium | AMM v4 | `675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8` |
| Raydium | CLMM | `CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK` |
| Orca | Whirlpools | `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc` |
| Kamino | Lending | `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD` |
| Marginfi | v2 | `MFv2hWf31Z9kbCa1snEPdcgp7m3TsEB8ga4UoBeoKxL` |
| Drift | v2 | `dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH` |
| Pyth | Oracle | `pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT` |
| Switchboard | Oracle | `SW1TCH7qEPTdLsDHRgPuMQjbQxKdH2aBStViMFnt64f` |
| Squads | Multisig v4 | `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf` |
| Jito | Tip Program | `T1pyyaTNZsKv2WcRAB8oVnk93mLJw2XzjtVYqCsaHqt` |

**Audit note**: If a protocol does a CPI into any of these without hardcoding the address, flag it as a potential arbitrary CPI vulnerability.

---

## Audit Usage

When reviewing a CPI call, look up the target program here:

```rust
// Example check pattern:
pub fn validate_jupiter_program(program: &AccountInfo) -> Result<()> {
    require!(
        program.key() == pubkey!("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"),
        ErrorCode::InvalidJupiterProgram
    );
    Ok(())
}
```

If the program ID being called is not in this list and is not the program's own ID, treat it as a **red flag** and investigate what it controls.

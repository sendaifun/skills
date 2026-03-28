---
name: godot-solana-sdk
description: >
  Use this skill when building Solana-enabled games or apps in Godot 4 with the Godot Solana SDK.
  Triggers include: Solana transactions in GDScript, SPL tokens or NFTs in a Godot project,
  connecting browser or mobile wallets (Phantom, Solflare, Backpack) in a Godot game,
  calling Anchor smart contracts from GDScript, working with Candy Machine in Godot,
  or any mention of SolanaClient, Transaction, Pubkey, Keypair, WalletAdapter, or AnchorProgram
  in a Godot context. Do NOT use for non-Godot Solana SDKs (solana-py, solana-go, solana-web3.js).
---

# Godot Solana SDK

A GDExtension (C++) plugin for Godot 4 that brings full Solana blockchain support to game development.
Write GDScript to send transactions, manage wallets, mint NFTs, and interact with Anchor programs —
on Windows, Linux, macOS, Web, Android, and iOS.

- **Repo:** https://github.com/Virus-Axel/godot-solana-sdk
- **Docs:** https://zenwiki.gitbook.io/solana-godot-sdk-docs
- **Demo:** https://zenrepublic.github.io/GodotSolanaSDKDemos/
- **Asset Library:** https://godotengine.org/asset-library/asset/3232
- **Discord:** https://discord.gg/9aFDCvqPgt

> **Security:** Mainnet use is not yet security-audited. Crypto can be stolen. Use with care.

---

## Installation

**Via Godot Asset Library (recommended)**
1. Search for **"Solana"** in the Godot Asset Library and install.
2. Install must go into the **`addons/`** folder at the project root.
3. Go to **Project → Project Settings → Plugins** and enable **SolanaSDK**.
4. Verify **`SolanaService`** appears under **Project Settings → Autoload**.

**Via GitHub Releases (manual)**
Download binaries from the [Releases page](https://github.com/Virus-Axel/godot-solana-sdk/releases),
place them under `res://bin/`, and reload the project.

---

## Configuration

After enabling the plugin, **`SolanaService`** is automatically added as an autoload singleton.

- **RPC cluster:** Select Mainnet or Devnet in the SolanaService inspector.
  Provide a custom RPC URL (e.g. from [Helius](https://www.helius.dev)) for better performance.
  The URL is also read from `Project Settings → solana_sdk/client/default_url`.
- **Wallet:** The `WalletService` child node handles auth.
  - *Use Generated* — deterministic wallet seeded from your machine ID (testing only).
  - *Custom Wallet* — path to a JSON file with the private key as a 64-byte array.

---

## Core Nodes

| Node | Inherits | Purpose |
|---|---|---|
| `SolanaClient` | `Node` | Low-level RPC calls to the Solana network |
| `Transaction` | `SolanaClient` | Build, sign, and send transactions |
| `WalletAdapter` | `Node` | Browser / mobile wallet integration |
| `Account` | `Node` | Mirror of an on-chain account, auto-syncs |
| `AccountFetcher` | `SolanaClient` | Bulk-fetch a list of Account nodes |
| `SystemProgram` | `Node` | SOL transfers and account creation |
| `TokenProgram` | `Node` | SPL Token instructions |
| `AssociatedTokenAccountProgram` | `Node` | Create Associated Token Accounts |
| `ComputeBudget` | `Node` | Set compute unit limits and priority fees |
| `MplCandyMachine` | `Node` | Candy Machine v3 minting |
| `MplCandyGuard` | `Node` | Candy Guard configuration |
| `MplTokenMetadata` | `Node` | Metaplex token metadata |
| `AnchorProgram` | `Node` | Generic interface for any Anchor program |
| `SolanaUtils` | `Node` | Base58/Base64 encoding, hashing utilities |

## Core Resources

| Resource | Purpose |
|---|---|
| `Pubkey` | 32-byte Solana public key / address |
| `Keypair` | ed25519 keypair for signing |
| `Instruction` | A single transaction instruction |
| `AccountMeta` | Account metadata entry in an instruction |
| `CandyMachineData` | Candy Machine configuration |

---

## Pubkey

```gdscript
# Create from base58 string
var pk: Pubkey = Pubkey.new_from_string("78GVwUb8ojcJVrEVkwCU5tfUKTfJuiazRrysGwgjqsif")

# Create from bytes
var pk: Pubkey = Pubkey.new_from_bytes(some_packed_byte_array)

# Derive a PDA (searches for valid bump, returns null on failure)
var program_key := Pubkey.new_from_string("CndyV3LdqHUfDLmE5naZjVN8rBZz4tqhdefbAnjHG3JR")
var pda: Pubkey = Pubkey.new_pda(["Level1"], program_key)

# Derive a PDA from raw byte seeds
var pda: Pubkey = Pubkey.new_pda_bytes([some_pubkey.to_bytes()], program_key)

# Derive Associated Token Address
var ata: Pubkey = Pubkey.new_associated_token_address(owner, mint, TokenProgram.get_pid())

# Random pubkey (for testing)
var pk: Pubkey = Pubkey.new_random()

# Convert
pk.to_string()           # base58 String
pk.to_bytes()            # PackedByteArray (32 bytes)
```

> `Pubkey.new_pda` finds the canonical valid PDA (searches for bump). `Pubkey.new_program_address`
> does not search — it constructs from exact seeds. Use `new_pda` for normal PDA derivation.

---

## Keypair

```gdscript
# Generate random keypair
var kp: Keypair = Keypair.new_random()

# From a deterministic seed
var seed = PackedByteArray(); seed.resize(32)
var kp: Keypair = Keypair.new_from_seed(seed)

# From Phantom private key (base58 string of 64 bytes)
var kp: Keypair = Keypair.new_from_bytes("3wUbDHMtMVQ...")

# From CLI-style JSON file
var kp: Keypair = Keypair.new_from_file("res://payer.json")

# Save to JSON file
kp.save_to_file("keypair.json")

# Inspect keys
kp.get_public_string()   # base58 String
kp.get_public_bytes()    # PackedByteArray (32 bytes)
kp.get_private_bytes()   # PackedByteArray (64 bytes)
kp.to_pubkey()           # Pubkey resource

# Sign and verify
var sig: PackedByteArray = kp.sign_message("hello".to_ascii_buffer())
var ok: bool = kp.verify_signature(sig, "hello".to_ascii_buffer())
```

---

## SolanaClient (RPC)

> **Important:** `SolanaClient` must be added as a child node (`add_child(client)`) for async
> HTTP requests to work. Remove and free it when done.

**Signals:**
```
http_request_completed(error: Error, response: Dictionary)
socket_response_received
```

```gdscript
var client: SolanaClient = SolanaClient.new()
add_child(client)

# Configure (optional — reads from Project Settings by default)
client.set_url_override("https://api.devnet.solana.com")
client.set_commitment("confirmed")   # "confirmed" | "finalized" | "processed"

# Make an RPC call, then await the signal
client.get_account_info("4sGjMW1sUnHzSxGspuhpqLDx6wiyjNtZAMdL4VZHirAn")
var response: Dictionary = (await client.http_request_completed)[1]
if response.has("result"):
    print(response["result"])

remove_child(client)
client.queue_free()
```

**RPC methods (all void — listen to `http_request_completed`):**
```gdscript
get_account_info(account)
get_balance(account)
get_latest_blockhash()
get_minimum_balance_for_rent_extemption(data_size)
get_transaction(signature)
get_signature_statuses(signatures, search_history)
get_signature_for_address(address, before, until)
get_token_account_balance(token_account)
get_token_accounts_by_owner(owner, mint, program_id)
get_token_supply(token_mint)
get_program_accounts(program_address, filters, with_context)
get_multiple_accounts(accounts)
request_airdrop(address, lamports)
send_transaction(encoded_transaction, max_retries, skip_preflight)
simulate_transaction(encoded_transaction, sig_verify, replace_blockhash, ...)
```

**DAS (Digital Asset Standard) methods:**
```gdscript
get_asset(asset_id)
get_asset_proof(asset_id)
get_assets_by_owner(owner, page, limit, show_fungible)
get_assets_by_authority(authority, page, limit)
get_assets_by_creator_address(creator, only_verified, page, limit)
get_assets_by_group(group_key, group_value, page, limit)
```

**WebSocket subscriptions:**
```gdscript
client.account_subscribe(account_key, Callable(self, "_on_account_changed"))
client.signature_subscribe(signature, Callable(self, "_on_confirmed"), "finalized")
client.program_subscribe(program_id, Callable(self, "_on_program_change"))
client.unsubscribe_all(callback)   # call when done; keep client in tree while subscribed
```

---

## Transaction

**Workflow:** `set_payer` → `add_instruction` → `update_latest_blockhash` → `sign_and_send`

**Signals:**
```
transaction_response_received(response: Dictionary)
transaction_simulation_failed(message_and_data: Array)
processed
confirmed
finalized
fully_signed
blockhash_updated
```

```gdscript
var payer: Keypair = Keypair.new_from_file("res://payer.json")
var receiver: Pubkey = Pubkey.new_from_string("78GVwUb8ojcJVrEVkwCU5tfUKTfJuiazRrysGwgjqsif")

var tx = Transaction.new()
add_child(tx)   # must be in scene tree

tx.set_payer(payer)
tx.add_instruction(SystemProgram.transfer(payer, receiver, 500_000))   # 0.0005 SOL
tx.update_latest_blockhash()
tx.sign_and_send()

var response = await tx.transaction_response_received
if response.has("result"):
    print("Signature:", response["result"])

# Await confirmation stages
await tx.confirmed
await tx.finalized
```

**Other useful methods:**
```gdscript
tx.set_instructions(instructions_array)
tx.set_signers([payer, another_keypair])
tx.sign()                        # signs without sending
tx.send()                        # sends without signing
tx.serialize() -> PackedByteArray
tx.get_message_hash() -> String

# Reconstruct from bytes (e.g. after passing serialized tx to wallet)
var new_tx = Transaction.new_from_bytes(tx.serialize())
new_tx.set_signers([payer])      # signers are not stored in bytes
new_tx.update_latest_blockhash()
new_tx.sign()
new_tx.send()
```

**Handle simulation failures:**
```gdscript
var data = await tx.transaction_simulation_failed
push_error("Simulation failed: " + data[0])
print("Logs:", data[1].get("logs", []))
```

---

## SystemProgram

```gdscript
# Transfer SOL
SystemProgram.transfer(sender, receiver, lamports) -> Instruction

# Create a new on-chain account
SystemProgram.create_account(from_keypair, new_account_keypair, lamports, space_bytes, owner_program) -> Instruction

# Create account with seed
SystemProgram.create_account_with_seed(from, base, seed, lamports, space, owner) -> Instruction

# Well-known pubkeys
SystemProgram.get_pid()
SystemProgram.get_sysvar_clock_pubkey()
SystemProgram.get_sysvar_rent_pubkey()
# ... and all other sysvar pubkeys
```

---

## TokenProgram (SPL Token)

> Use `transfer_checked` (requires mint + decimals), not `transfer`.

```gdscript
# Initialize a new mint (MINT_SIZE = 82 bytes)
TokenProgram.initialize_mint(mint_keypair, mint_authority, freeze_authority, decimals) -> Instruction

# Initialize a token account (MINT_ACCOUNT_SIZE = 165 bytes)
TokenProgram.initialize_account(account_keypair, mint_keypair, owner) -> Instruction

# Mint tokens
TokenProgram.mint_to(mint, account, owner, mint_authority, amount) -> Instruction

# Transfer with decimals verification
TokenProgram.transfer_checked(source, mint, destination, source_authority, amount, decimals) -> Instruction

# Freeze a token account
TokenProgram.freeze_account(account, mint, freeze_authority) -> Instruction

# Change authority
TokenProgram.set_authority(mint, current_authority, new_authority, authority_type) -> Instruction
# authority_type: 1=MintTokens, 2=FreezeAccount, 3=AccountOwner, 4=CloseAccount

TokenProgram.get_pid() -> Pubkey
```

### Create Mint + Initialize (full example)

```gdscript
const MINT_SIZE := 82

func create_token_mint(payer: Keypair) -> Keypair:
    var client = SolanaClient.new()
    add_child(client)
    client.get_minimum_balance_for_rent_extemption(MINT_SIZE)
    var lamports = (await client.http_request_completed)[1]["result"]
    remove_child(client); client.queue_free()

    var mint_kp: Keypair = Keypair.new_random()
    var tx := Transaction.new()
    add_child(tx)

    tx.add_instruction(SystemProgram.create_account(payer, mint_kp, lamports, MINT_SIZE, TokenProgram.get_pid()))
    tx.add_instruction(TokenProgram.initialize_mint(mint_kp, payer, payer, 0))
    tx.set_payer(payer)
    tx.update_latest_blockhash()
    tx.sign_and_send()
    await tx.transaction_response_received
    await tx.confirmed
    return mint_kp
```

---

## AssociatedTokenAccountProgram

```gdscript
# Derive the ATA address (does not create it)
var ata: Pubkey = Pubkey.new_associated_token_address(owner, mint, TokenProgram.get_pid())

# Create the ATA (instruction — add to transaction)
AssociatedTokenAccountProgram.create_associated_token_account(payer, owner, mint, TokenProgram.get_pid()) -> Instruction

AssociatedTokenAccountProgram.get_pid() -> Pubkey
```

> `AssociatedTokenAccountProgram` does **not** have `get_associated_token_address`.
> Use `Pubkey.new_associated_token_address` to derive the address.

---

## ComputeBudget

```gdscript
# Add to transaction before other instructions
tx.add_instruction(ComputeBudget.set_compute_unit_price(50_000))  # micro-lamports
tx.add_instruction(ComputeBudget.set_compute_unit_limit(200_000))
```

> Transactions already have default `unit_limit = 800000` and `unit_price = 8000` built in.
> Use `ComputeBudget` instructions when you need explicit control over priority fees.

---

## WalletAdapter (Browser / Mobile)

> Primarily intended for **web/browser** platform exports. Desktop and mobile require tweaking.

```gdscript
# WalletAdapter node must be in the scene tree.
$WalletAdapter.set_wallet_type(WalletAdapter.PHANTOM)  # PHANTOM, SOLFLARE, BACKPACK, LEDGER, ...
$WalletAdapter.connect_wallet()
await $WalletAdapter.connection_established

var pubkey: Pubkey = $WalletAdapter.get_connected_key()

# Use WalletAdapter as payer — triggers wallet popup on sign
$Transaction.set_payer($WalletAdapter)
$Transaction.add_instruction(SystemProgram.transfer($WalletAdapter, Pubkey.new_random(), 1_000_000))
$Transaction.update_latest_blockhash()
$Transaction.sign()
await $Transaction.fully_signed
$Transaction.send()
var response = await $Transaction.transaction_response_received
```

**Sign a text message:**
```gdscript
$WalletAdapter.sign_text_message("Hello Godot")
var signature: PackedByteArray = await $WalletAdapter.message_signed  # 64 bytes
```

**Supported wallets (enum values):**
`PHANTOM, SOLFLARE, BACKPACK, LEDGER, TREZOR, TRUST, WALLETCONNECT, COINBASE, NIGHTLY,`
`COIN98, ALPHA, AVANA, BITKEEP, BITPIE, CLOVER, COINHUB, FRACTAL, HUOBI, HYPERPAY,`
`KEYSTONE, KRYSTAL, MATH, NEKO, NUFI, ONTO, PARTICLE, SAFEPAL, SAIFU, SALMON, SKY,`
`SOLONG, SPOT, TOKENARY, TOKENPOCKET, TORUS, UNSAFEBURNER, XDEFI`

---

## AnchorProgram

Interact with any Anchor smart contract by loading its IDL.

**Setup (prefer inspector over code):**
- Add an `AnchorProgram` node to your scene.
- Set `pid` to the program's base58 address.
- Assign the IDL JSON resource to `json_file` and set `try_from_json_file = true`,
  or fetch it from the chain with `try_from_pid = true`.

**Signals:**
```
idl_fetched
account_fetched(account_data: Dictionary)
all_account_fetched
```

**Call an instruction:**
```gdscript
# Inspect anchor_program.idl in the Godot inspector to verify account order and arg types.
var program_key := Pubkey.new_from_string(PROGRAM_ID)
var level_pda := Pubkey.new_pda(["Level1"], program_key)
var vault_pda := Pubkey.new_pda(["Vault1"], program_key)

var ix: Instruction = $AnchorProgram.build_instruction(
    "restartLevel",           # exact instruction name from IDL
    [
        level_pda,            # accounts in IDL order
        vault_pda,
        SolanaService.wallet.get_kp(),   # signer
        SystemProgram.get_pid()          # system program
    ],
    AnchorProgram.u64(int(prize_sol * pow(10, 9)))
)

var tx := Transaction.new()
add_child(tx)
tx.set_payer(SolanaService.wallet.get_kp())
tx.add_instruction(ix)
tx.update_latest_blockhash()
tx.sign_and_send()
var result = await tx.transaction_response_received
```

**Typed argument helpers:**
```gdscript
AnchorProgram.u8(val)   AnchorProgram.u16(val)  AnchorProgram.u32(val)  AnchorProgram.u64(val)
AnchorProgram.s8(val)   AnchorProgram.s16(val)  AnchorProgram.s32(val)  AnchorProgram.s64(val)
AnchorProgram.f32(val)  AnchorProgram.f64(val)  AnchorProgram.option(val)
```

**Fetch an account:**
```gdscript
$AnchorProgram.fetch_account("CandyMachine", "2kJKEGhqGXJJtoWPfxnKq1Y2bN4eF9GQ39SAcGu8TDZn")
var data: Dictionary = await $AnchorProgram.account_fetched
```

---

## MplCandyMachine

```gdscript
# Initialize a Candy Machine account (InitializeV2 in Metaplex program)
MplCandyMachine.initialize(authority, candy_machine_account, collection_mint, candy_machine_data, pnft) -> Instruction

# Mint an NFT (MintV2 in Metaplex program)
MplCandyMachine.mint(payer, receiver, mint, collection_mint, collection_update_authority, candy_machine_key) -> Instruction

# Add config lines to hidden data section
MplCandyMachine.add_config_lines(candy_machine_key, authority, config_lines, index) -> Instruction

# Derive the candy machine authority PDA
MplCandyMachine.new_candy_machine_authority_pda(candy_machine_key) -> Pubkey

# Fetch candy machine account data (listens to http_request_completed)
candy_machine_node.get_candy_machine_info(candy_machine_key)

MplCandyMachine.get_pid() -> Pubkey
```

---

## SolanaUtils

```gdscript
SolanaUtils.bs58_decode(str: String) -> PackedByteArray
SolanaUtils.bs58_encode(bytes: PackedByteArray) -> String
SolanaUtils.bs64_encode(bytes: PackedByteArray) -> String
SolanaUtils.bs64_decode(str: String) -> PackedByteArray
SolanaUtils.sha256_hash_array(contents: PackedStringArray) -> PackedByteArray
```

---

## SolanaService (Helper Layer)

`SolanaService` is the autoload singleton added by the plugin. Its `wallet` child node is a
`WalletService` that abstracts keypair vs. wallet adapter login.

```gdscript
# Get the connected wallet's pubkey (works for both keypair and adapter)
var pubkey: Pubkey = SolanaService.wallet.get_pubkey()

# Get the keypair or WalletAdapter as a signer
var signer = SolanaService.wallet.get_kp()   # Keypair or WalletAdapter

# Check login state
var logged_in: bool = SolanaService.wallet.is_logged_in()

# Request an airdrop via SolanaService helper
var balance = await SolanaService.get_balance(pubkey.to_string())
```

---

## Error Handling

```gdscript
# HTTP request pattern
var params = await client.http_request_completed
var error: Error = params[0]
var response: Dictionary = params[1]

if error != OK:
    push_error("Connection error: %d" % error)
    return
if response.is_empty() or response.has("error"):
    push_error("RPC error: " + str(response.get("error", {}).get("message", "unknown")))
    return
var result = response["result"]
```

---

## Common Pitfalls

- **`SolanaClient` must be in the scene tree.** Call `add_child(client)` before making requests;
  remove and `queue_free()` when done.
- **`TokenProgram.transfer_checked`** is the correct method, not `transfer`. It requires the mint
  address and decimals to prevent cross-mint transfers.
- **`Pubkey.new_associated_token_address`** is how you derive ATAs — not a method on
  `AssociatedTokenAccountProgram`.
- **Signers are not stored in serialized transaction bytes.** After `Transaction.new_from_bytes`,
  call `set_signers([...])` again before signing.
- **AnchorProgram IDL loading:** Set `pid` and `try_from_json_file`/`try_from_pid` in the Godot
  inspector, not from GDScript.
- **`Pubkey.new_pda` returns `null`** if it cannot find a valid PDA. Always null-check.
- **WalletAdapter is primarily for Web exports.** Use `Keypair` for desktop/server builds.

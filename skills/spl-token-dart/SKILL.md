---
name: spl-token-dart
description: Build SPL Token and Token-2022 flows in Flutter and Dart with the solana package. Use to create mints, derive and create associated token accounts, mint, transfer, burn, freeze, close accounts, manage authorities, and read parsed token balances. Covers both the high-level SolanaClient extensions and the low-level TokenInstruction factories, plus Token-2022 (Token Extensions).
license: MIT
metadata:
  author: Dominion Nwakanma (web3flutter.dev)
  version: "1.0.0"
tags:
  - solana
  - spl-token
  - token-2022
  - token-extensions
  - flutter
  - dart
  - mint
  - associated-token-account
  - nft-and-tokens
---

# SPL Token Operations for Dart and Flutter

## Overview

SPL token support is built into the `solana` Dart package. There is no separate package to add. Import `package:solana/solana.dart` and you have everything for mints, token accounts, transfers, mints, burns, and authority management.

The package gives you two API layers:

1. Low-level `TokenInstruction`: factory constructors that produce individual `Instruction` objects for every Token Program operation. Use these when you compose multiple instructions into one transaction.
2. High-level `SolanaClient` extensions: convenience methods on `SolanaClient` that build, sign, and send a complete transaction for you.

Both layers target the original Token Program and Token-2022 through the `TokenProgramType` enum. The original program is the default. Pass `TokenProgramType.token2022Program` to work with Token Extensions mints.

One rule runs through everything here. Token amounts are always in the smallest unit, never in display units. For a 6 decimal token, 1 token is `1000000`. Get this wrong and you will mint or transfer a million times too much or too little.

## Instructions

1. Add `solana: ^0.31.2` to pubspec.yaml. SPL token support ships inside it.
2. Create a `SolanaClient` with an `rpcUrl` and a `websocketUrl` for the cluster you target.
3. To create a token, call `client.initializeMint(mintAuthority:, decimals:)`. It returns a `Mint` with the new mint address.
4. Before you can hold or receive a token, create an associated token account (ATA) with `client.createAssociatedTokenAccount(mint:, funder:, owner:)`. The `funder` pays rent and signs. `owner` defaults to the funder.
5. To put supply into circulation, call `client.mintTo(mint:, destination:, amount:, authority:)`. The `destination` must be an initialized token account, and `amount` is in smallest units.
6. To move tokens, call `client.transferSplToken(mint:, destination:, amount:, owner:)`. The `destination` is the recipient's wallet (owner) address, not their ATA. The method resolves both ATAs for you.
7. Always check `client.hasAssociatedTokenAccount(owner:, mint:)` before a transfer to a new recipient, and create the ATA if it is missing, otherwise the transfer throws.
8. For Token-2022 mints, pass `tokenProgramType: TokenProgramType.token2022Program` on every call that touches that mint.
9. When you need custom composition (create plus initialize in one transaction, set authority, close account), drop to `TokenInstruction` factories and send them with `client.sendAndConfirmTransaction`.

## Examples

### End to end: create a mint, create an ATA, then transfer

This is the full happy path with the real `solana` package API. It creates a 6 decimal mint, creates an ATA for the authority, mints supply, creates an ATA for the recipient if missing, and transfers. Every method here is a `SolanaClient` extension from the source.

```dart
import 'package:solana/solana.dart';

Future<void> createMintAtaAndTransfer() async {
  final client = SolanaClient(
    rpcUrl: Uri.parse('https://api.devnet.solana.com'),
    websocketUrl: Uri.parse('wss://api.devnet.solana.com'),
  );

  // Fund these wallets with devnet SOL before running.
  final authority = await Ed25519HDKeyPair.random();
  final recipient = await Ed25519HDKeyPair.random();

  const decimals = 6;
  const oneToken = 1000000; // 10^6 for a 6 decimal token

  // 1. Create a new mint. authority signs and pays.
  final mint = await client.initializeMint(
    mintAuthority: authority,
    decimals: decimals,
  );

  // 2. Create the authority's ATA so it can hold the supply.
  final authorityAta = await client.createAssociatedTokenAccount(
    mint: mint.address,
    funder: authority,
  );

  // 3. Mint 1000 tokens into the authority's ATA. amount is in smallest units.
  await client.mintTo(
    mint: mint.address,
    destination: Ed25519HDPublicKey.fromBase58(authorityAta.pubkey),
    amount: 1000 * oneToken,
    authority: authority,
  );

  // 4. Make sure the recipient has an ATA, create it if not.
  final recipientHasAta = await client.hasAssociatedTokenAccount(
    owner: recipient.publicKey,
    mint: mint.address,
  );
  if (!recipientHasAta) {
    await client.createAssociatedTokenAccount(
      mint: mint.address,
      funder: authority, // authority pays the rent here
      owner: recipient.publicKey,
    );
  }

  // 5. Transfer 250 tokens. destination is the recipient WALLET, not the ATA.
  await client.transferSplToken(
    mint: mint.address,
    destination: recipient.publicKey,
    amount: 250 * oneToken,
    owner: authority,
  );
}
```

### Read a wallet's parsed token balance

Query token accounts by owner and read the parsed amount and decimals straight off the RPC response.

```dart
import 'package:solana/solana.dart';

Future<void> printTokenBalance({
  required SolanaClient client,
  required String walletAddress,
  required String mintAddress,
}) async {
  final accounts = await client.rpcClient.getTokenAccountsByOwner(
    walletAddress,
    TokenAccountsFilter.byMint(mintAddress),
    encoding: Encoding.jsonParsed,
  );

  if (accounts.value.isEmpty) {
    print('No token account for this mint');
    return;
  }

  final data =
      accounts.value.first.account.data as ParsedSplTokenProgramAccountData;
  final info = (data.parsed as TokenAccountData).info;

  print('raw amount: ${info.tokenAmount.amount}');
  print('decimals: ${info.tokenAmount.decimals}');
  print('mint: ${info.mint}');
  print('owner: ${info.owner}');
}
```

### Derive an ATA address off chain

You do not need a network call to know where an ATA lives. It is a PDA derived from the owner, the token program, and the mint.

```dart
import 'package:solana/solana.dart';

Future<Ed25519HDPublicKey> ataFor({
  required Ed25519HDPublicKey owner,
  required Ed25519HDPublicKey mint,
}) {
  return findAssociatedTokenAddress(
    owner: owner,
    mint: mint,
    tokenProgramType: TokenProgramType.tokenProgram,
  );
}
```

### Compose with low-level instructions: create and initialize a mint in one transaction

When the high-level helper is not enough, build the instructions yourself. This creates the mint account and initializes it in a single transaction.

```dart
import 'package:solana/solana.dart';
import 'package:solana/encoder.dart';

Future<void> createMintLowLevel({
  required SolanaClient client,
  required Ed25519HDKeyPair payer,
  required Ed25519HDKeyPair mintKeypair,
  required Ed25519HDPublicKey mintAuthority,
}) async {
  final rent = await client.rpcClient.getMinimumBalanceForRentExemption(
    TokenProgram.neededMintAccountSpace,
  );

  final instructions = TokenInstruction.createAccountAndInitializeMint(
    mint: mintKeypair.publicKey,
    mintAuthority: mintAuthority,
    rent: rent,
    space: TokenProgram.neededMintAccountSpace,
    decimals: 6,
  );

  final message = Message(instructions: instructions);
  await client.sendAndConfirmTransaction(
    message: message,
    signers: [payer, mintKeypair],
    commitment: Commitment.confirmed,
  );
}
```

### Transfer mint authority (or revoke it)

`setAuthority` changes or removes an authority. Pass `null` as `newAuthority` to revoke permanently, which is how you make a fixed supply token.

```dart
import 'package:solana/solana.dart';
import 'package:solana/encoder.dart';

Future<void> revokeMintAuthority({
  required SolanaClient client,
  required Ed25519HDKeyPair currentAuthority,
  required Ed25519HDPublicKey mint,
}) async {
  final ix = TokenInstruction.setAuthority(
    mintOrAccount: mint,
    currentAuthority: currentAuthority.publicKey,
    authorityType: AuthorityType.mintTokens,
    newAuthority: null, // null revokes the authority forever
  );

  final message = Message.only(ix);
  await client.sendAndConfirmTransaction(
    message: message,
    signers: [currentAuthority],
    commitment: Commitment.confirmed,
  );
}
```

### Close an empty token account and reclaim rent

A zero balance ATA still holds rent. Close it to recover roughly 0.002 SOL.

```dart
import 'package:solana/solana.dart';
import 'package:solana/encoder.dart';

Future<void> closeEmptyAta({
  required SolanaClient client,
  required Ed25519HDKeyPair owner,
  required Ed25519HDPublicKey emptyAta,
}) async {
  final ix = TokenInstruction.closeAccount(
    accountToClose: emptyAta,
    destination: owner.publicKey, // reclaimed SOL goes here
    owner: owner.publicKey,
  );

  final message = Message.only(ix);
  await client.sendAndConfirmTransaction(
    message: message,
    signers: [owner],
    commitment: Commitment.confirmed,
  );
}
```

### Token-2022 (Token Extensions)

Token-2022 is a separate program that extends the original Token Program. Use `TokenProgramType.token2022Program` on every call that touches a Token-2022 mint. The same `SolanaClient` extensions work, you just change the program type.

```dart
import 'package:solana/solana.dart';

Future<void> token2022Ata({
  required SolanaClient client,
  required Ed25519HDKeyPair wallet,
  required Ed25519HDPublicKey token2022Mint,
}) async {
  await client.createAssociatedTokenAccount(
    mint: token2022Mint,
    funder: wallet,
    tokenProgramType: TokenProgramType.token2022Program,
  );
}
```

The `Token2022Program` class exposes instruction indexes for the extensions, for example `initializeMintCloseAuthorityInstructionIndex`, `transferFeeExtensionInstructionIndex`, `interestBearingMintExtensionInstructionIndex`, `metadataPointerExtensionInstructionIndex`, and more. The `ExtensionType` enum names the supported extensions:

| Extension | Value | Purpose |
|-----------|-------|---------|
| `transferFeeConfig` | 1 | Automatic transfer fees |
| `mintCloseAuthority` | 3 | Allow the mint account to be closed |
| `defaultAccountState` | 6 | Accounts start frozen |
| `immutableOwner` | 7 | Account owner cannot change |
| `memoTransfer` | 8 | Require a memo on transfers |
| `nonTransferable` | 9 | Soulbound tokens |
| `interestBearingConfig` | 10 | Interest accrual |
| `permanentDelegate` | 12 | Permanent delegate authority |
| `transferHook` | 14 | Custom transfer logic |
| `metadataPointer` | 18 | Pointer to a metadata account |
| `tokenMetadata` | 19 | On-chain metadata |

## Guidelines

- DO express every `amount` in the smallest unit. Multiply display units by `10^decimals`. For 6 decimal USDC, 1 USDC is `1000000`.
- DO pass the recipient's wallet (owner) address as `destination` in `transferSplToken`. The method resolves the ATAs internally.
- DO call `hasAssociatedTokenAccount` before transferring to a new recipient, and create the ATA if it is missing.
- DO create the destination token account before you call `mintTo`. The destination must already be initialized.
- DO match the `TokenProgramType` to the mint. A Token-2022 mint needs `TokenProgramType.token2022Program` on every related call.
- DO wrap `getMint` in a try/catch. It throws `TokenAccountNotFoundException` when the mint does not exist or the address is wrong.
- DO close zero balance ATAs with `closeAccount` to reclaim rent.
- DON'T pass an ATA address as `destination` in `transferSplToken`. Pass the owner wallet address.
- DON'T pass display amounts. There is no implicit decimal scaling.
- DON'T use `TokenProgramType.tokenProgram` for a Token-2022 mint, the program owner will not match and the call fails.
- DON'T try to burn native (wrapped) SOL. Use `closeAccount` to recover SOL from a wrapped SOL account instead.

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| Minted or transferred the wrong magnitude | `amount` passed in token units, not smallest units | Multiply by `10^decimals`, for 6 decimals 1 token is `1000000` |
| `NoAssociatedTokenAccountException` on transfer | Sender or recipient ATA does not exist | Call `hasAssociatedTokenAccount` first, create with `createAssociatedTokenAccount` if missing |
| Transfer sends to the wrong place or fails | ATA address passed as `destination` in `transferSplToken` | Pass the owner wallet address, the method resolves ATAs |
| `mintTo` fails with an uninitialized account | Destination token account was never created | Create the ATA with `createAssociatedTokenAccount` before minting |
| Token-2022 call fails with a program mismatch | Used `TokenProgramType.tokenProgram` for a Token-2022 mint | Pass `TokenProgramType.token2022Program` on every call for that mint |
| `TokenAccountNotFoundException` from `getMint` | Mint does not exist yet or the address is wrong | Wrap in try/catch and verify the mint address |
| Burn of wrapped SOL fails | Native SOL token burns are not supported | Use `closeAccount` to reclaim SOL from the wrapped SOL account |
| Rent slowly drains across many empty ATAs | Zero balance accounts left open | Call `closeAccount` on empty ATAs to recover roughly 0.002 SOL each |

## References

- solana Dart SDK: https://pub.dev/packages/solana
- SPL Token Program: https://spl.solana.com/token
- Token-2022 (Token Extensions): https://spl.solana.com/token-2022
- Associated Token Account Program: https://spl.solana.com/associated-token-account
- Related skills in this set: solana-dart-sdk, building-solana-transactions-flutter, solana-mobile-wallet-adapter-flutter

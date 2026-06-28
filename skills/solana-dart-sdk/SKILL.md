---
name: solana-dart-sdk
description: Build Solana apps in Dart and Flutter with the solana package (v0.31.2 by Espresso Cash). Use to call RPC methods, derive keypairs from a mnemonic, create PDAs and ATAs, build and sign transactions, encode custom instruction data with ByteArray, add priority fees, and subscribe over WebSocket. The foundational SDK that other Dart Solana tooling depends on.
license: MIT
metadata:
  author: Dominion Nwakanma (web3flutter.dev)
  version: "1.0.0"
tags:
  - solana
  - dart
  - flutter
  - rpc
  - keypair
  - transaction
  - pda
  - anchor
  - compute-budget
---

# Solana Dart SDK (solana package)

## Overview

The `solana` package (v0.31.2, by Espresso Cash) is the most complete Dart SDK for Solana. Everything else in the Dart Solana ecosystem builds on it. It gives you:

- `RpcClient`: all 52 JSON-RPC methods with proper Dart types.
- `SolanaClient`: a high-level send-and-confirm orchestrator.
- `Ed25519HDKeyPair` and `Ed25519HDPublicKey`: BIP39 mnemonic derivation and PDA creation.
- `Message`, `Instruction`, `SignedTx`: transaction building and encoding.
- `SubscriptionClient`: WebSocket subscriptions for accounts, logs, slots, and signatures.
- Built-in program helpers: SystemProgram, Token, Token-2022, ATA, ComputeBudget, Memo, Stake.

Pin it and treat it as the base layer for any Dart or Flutter Solana app.

Package: https://pub.dev/packages/solana

## Instructions

1. Add `solana: ^0.31.0` to pubspec.yaml.
2. Pick the right import. Use `package:solana/solana.dart` for everything, or `package:solana/encoder.dart` when you only build transactions (`Message`, `Instruction`, `SignedTx`, `AccountMeta`, `ByteArray`).
3. Create a `SolanaClient` (rpcUrl plus websocketUrl) for high-level flows, or a bare `RpcClient` for direct RPC. For production, point both at a paid provider (Helius, QuickNode, Triton), not the public endpoint.
4. Unwrap context-wrapped RPC results with `.value`. `getBalance` returns a `BalanceResult`, `getLatestBlockhash` returns a context result whose `.value` holds `blockhash` and `lastValidBlockHeight`.
5. Derive keypairs with `Ed25519HDKeyPair.fromMnemonic(m, account: 0, change: 0)` for Phantom and Solflare compatibility (the standard `m/44'/501'/0'/0'` path).
6. Build instructions, wrap them in a `Message`, then call `client.sendAndConfirmTransaction` with `Commitment.confirmed`. Drop to manual `compile` plus `SignedTx` only when you need control.
7. For custom programs, build an `Instruction` with `AccountMeta.writeable` or `AccountMeta.readonly` and encode data with `ByteArray` (all integers little-endian).
8. On mainnet, prepend `ComputeBudgetInstruction.setComputeUnitLimit` and `setComputeUnitPrice` to your instruction list.
9. Watch confirmations or account changes with `SubscriptionClient`, and call `close()` when done.
10. Wrap sends in a try and catch `JsonRpcException` to read `code`, `message`, and `transactionError`.

## Examples

### Connect, airdrop, and read a balance

```dart
import 'package:solana/solana.dart';

Future<double> airdropAndReadBalance() async {
  final client = SolanaClient(
    rpcUrl: Uri.parse('https://api.devnet.solana.com'),
    websocketUrl: Uri.parse('wss://api.devnet.solana.com'),
  );

  final wallet = await Ed25519HDKeyPair.random();
  await client.rpcClient.requestAirdrop(wallet.address, lamportsPerSol);

  // getBalance returns a BalanceResult, not an int. Unwrap with .value.
  final result = await client.rpcClient.getBalance(wallet.address);
  final lamports = result.value; // int
  return lamports / lamportsPerSol;
}
```

The `.value` unwrap applies to every context-wrapped RPC. The same shape covers `getLatestBlockhash`:

```dart
import 'package:solana/solana.dart';

Future<({String blockhash, int lastValid})> latestBlockhash(RpcClient rpc) async {
  final bh = await rpc.getLatestBlockhash();
  return (
    blockhash: bh.value.blockhash,        // String
    lastValid: bh.value.lastValidBlockHeight, // int
  );
}
```

### Derive a wallet keypair from a mnemonic

```dart
import 'package:solana/solana.dart';

Future<Ed25519HDKeyPair> importWallet(String mnemonic) async {
  // account: 0, change: 0 produces m/44'/501'/0'/0', the standard Phantom path.
  return Ed25519HDKeyPair.fromMnemonic(mnemonic, account: 0, change: 0);
}
```

### Find a PDA and an ATA

```dart
import 'package:solana/solana.dart';

Future<({Ed25519HDPublicKey pda, Ed25519HDPublicKey ata})> deriveAddresses({
  required Ed25519HDPublicKey walletPubkey,
  required Ed25519HDPublicKey mintPubkey,
}) async {
  final metaplexProgramId = Ed25519HDPublicKey.fromBase58(
    'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',
  );

  // findProgramAddress returns Ed25519HDPublicKey directly, not a (key, bump) tuple.
  final pda = await Ed25519HDPublicKey.findProgramAddress(
    seeds: [
      'metadata'.codeUnits,
      metaplexProgramId.bytes,
      mintPubkey.bytes,
    ],
    programId: metaplexProgramId,
  );

  final ata = await findAssociatedTokenAddress(
    owner: walletPubkey,
    mint: mintPubkey,
    tokenProgramType: TokenProgramType.tokenProgram, // or .token2022Program
  );

  return (pda: pda, ata: ata);
}
```

### Send SOL with confirmation

```dart
import 'package:solana/solana.dart';

Future<TransactionId> sendSol({
  required SolanaClient client,
  required Ed25519HDKeyPair sender,
  required Ed25519HDPublicKey recipient,
  required int lamports,
}) async {
  final message = Message.only(
    SystemInstruction.transfer(
      fundingAccount: sender.publicKey,
      recipientAccount: recipient,
      lamports: lamports,
    ),
  );
  return client.sendAndConfirmTransaction(
    message: message,
    signers: [sender],
    commitment: Commitment.confirmed,
  );
}
```

### Manual transaction build, sign, and raw send

```dart
import 'package:solana/solana.dart';
import 'package:solana/encoder.dart';

Future<TransactionId> manualTransfer({
  required RpcClient rpc,
  required Ed25519HDKeyPair sender,
  required Ed25519HDPublicKey recipient,
  required int lamports,
}) async {
  final transferIx = SystemInstruction.transfer(
    fundingAccount: sender.publicKey,
    recipientAccount: recipient,
    lamports: lamports,
  );
  final message = Message(instructions: [transferIx]);

  final bh = await rpc.getLatestBlockhash();
  final compiled = message.compile(
    recentBlockhash: bh.value.blockhash,
    feePayer: sender.publicKey,
  );

  final signature = await sender.sign(compiled.toByteArray());
  final signedTx = SignedTx(
    signatures: [signature],
    compiledMessage: compiled,
  );

  return rpc.sendTransaction(
    signedTx.encode(), // base64
    preflightCommitment: Commitment.confirmed,
  );
}
```

### Custom instruction with ByteArray data

```dart
import 'package:solana/solana.dart';
import 'package:solana/encoder.dart';

Instruction buildCustomIx({
  required Ed25519HDPublicKey programId,
  required Ed25519HDPublicKey accountA,
  required Ed25519HDPublicKey accountB,
  required Ed25519HDPublicKey accountC,
}) {
  return Instruction(
    programId: programId,
    accounts: [
      AccountMeta.writeable(pubKey: accountA, isSigner: true),
      AccountMeta.readonly(pubKey: accountB, isSigner: false),
      AccountMeta.writeable(pubKey: accountC, isSigner: false),
    ],
    data: ByteArray.merge([
      ByteArray.u8(0),            // instruction index
      ByteArray.u64(1000000),     // amount argument (8 bytes LE)
      ByteArray.fromString('hi'), // 8-byte length prefix + UTF-8 bytes
    ]),
  );
}
```

### Priority fees for mainnet

```dart
import 'package:solana/solana.dart';
import 'package:solana/encoder.dart';

Message withPriorityFees(List<Instruction> instructions) {
  final setLimit = ComputeBudgetInstruction.setComputeUnitLimit(units: 200000);
  final setPrice = ComputeBudgetInstruction.setComputeUnitPrice(microLamports: 50000);

  return Message(instructions: [
    setLimit,
    setPrice, // compute budget instructions go first
    ...instructions,
  ]);
}
```

### WebSocket subscriptions

```dart
import 'package:solana/solana.dart';

void watchTransaction(SolanaClient client, TransactionId txId) {
  final sub = client.createSubscriptionClient();

  sub.signatureSubscribe(txId).listen((status) {
    if (status.err == null) print('Confirmed!');
  });

  // Remember to call sub.close() once you no longer need updates.
}
```

### Anchor instruction with auto discriminator

```dart
import 'package:solana/solana.dart';
import 'package:solana/anchor.dart';
import 'package:solana/encoder.dart';

Future<Instruction> anchorInitialize({
  required Ed25519HDPublicKey programId,
  required Ed25519HDPublicKey counterPda,
  required Ed25519HDKeyPair wallet,
}) async {
  return AnchorInstruction.forMethod(
    programId: programId,
    method: 'initialize',
    namespace: 'global', // always 'global' for instructions
    accounts: [
      AccountMeta.writeable(pubKey: counterPda, isSigner: false),
      AccountMeta.writeable(pubKey: wallet.publicKey, isSigner: true),
      AccountMeta.readonly(
        pubKey: Ed25519HDPublicKey.fromBase58('11111111111111111111111111111111'),
        isSigner: false,
      ),
    ],
    arguments: ByteArray.u64(42), // args after the discriminator
  );
}
```

### Retry on a stale blockhash

```dart
import 'package:solana/solana.dart';
import 'package:solana/encoder.dart';

Future<TransactionId> sendWithRetry({
  required RpcClient rpc,
  required Message message,
  required List<Ed25519HDKeyPair> signers,
  int maxRetries = 3,
}) async {
  for (var i = 0; i < maxRetries; i++) {
    try {
      // signAndSendTransaction fetches a fresh blockhash each call.
      return await rpc.signAndSendTransaction(message, signers);
    } on JsonRpcException catch (e) {
      if (e.message.contains('Blockhash not found') && i < maxRetries - 1) {
        await Future<void>.delayed(const Duration(seconds: 2));
        continue;
      }
      rethrow;
    }
  }
  throw Exception('Transaction failed after $maxRetries retries');
}
```

## Guidelines

- DO unwrap context-wrapped RPC results with `.value`. `getBalance` returns a `BalanceResult`, `getLatestBlockhash` returns a context result, and passing the wrapper where an int or String is expected fails in non-obvious ways.
- DO derive wallets with `account: 0, change: 0` so you get `m/44'/501'/0'/0'`. Omitting these or using wrong values derives a different address from the same mnemonic. This is the number one wallet import bug.
- DO use `findProgramAddress` for PDAs. It returns an `Ed25519HDPublicKey` directly and finds the bump internally. Reach for `createProgramAddress` only when you already have an explicit bump.
- DO match every `AccountMeta` against the program's IDL or source. Pick `.writeable()` or `.readonly()` and set `isSigner` exactly. Wrong values cause "failed to simulate transaction" with no useful message.
- DO add `ComputeBudgetInstruction.setComputeUnitPrice` on mainnet, and put the compute budget instructions first in the list. 50,000 microLamports is a reasonable baseline, but check recent priority fee levels.
- DO use a paid RPC provider in production. Public endpoints rate-limit at 40 requests per 10 seconds and will break under load.
- DO use `Commitment.confirmed` or stronger for reads that follow a write. `Commitment.processed` can be rolled back.
- DON'T forget `.value`. It is the most common context-unwrap mistake on `getBalance` and `getLatestBlockhash`.
- DON'T copy TypeScript PDA patterns that expect a `(key, bump)` tuple. The Dart `findProgramAddress` returns only the key.
- DON'T build a transaction early and send it late. Fetch the blockhash right before signing, or let `sendAndConfirmTransaction` handle it.
- DON'T pass `Encoding.jsonParsed` to `getAccountInfo` for unknown programs. Use `Encoding.base64` and decode the raw account data yourself.

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| Type error or wrong value from `getBalance` | Used the `BalanceResult` directly instead of the int | Read `result.value` |
| Imported wallet has the wrong address | Derivation omitted `account: 0, change: 0` | Use `Ed25519HDKeyPair.fromMnemonic(m, account: 0, change: 0)` |
| PDA code expects a bump tuple | Ported a TypeScript pattern | `findProgramAddress` returns only `Ed25519HDPublicKey`; bump is internal |
| "failed to simulate transaction" with no detail | Wrong `isSigner` or writeable flag on an `AccountMeta` | Check each account against the program's IDL or source |
| Transaction dropped during congestion | No priority fee on mainnet | Add `ComputeBudgetInstruction.setComputeUnitPrice()` first in the list |
| "Blockhash not found" | Transaction built too early, sent too late | Fetch blockhash right before signing, or use `sendAndConfirmTransaction` |
| App breaks under load | Hitting the public RPC rate limit (40 req/10s) | Use a paid provider (Helius, QuickNode, Triton) |
| Stale read right after a write | Used `Commitment.processed` | Use `Commitment.confirmed` or stronger for post-write reads |
| Garbage from `getAccountInfo` | `jsonParsed` used on an unknown program | Use `Encoding.base64` and decode manually |

## References

- solana package: https://pub.dev/packages/solana
- solana source (Espresso Cash): https://github.com/espresso-cash/espresso-cash-public/tree/master/packages/solana
- Solana JSON-RPC reference: https://solana.com/docs/rpc
- Solana program derived addresses: https://solana.com/docs/core/pda
- Related skills in this set: solana-mobile-wallet-adapter-flutter, building-solana-transactions-flutter, flutter-solana-wallet-security

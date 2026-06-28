---
name: building-solana-transactions-flutter
description: Build, sign, simulate, and send Solana transactions in Dart and Flutter with the solana SDK and coral_xyz. Use to compile legacy or V0 messages, order signers, add compute-budget priority fees, simulate before sending, and diagnose "failed to simulate transaction" errors from JsonRpcException and TransactionError. Cross-platform Dart.
license: MIT
metadata:
  author: Dominion Nwakanma (web3flutter.dev)
  version: "1.0.0"
tags:
  - solana
  - transactions
  - flutter
  - dart
  - coral-xyz
  - simulation
  - priority-fees
  - compute-budget
  - signing
---

# Building Solana Transactions in Dart and Flutter

## Overview

Every Solana transaction in Dart follows the same lifecycle: build instructions into a `Message`, fetch a recent blockhash, compile the message (legacy or V0), sign with all required keypairs, simulate (optional but recommended), then send and confirm.

The `solana` package gives you low-level control at every step. The `coral_xyz` package wraps an Anchor program in a fluent builder that runs the full lifecycle for you.

Two failures dominate real apps. Blockhashes expire in about 60 seconds, so a stale one breaks sends. And "failed to simulate transaction" is a generic wrapper: the real cause sits inside the `TransactionError`. This skill covers both, plus priority fees, which you need for reliable landing during congestion.

Pin `solana` at 0.31.2 or higher. If you add the `coral_xyz` builder, pin `solana` at ^0.32.0, because coral_xyz beta.9 depends on solana ^0.32.0. Expect minor API drift on both.

## Instructions

1. Add `solana: ^0.31.2` to pubspec.yaml. Add `coral_xyz` only if you are calling an Anchor program through a typed builder, and in that case pin `solana: ^0.32.0` to satisfy coral_xyz beta.9.
2. Build your instructions, then compose them into a `Message`. Use `Message.only(ix)` for a single instruction or `Message(instructions: [ix1, ix2])` for several.
3. Fetch a fresh blockhash with `getLatestBlockhash` immediately before you sign. Never cache it across transactions.
4. Compile with `message.compile` for legacy or `message.compileV0` when you need address lookup tables.
5. Put the fee payer first in the signers list. The signature order must match the signer-account order in the compiled message.
6. Sign with `signTransaction` (legacy) or `signV0Transaction` (V0). Both throw `FormatException` if the signer count does not match the required count.
7. Simulate with `simulateTransaction` before sending. Pick either `sigVerify` or `replaceRecentBlockhash`, never both.
8. Prepend `ComputeBudgetInstruction.setComputeUnitLimit` and `setComputeUnitPrice` so the transaction lands during congestion.
9. Send. For the simplest path use `client.sendAndConfirmTransaction`. For manual control use `rpcClient.sendTransaction`, and match `preflightCommitment` to the commitment you used when creating the accounts.
10. Wrap sends in a `try`/`catch` for `JsonRpcException`. Read `e.transactionError` and `e.data` to find the real cause.

## Examples

### Quick start: send SOL end to end

The high-level path. `sendAndConfirmTransaction` fetches the blockhash, compiles, signs, sends, and waits for confirmation in one call.

```dart
import 'package:solana/solana.dart';

Future<String> sendSol({
  required SolanaClient client,
  required Ed25519HDKeyPair sender,
  required Ed25519HDPublicKey recipient,
  required int lamports,
}) async {
  final instruction = SystemInstruction.transfer(
    fundingAccount: sender.publicKey,
    recipientAccount: recipient,
    lamports: lamports,
  );

  return client.sendAndConfirmTransaction(
    message: Message.only(instruction),
    signers: [sender],
    onSigned: ignoreOnSigned,
    commitment: Commitment.confirmed,
  );
}
```

### Manual control: compile, sign, simulate, send

When you need to inspect the compiled bytes, simulate explicitly, or branch on the result. The fee payer is first in the signers list.

```dart
import 'package:solana/solana.dart';

Future<String?> sendManually({
  required RpcClient rpcClient,
  required Ed25519HDKeyPair signer,
  required Message message,
}) async {
  // 1. Fetch the blockhash right before signing.
  final bh = await rpcClient
      .getLatestBlockhash(commitment: Commitment.confirmed)
      .then((r) => r.value);

  // 2. Compile and sign. Fee payer signs the compiled bytes.
  final compiled = message.compile(
    recentBlockhash: bh.blockhash,
    feePayer: signer.publicKey,
  );
  final signatures = await Future.wait(
    [signer].map((s) => s.sign(compiled.toByteArray())),
  );
  final signedTx = SignedTx(
    compiledMessage: compiled,
    signatures: signatures,
  );

  // 3. Simulate first. Bail out if it fails.
  final sim = await rpcClient.simulateTransaction(
    signedTx.encode(),
    commitment: Commitment.confirmed,
  );
  if (sim.value.err != null) {
    print('Simulation failed: ${sim.value.err}');
    print('Logs: ${sim.value.logs}');
    return null;
  }

  // 4. Send. Match preflight to your account-creation commitment.
  return rpcClient.sendTransaction(
    signedTx.encode(),
    preflightCommitment: Commitment.confirmed,
  );
}
```

### Legacy and V0 signing helpers

`signTransaction` and `signV0Transaction` validate that the signer count equals the required count and throw `FormatException` on a mismatch. The fee payer must be the first signer.

```dart
import 'package:solana/solana.dart';

Future<SignedTx> signLegacy({
  required LatestBlockhash latestBlockhash,
  required Message message,
  required Ed25519HDKeyPair feePayer,
  required Ed25519HDKeyPair otherSigner,
}) {
  // Fee payer first, additional signers after.
  return signTransaction(latestBlockhash, message, [feePayer, otherSigner]);
}

Future<SignedTx> signV0({
  required LatestBlockhash recentBlockhash,
  required Message message,
  required Ed25519HDKeyPair signer,
  required AddressLookupTableAccount lookupTable,
}) {
  return signV0Transaction(
    recentBlockhash,
    message,
    [signer],
    addressLookupTableAccounts: [lookupTable],
  );
}
```

### Simulate with explicit flags

`sigVerify` and `replaceRecentBlockhash` are mutually exclusive. Use `replaceRecentBlockhash: true` to let the node supply a fresh blockhash when the transaction is not properly signed yet.

```dart
import 'package:solana/solana.dart';

Future<bool> simulate({
  required RpcClient rpcClient,
  required SignedTx signedTx,
}) async {
  final result = await rpcClient.simulateTransaction(
    signedTx.encode(),
    sigVerify: false,             // Skip signature verification.
    commitment: Commitment.confirmed,
    replaceRecentBlockhash: true, // Use the node's blockhash. Cannot combine with sigVerify.
  );

  print('Error: ${result.value.err}');          // TransactionError?, null means success.
  print('Logs: ${result.value.logs}');          // List<String> of program logs.
  print('Units: ${result.value.unitsConsumed}'); // Compute units used.
  return result.value.err == null;
}
```

### Priority fees with a multi-instruction transaction

Prepend the compute budget instructions so they run first. Then create the destination ATA if it is missing, transfer, and attach a memo.

```dart
import 'package:solana/solana.dart';

Future<String> payWithPriorityFee({
  required SolanaClient client,
  required Ed25519HDKeyPair wallet,
  required Ed25519HDPublicKey recipient,
  required Ed25519HDPublicKey senderAta,
  required Ed25519HDPublicKey ataPubKey,
  required Ed25519HDPublicKey mintPubKey,
}) {
  final message = Message(instructions: [
    // Priority fee instructions run first.
    ComputeBudgetInstruction.setComputeUnitLimit(units: 200000),
    ComputeBudgetInstruction.setComputeUnitPrice(microLamports: 5000),

    // Create the recipient ATA.
    AssociatedTokenAccountInstruction.createAccount(
      funder: wallet.publicKey,
      address: ataPubKey,
      owner: recipient,
      mint: mintPubKey,
    ),

    // Transfer tokens.
    TokenInstruction.transfer(
      source: senderAta,
      destination: ataPubKey,
      owner: wallet.publicKey,
      amount: 1000000,
    ),

    // Optional memo.
    MemoInstruction(signers: [wallet.publicKey], memo: 'Payment'),
  ]);

  return client.sendAndConfirmTransaction(
    message: message,
    signers: [wallet],
    onSigned: ignoreOnSigned,
    commitment: Commitment.confirmed,
  );
}
```

### Retry with a fresh blockhash

`sendAndConfirmTransaction` fetches a new blockhash on each call, so a retry on `blockhashNotFound` picks up a fresh one automatically.

```dart
import 'package:solana/solana.dart';

Future<String> sendWithRetry({
  required SolanaClient client,
  required Message message,
  required List<Ed25519HDKeyPair> signers,
  int maxAttempts = 3,
}) async {
  for (var i = 0; i < maxAttempts; i++) {
    try {
      return await client.sendAndConfirmTransaction(
        message: message,
        signers: signers,
        onSigned: ignoreOnSigned,
        commitment: Commitment.confirmed,
      );
    } on JsonRpcException catch (e) {
      if (e.transactionError == TransactionError.blockhashNotFound &&
          i < maxAttempts - 1) {
        continue; // Retry. sendAndConfirmTransaction fetches a fresh blockhash.
      }
      rethrow;
    }
  }
  throw Exception('Max retry attempts exceeded');
}
```

### coral_xyz typed builder

`TypeSafeMethodBuilder` exposes five terminal operations. Use `.rpc()` to sign, send, and confirm, or `.simulate()` to dry-run without sending.

```dart
import 'package:coral_xyz/coral_xyz.dart';

Future<String> callProgram({
  required Program program,
  required int arg1,
  required int arg2,
  required PublicKey account1,
  required PublicKey account2,
  required Keypair signer,
}) async {
  final builder = program.methods
      .myInstruction([arg1, arg2])
      .accounts({'account1': account1, 'account2': account2})
      .signers([signer]);

  // Terminal operations:
  // builder.instruction() -> just the instruction
  // builder.transaction()  -> unsigned transaction
  // builder.simulate()     -> simulate without sending
  // builder.view()         -> simulate and decode return data
  // builder.rpc()          -> sign, send, confirm (most common)
  return builder.rpc();
}
```

### Diagnose a failed send

The "failed to simulate transaction" error surfaces as `JsonRpcException` with code `-32002`. The real cause is in `transactionError`, and the program logs are in `data`.

```dart
import 'package:solana/solana.dart';

Future<void> sendAndDiagnose({
  required SolanaClient client,
  required Message message,
  required List<Ed25519HDKeyPair> signers,
}) async {
  try {
    await client.sendAndConfirmTransaction(
      message: message,
      signers: signers,
      onSigned: ignoreOnSigned,
      commitment: Commitment.confirmed,
    );
  } on JsonRpcException catch (e) {
    print('RPC error code: ${e.code}');
    print('Message: ${e.message}');
    print('Transaction error: ${e.transactionError}');
    print('Data (contains logs): ${e.data}');
    rethrow;
  }
}
```

## Guidelines

- DO fetch a fresh blockhash immediately before signing. They expire in about 60 seconds, so never cache one across transactions.
- DO put the fee payer first in the signers list. The first signer is always the fee payer.
- DO simulate before sending so you catch failures cheaply, and read `result.value.logs` when `err` is non-null.
- DO match `preflightCommitment` to the commitment you used to create the accounts. If you created them with `confirmed`, send with `confirmed`.
- DO prepend `ComputeBudgetInstruction.setComputeUnitPrice` so the transaction lands during congestion.
- DO check and create the ATA before a token transfer. Use `hasAssociatedTokenAccount`, then `createAssociatedTokenAccount`.
- DON'T combine `sigVerify: true` with `replaceRecentBlockhash: true`. They are mutually exclusive.
- DON'T use `skipPreflight: true` to hide simulation errors. It only delays the failure to landing time.
- DON'T ignore `JsonRpcException.data`. It carries the program logs that explain the failure.
- DON'T resend a transaction blindly after `alreadyProcessed`. Check `getSignatureStatuses` first.

## Common Errors

The most common failure is "failed to simulate transaction", which arrives as a `JsonRpcException` with code `-32002`. Read the `transactionError` field to find the actual `TransactionError`. This table maps each value to its cause and fix.

| Error | Cause | Fix |
|-------|-------|-----|
| `programAccountNotFound` | Program not deployed on the target cluster | Verify the program ID exists on the RPC cluster (devnet vs mainnet) |
| `blockhashNotFound` | Blockhash expired (older than about 60 seconds) | Fetch a fresh blockhash immediately before signing |
| `insufficientFundsForFee` | Fee payer has too little SOL | Fund the fee payer (about 0.000005 SOL per signature) |
| `instructionError` | A program rejected the instruction | Read the logs. Common causes are a PDA mismatch, wrong seeds, or a constraint violation |
| `signatureFailure` | Wrong or missing signatures | Confirm every required signer is in the signers list |
| `missingSignatureForFee` | Fee payer did not sign | Put the fee payer first in the signers list |
| `accountNotFound` | A referenced account does not exist | Create the account first, for example the ATA for token transfers |
| `alreadyProcessed` | Duplicate transaction | The tx already landed. Check `getSignatureStatuses` before retrying |
| `FormatException` on signing | Signer count does not match the required count | Provide exactly the required signers, fee payer first |
| `NoAssociatedTokenAccountException` | Destination ATA is missing | Create the ATA before building the token transfer instruction |
| `JsonRpcException` after `confirmed` account creation | `preflightCommitment` defaults to `finalized`, which cannot see the new accounts yet | Pass `preflightCommitment: Commitment.confirmed` to match the creation commitment |

## Compute Budget and Priority Fees

Prepend compute budget instructions to every transaction for reliable landing. These four instructions control the budget.

| Instruction | Purpose |
|-------------|---------|
| `setComputeUnitLimit(units:)` | Max compute units for the transaction (default is 200k per instruction) |
| `setComputeUnitPrice(microLamports:)` | Priority fee per compute unit. Higher lands faster |
| `requestHeapFrame(bytes:)` | Increase the heap from 32KB (max 256KB) |
| `setLoadedAccountsDataSizeLimit(bytes:)` | Cap the loaded account data size |

Pick a priority fee from current network conditions.

| Scenario | microLamports |
|----------|---------------|
| Low congestion | 1 to 100 |
| Normal | 1,000 to 10,000 |
| High demand or time-sensitive | 50,000 to 500,000 |
| MEV-prone swaps | 100,000 to 1,000,000 |

## Commitment Levels

```dart
enum Commitment { processed, confirmed, finalized }
```

| Level | Speed | Safety | Use when |
|-------|-------|--------|----------|
| `processed` | about 400ms | May be dropped | Never for sends. Not supported by `sendAndConfirmTransaction` |
| `confirmed` | about 5s | Supermajority voted | Default for interactive UX |
| `finalized` | about 30s | Rooted and irreversible | Financial operations and large transfers |

`sendTransaction` defaults `preflightCommitment` to `finalized`, so simulation runs against finalized state. If your accounts were just created with `confirmed`, simulation can fail because the finalized state does not see them yet. Pass `preflightCommitment: Commitment.confirmed` to fix this.

## References

- solana Dart SDK: https://pub.dev/packages/solana
- coral_xyz (Anchor client for Dart): https://pub.dev/packages/coral_xyz
- Solana transaction docs: https://solana.com/docs/core/transactions
- Compute budget and priority fees: https://solana.com/developers/guides/advanced/how-to-use-priority-fees
- Related skills in this set: solana-dart-sdk, solana-mobile-wallet-adapter-flutter, flutter-solana-wallet-security

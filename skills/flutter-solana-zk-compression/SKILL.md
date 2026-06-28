---
name: flutter-solana-zk-compression
description: Build Flutter apps that compress, transfer, and decompress SOL and SPL tokens on Solana using the light_sdk Dart package and Light Protocol ZK compression. Use for compressed accounts and compressed tokens, the Light System Program and Compressed Token Program, fetching Groth16 validity proofs from the Photon indexer over Helius RPC, compressed address derivation, Borsh instruction encoding, and external wallet signing with progress tracking on mobile. Helius RPC required.
license: MIT
metadata:
  author: Dominion Nwakanma (web3flutter.dev)
  version: "1.0.0"
tags:
  - solana
  - zk-compression
  - light-protocol
  - light-sdk
  - compressed-tokens
  - flutter
  - dart
  - helius
  - photon
  - groth16
---

# Flutter Solana ZK Compression with light_sdk

## Overview

Solana charges rent for every account stored on-chain. A single SPL token account costs about 0.002 SOL (roughly 2,039,280 lamports) in rent-exemption deposit. Airdropping to 100,000 wallets means around 200 SOL just in rent. For a consumer mobile app, that cost model is fatal.

Light Protocol's ZK compression fixes this. Instead of storing each account's full data on-chain, you hash the data and store only the hash as a leaf in a Merkle tree. The actual data lives in the Solana ledger's transaction calldata and in an off-chain indexer. To modify a compressed account you supply the current data plus a zero-knowledge proof that it hashes to a leaf in the tree. The on-chain program verifies the proof, nullifies the old leaf, and appends a new one. Storing a compressed account costs about 100 lamports instead of about 2,000,000. That is the roughly 1000x reduction Light Protocol talks about.

`light_sdk` is the Dart client for this system. It is the Dart port of Light Protocol's `@lightprotocol/stateless.js` TypeScript SDK. From your Flutter app you call `compress()` to move SOL or tokens into the compressed world, `transfer()` to send them, and `decompress()` to pull them back. Underneath, the SDK queries the Photon indexer, fetches Groth16 proofs from the prover, builds Light System Program and Compressed Token Program instructions, packs accounts, and Borsh-encodes instruction data.

The package targets the `solana` Dart package's types. If you already use `Ed25519HDPublicKey`, `RpcClient`, and `Instruction` from `package:solana`, `light_sdk` plugs in without a parallel type system.

Honest status. The package is pre-release beta (v0.1.0-beta.1), so pin it and expect minor API drift. ZK compression RPC is Helius-specific: the Photon indexer and prover are bundled behind the Helius endpoint, so a non-Helius RPC will fail compression calls. Validity proofs reference recent Merkle roots that expire after about 100 slots (roughly 40 seconds), so minimize the time between fetching a proof and submitting the transaction. The indexer lags 1 to 3 seconds behind chain, so do not query state immediately after a transaction.

## Instructions

1. Add `light_sdk: ^0.1.0-beta.1` and `solana: ^0.31.2` to pubspec.yaml. The SDK also pulls in `equatable` and `pointycastle` for Keccak256 hashing.
2. Create one `Rpc` against a Helius endpoint with `Rpc.create('https://devnet.helius-rpc.com?api-key=YOUR_KEY')`. The same object serves standard Solana RPC (via `rpc.rpcClient`) and the Photon compression API.
3. To compress SOL or tokens, fetch the active state tree with `rpc.getStateTreeInfos()` then `selectStateTreeInfo()`. Compression creates a new leaf and needs no validity proof.
4. To transfer or decompress, fetch the owner's accounts with `getCompressedAccountsByOwner()` (or `getCompressedTokenAccountsByOwner()` for tokens), select inputs with `selectMinCompressedSolAccountsForTransfer()` or `selectMinCompressedTokenAccountsForTransfer()`, then call `rpc.getValidityProof()` with those hashes.
5. Build the instruction with `LightSystemProgram` (SOL) or `CompressedTokenProgram` (tokens). Pass `proof.rootIndices` and `proof.compressedProof` for transfer and decompress.
6. Add a compute unit limit: 1,000,000 for compress and decompress, 350,000 for SOL transfer, 600,000 for token transfer. Then fetch a recent blockhash, sign, send, and confirm.
7. In production, do not use the convenience action functions (`compress`, `transfer`, `decompress`) because they require a local `Ed25519HDKeyPair`. Build the instruction with the program builders and sign with your external wallet (Privy, Phantom, Saga Seed Vault) instead.
8. Emit progress between steps (preparing, proving, signing, sending, confirming) so the user sees movement during the 2 to 5 second proving step.
9. After a transaction, refresh state with a retry loop using escalating delays (2s, 3s, 4s) because the indexer needs 1 to 3 seconds to catch up.
10. When decompressing tokens, send to an SPL Associated Token Account (ATA), never a wallet address. Derive the ATA and create it in the same transaction if it does not exist.

## Examples

### Compress, transfer, and decompress SOL (local keypair)

The convenience action functions are the fastest way to learn the flow. They take a local `Ed25519HDKeyPair` and run the full query, prove, build, sign, send, confirm pipeline.

```dart
import 'package:light_sdk/light_sdk.dart';
import 'package:solana/solana.dart';

Future<void> solRoundTrip() async {
  final rpc = Rpc.create('https://devnet.helius-rpc.com?api-key=YOUR_KEY');
  final wallet = await Ed25519HDKeyPair.random();
  final recipient = Ed25519HDPublicKey.fromBase58(
    'BPFLoaderUpgradeab1e11111111111111111111111',
  );

  // Compress 1 SOL. No validity proof: a new leaf is created, nothing consumed.
  await compress(
    rpc: rpc,
    payer: wallet,
    lamports: BigInt.from(1000000000),
    toAddress: wallet.publicKey,
  );

  // Wait for the indexer before reading new compressed state.
  await Future<void>.delayed(const Duration(seconds: 3));
  final balance = await rpc.getCompressedBalanceByOwner(wallet.publicKey);
  print('Compressed balance: $balance lamports');

  // Transfer 0.1 SOL compressed. Consumes leaves, so a proof is fetched.
  await transfer(
    rpc: rpc,
    payer: wallet,
    owner: wallet,
    lamports: BigInt.from(100000000),
    toAddress: recipient,
  );

  // Decompress 0.5 SOL back to a regular wallet address.
  await decompress(
    rpc: rpc,
    payer: wallet,
    owner: wallet,
    lamports: BigInt.from(500000000),
    recipient: wallet.publicKey,
  );
}
```

### What transfer() does internally (mid-level pipeline)

The action functions are recipes, not black boxes. This is the full body of `transfer()` so you can reproduce it with a custom signer, custom compute budget, or progress callbacks.

```dart
import 'package:light_sdk/light_sdk.dart';
import 'package:solana/solana.dart';

Future<String> transferManual({
  required Rpc rpc,
  required Ed25519HDKeyPair payer,
  required Ed25519HDKeyPair owner,
  required BigInt lamports,
  required Ed25519HDPublicKey toAddress,
}) async {
  // 1. Fetch the owner's compressed accounts, paginated.
  var accumulated = BigInt.zero;
  final compressedAccounts = <CompressedAccount>[];
  String? cursor;
  while (accumulated < lamports) {
    final batch = await rpc.getCompressedAccountsByOwner(
      owner.publicKey,
      cursor: cursor,
      limit: 1000,
    );
    for (final account in batch.items) {
      if (account.lamports > BigInt.zero) {
        compressedAccounts.add(account);
        accumulated += account.lamports;
      }
    }
    cursor = batch.cursor;
    if (batch.items.length < 1000) break;
  }

  // 2. Select the minimum set of inputs that covers the amount.
  final (inputAccounts, _) =
      selectMinCompressedSolAccountsForTransfer(compressedAccounts, lamports);

  // 3. Fetch the validity proof for those inputs. Submit soon: roots expire.
  final proof = await rpc.getValidityProof(
    hashes: inputAccounts.map((a) => a.hash).toList(),
  );

  // 4. Build the Light System Program transfer instruction.
  final instruction = LightSystemProgram.transfer(
    payer: payer.publicKey,
    inputCompressedAccounts: inputAccounts,
    toAddress: toAddress,
    lamports: lamports,
    recentInputStateRootIndices: proof.rootIndices,
    recentValidityProof: proof.compressedProof,
  );

  // 5. Build with compute budget, sign, send, confirm.
  final signedTx = await buildAndSignTransaction(
    rpc: rpc,
    signer: payer,
    instructions: [instruction],
    computeUnitLimit: 350000,
    additionalSigners: owner.publicKey == payer.publicKey ? const [] : [owner],
  );
  return sendAndConfirmTransaction(rpc: rpc, signedTx: signedTx);
}
```

### Production: compress SPL tokens with an external wallet and progress

In a real Flutter app the signer is an external wallet that signs asynchronously, so the action functions do not apply. Build the instruction with the program builder, sign with your wallet, and emit progress between steps.

```dart
import 'dart:convert';
import 'dart:typed_data';
import 'package:light_sdk/light_sdk.dart';
import 'package:solana/solana.dart';

enum CompressStep { preparing, proving, signing, sending, confirming }

class LightProtocolService {
  LightProtocolService({
    required String heliusApiKey,
    required this.walletPubkey,
    required this.signMessage,
  }) : _rpc = Rpc.create('https://mainnet.helius-rpc.com?api-key=$heliusApiKey');

  final Rpc _rpc;
  final Ed25519HDPublicKey walletPubkey;

  // External wallet sign callback. For Privy: base64 encode, call the embedded
  // wallet provider, base64 decode the returned signature.
  final Future<Uint8List> Function(Uint8List message) signMessage;

  Future<String> compressToken({
    required String mint,
    required BigInt amount,
    required String sourceTokenAccount,
    void Function(CompressStep step)? onProgress,
  }) async {
    onProgress?.call(CompressStep.preparing);

    final mintPubkey = Ed25519HDPublicKey.fromBase58(mint);
    final treeInfos = await _rpc.getStateTreeInfos();
    final treeInfo = selectStateTreeInfo(treeInfos);
    final tokenPoolInfo = await _getTokenPoolInfo(mintPubkey);

    // Compress creates a new leaf, so no validity proof is required here.
    final ix = CompressedTokenProgram.compress(
      payer: walletPubkey,
      owner: walletPubkey,
      source: Ed25519HDPublicKey.fromBase58(sourceTokenAccount),
      mint: mintPubkey,
      amount: amount,
      outputStateTreeInfo: treeInfo,
      tokenPoolInfo: tokenPoolInfo,
    );

    onProgress?.call(CompressStep.signing);
    final signedTx = await _buildAndSignWithExternalWallet(
      [ix],
      computeUnits: 1000000,
    );

    onProgress?.call(CompressStep.sending);
    final signature = await _rpc.rpcClient.sendTransaction(signedTx);

    onProgress?.call(CompressStep.confirming);
    await _rpc.rpcClient.confirmTransaction(signature);
    return signature;
  }

  Future<TokenPoolInfo> _getTokenPoolInfo(Ed25519HDPublicKey mint) async {
    final poolPda = await CompressedTokenProgram.deriveTokenPoolPda(mint: mint);
    final info = await _rpc.rpcClient.getAccountInfo(poolPda);
    if (info == null) {
      throw StateError('No token pool for $mint. Call createSplInterface first.');
    }
    return TokenPoolInfo(mint: mint, poolPda: poolPda);
  }

  // Assemble a transaction, hand the message bytes to the external wallet,
  // attach the signature, and return the encoded transaction string.
  Future<String> _buildAndSignWithExternalWallet(
    List<Instruction> instructions, {
    required int computeUnits,
  }) async {
    final bh = await _rpc.rpcClient.getLatestBlockhash();
    final message = Message(
      instructions: [
        ComputeBudgetInstruction.setComputeUnitLimit(units: computeUnits),
        ...instructions,
      ],
    );
    final compiled = message.compile(
      recentBlockhash: bh.value.blockhash,
      feePayer: walletPubkey,
    );

    final signature = await signMessage(Uint8List.fromList(compiled.toByteArray()));
    final tx = SignedTx(
      signatures: [Signature(signature, publicKey: walletPubkey)],
      compiledMessage: compiled,
    );
    return base64Encode(tx.toByteArray());
  }
}
```

### Production: transfer compressed tokens with full progress tracking

A compressed token transfer has five phases. The proving step alone can take 2 to 5 seconds, so the UI must show progress or it feels broken.

```dart
import 'dart:typed_data';
import 'package:light_sdk/light_sdk.dart';
import 'package:solana/solana.dart';

extension CompressedTokenTransfer on LightProtocolService {
  Future<String> transferCompressedToken({
    required String mint,
    required BigInt amount,
    required String recipientAddress,
    void Function(CompressStep step)? onProgress,
  }) async {
    onProgress?.call(CompressStep.preparing);

    final tokenAccounts = await rpc.getCompressedTokenAccountsByOwner(
      walletPubkey,
      mint: Ed25519HDPublicKey.fromBase58(mint),
    );
    final (selected, _) = selectMinCompressedTokenAccountsForTransfer(
      tokenAccounts.items,
      amount,
      (a) => a.parsed.amount,
    );

    onProgress?.call(CompressStep.proving);
    final hashes = selected.map((a) => a.compressedAccount.hash).toList();
    final proof = await rpc.getValidityProof(hashes: hashes);

    onProgress?.call(CompressStep.signing);
    final ix = CompressedTokenProgram.transfer(
      payer: walletPubkey,
      inputCompressedTokenAccounts: selected,
      toAddress: Ed25519HDPublicKey.fromBase58(recipientAddress),
      amount: amount,
      recentInputStateRootIndices: proof.rootIndices,
      recentValidityProof: proof.compressedProof,
    );
    final signedTx =
        await buildAndSignWithExternalWallet([ix], computeUnits: 600000);

    onProgress?.call(CompressStep.sending);
    final signature = await rpc.rpcClient.sendTransaction(signedTx);

    onProgress?.call(CompressStep.confirming);
    await rpc.rpcClient.confirmTransaction(signature);
    return signature;
  }
}
```

The extension above assumes `rpc`, `walletPubkey`, and `buildAndSignWithExternalWallet` are exposed on the service. In the earlier example they are private; expose them or fold this method into the class body.

### Production: decompress tokens to an ATA, creating it if missing

Decompressing tokens requires an SPL ATA on the receiving end. If the ATA does not exist, the transaction fails. Create the ATA and decompress in one transaction so the user signs once.

```dart
import 'package:light_sdk/light_sdk.dart';
import 'package:solana/solana.dart';

Future<String> decompressTokenToAta({
  required Rpc rpc,
  required Ed25519HDPublicKey walletPubkey,
  required String mint,
  required BigInt amount,
  required Future<String> Function(List<Instruction>, int computeUnits) signAndSend,
}) async {
  final mintPubkey = Ed25519HDPublicKey.fromBase58(mint);

  // Derive the ATA and check whether it already exists.
  final ata = await findAssociatedTokenAddress(
    owner: walletPubkey,
    mint: mintPubkey,
  );
  final ataInfo = await rpc.rpcClient.getAccountInfo(ata.toBase58());

  final instructions = <Instruction>[];
  if (ataInfo == null) {
    instructions.add(
      AssociatedTokenAccountInstruction.createAccount(
        funder: walletPubkey,
        address: ata,
        owner: walletPubkey,
        mint: mintPubkey,
      ),
    );
  }

  // Select inputs and fetch the proof.
  final tokenAccounts = await rpc.getCompressedTokenAccountsByOwner(
    walletPubkey,
    mint: mintPubkey,
  );
  final (selected, _) = selectMinCompressedTokenAccountsForTransfer(
    tokenAccounts.items,
    amount,
    (a) => a.parsed.amount,
  );
  final proof = await rpc.getValidityProof(
    hashes: selected.map((a) => a.compressedAccount.hash).toList(),
  );

  final poolPda = await CompressedTokenProgram.deriveTokenPoolPda(mint: mintPubkey);
  instructions.add(
    CompressedTokenProgram.decompress(
      payer: walletPubkey,
      inputCompressedTokenAccounts: selected,
      toAddress: ata, // ATA, never a wallet address
      amount: amount,
      recentInputStateRootIndices: proof.rootIndices,
      recentValidityProof: proof.compressedProof,
      tokenPoolInfo: TokenPoolInfo(mint: mintPubkey, poolPda: poolPda),
    ),
  );

  return signAndSend(instructions, 1000000);
}
```

### Create a token pool before compressing a new mint

For major mainnet tokens (USDC and popular mints) the pool already exists. For a new or custom token, someone must create the SPL interface once before any compression works.

```dart
import 'package:light_sdk/light_sdk.dart';
import 'package:solana/solana.dart';

Future<Instruction> buildCreateTokenPool({
  required Ed25519HDPublicKey feePayer,
  required Ed25519HDPublicKey mint,
}) {
  return CompressedTokenProgram.createSplInterface(
    feePayer: feePayer,
    mint: mint,
    tokenProgramId: Ed25519HDPublicKey.fromBase58(
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    ),
  );
}
```

### Derive a compressed address (V1 and V2)

Most compressed accounts (SOL balances, fungible token balances) have no address: you scan them by owner. Accounts that need a stable identifier (user profile, game state, program config) use an address tree. Derivation uses Keccak256 truncated to the BN254 field, not Solana's SHA256 PDA scheme, so these addresses will not match Anchor PDAs.

```dart
import 'dart:typed_data';
import 'package:light_sdk/light_sdk.dart';
import 'package:solana/solana.dart';

Future<void> deriveAddresses(Rpc rpc, Ed25519HDPublicKey programId) async {
  final addressTree = await rpc.getAddressTreeInfoV2();
  final userPubkey = Ed25519HDPublicKey.fromBase58(
    '11111111111111111111111111111111',
  );

  // V1: Keccak256(programId + seeds), then Keccak256(tree + seed) with bump.
  final seedV1 = deriveAddressSeed(
    seeds: [
      Uint8List.fromList('user_profile'.codeUnits),
      Uint8List.fromList(userPubkey.bytes),
    ],
    programId: programId,
  );
  final addressV1 = deriveAddress(
    seed: seedV1,
    addressMerkleTreePubkey: addressTree.tree,
  );

  // V2: Keccak256(seeds + [255]), then Keccak256(seed + tree + programId + [255]).
  final seedV2 = deriveAddressSeedV2([
    Uint8List.fromList('user_profile'.codeUnits),
    Uint8List.fromList(userPubkey.bytes),
  ]);
  final addressV2 = deriveAddressV2(
    addressSeed: seedV2,
    addressMerkleTreePubkey: addressTree.tree,
    programId: programId,
  );

  print('V1 address: ${addressV1.toBase58()}');
  print('V2 address: ${addressV2.toBase58()}');
}
```

### Post-transaction refresh that handles indexer lag

After a transaction the indexer needs 1 to 3 seconds. Retry with escalating delays instead of hammering it.

```dart
import 'package:light_sdk/light_sdk.dart';
import 'package:solana/solana.dart';

Future<List<CompressedTokenAccount>> refreshAfterTransaction({
  required Rpc rpc,
  required Ed25519HDPublicKey owner,
  required int previousCount,
  int retries = 3,
}) async {
  for (var i = 0; i < retries; i++) {
    await Future<void>.delayed(Duration(seconds: 2 + i)); // 2s, 3s, 4s
    final accounts = await rpc.getCompressedTokenAccountsByOwner(owner);
    if (accounts.items.length != previousCount) {
      return accounts.items;
    }
  }
  // All retries exhausted: return last known state, show a refreshing hint.
  final fallback = await rpc.getCompressedTokenAccountsByOwner(owner);
  return fallback.items;
}
```

### Decimal handling for token amounts

SPL tokens have variable decimals (USDC is 6, SOL is 9, some are 0). Keep all on-chain math in `BigInt`. Convert to `double` only for display.

```dart
import 'dart:math';

BigInt uiToOnChain(double uiAmount, int decimals) {
  return BigInt.from((uiAmount * pow(10, decimals)).round());
}

double onChainToUi(BigInt onChainAmount, int decimals) {
  return onChainAmount.toDouble() / pow(10, decimals);
}

void main() {
  final onChain = uiToOnChain(100.5, 6); // BigInt 100500000
  final ui = onChainToUi(onChain, 6);     // 100.5
  print('$onChain then $ui');
}
```

## Guidelines

- DO use a Helius RPC endpoint with an API key. The Photon indexer and prover are Helius-specific extensions, so any other provider fails compression calls.
- DO fetch the validity proof last and submit immediately. Roots expire after about 100 slots (roughly 40 seconds). Prepare everything else first, then call `getValidityProof()` and send back to back.
- DO set a compute unit limit on every compressed transaction: 1,000,000 for compress and decompress, 350,000 for SOL transfer, 600,000 for token transfer, 400,000 for creating a token pool.
- DO build instructions with `LightSystemProgram` or `CompressedTokenProgram` and sign with your external wallet in production. The action functions require a local `Ed25519HDKeyPair` and cannot use Privy, Phantom, or Seed Vault.
- DO refresh state with escalating retry delays (2s, 3s, 4s) after a transaction. The indexer is 1 to 3 seconds behind chain.
- DO use `BigInt` for all amounts and decimals. Floating point precision loss makes the amount mismatch what the compressed account holds, which fails the transaction.
- DO let `packCompressedAccounts()` decide V1 versus V2 tree routing. V1 output accounts reference the tree pubkey, V2 reference the queue pubkey. The SDK checks `treeInfo.treeType`.
- DO derive the SPL ATA and create it in the same transaction when decompressing tokens. Use `findAssociatedTokenAddress()` and check `getAccountInfo()` first.
- DON'T query compressed state right after a transaction. You will get stale data because the indexer has not processed the event yet.
- DON'T send compressed tokens with a regular SPL transfer. Use `CompressedTokenProgram.transfer()`, which consumes compressed token accounts and produces new ones (UTXO model with automatic change accounts).
- DON'T decompress tokens to a wallet address. The `toAddress` must be an SPL token account, or the tokens can be lost.
- DON'T hardcode state tree addresses. Trees roll over when full and the address changes. Use `getStateTreeInfos()` and `selectStateTreeInfo()`.
- DON'T send parallel transfers to multiple recipients. They race on account selection and cause proof failures. Send sequentially: each transfer changes account state.
- DON'T import internal `light_sdk/src` paths. Import `package:light_sdk/light_sdk.dart` only.
- DON'T retry a failed proof immediately. The underlying state is likely unchanged. Re-fetch accounts, get a new proof, then retry.

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| Compression RPC method not found | Endpoint is not Helius, so it has no Photon API | Use a Helius RPC endpoint with an API key |
| Invalid proof or root not found | Root expired (over 40 seconds) or another tx changed the tree between fetch and submit | Re-fetch accounts, get a fresh proof, submit immediately |
| Balance is stale right after compress | Indexer is 1 to 3 seconds behind chain | Retry with escalating delays (2s, 3s, 4s) before reading |
| Compute budget exceeded | Compute unit limit too low for the operation | 1,000,000 for compress and decompress, 350,000 SOL transfer, 600,000 token transfer |
| InsufficientBalanceException on transfer | Selected accounts total less than the requested amount | Check `getCompressedBalanceByOwner()` first, then transfer no more than that |
| Token decompress fails or tokens lost | `toAddress` was a wallet address, not an SPL ATA | Derive the ATA, create it if missing, pass the ATA as `toAddress` |
| Token compress fails with no pool | The mint has no token pool yet | Call `CompressedTokenProgram.createSplInterface()` once for that mint |
| Queue full on devnet | No forester is emptying the nullifier queue for that tree | Use mainnet where Helius runs foresters, or wait for the forester |
| Action function rejects external signer | `compress`, `transfer`, `decompress` require `Ed25519HDKeyPair` | Build with the program builders and sign with your wallet provider |
| Derived address does not match an Anchor PDA | Compressed addresses use Keccak256 + BN254 truncation, not SHA256 | Expect different values, do not derive compressed addresses to match PDAs |

## References

- light_sdk on pub.dev: https://pub.dev/packages/light_sdk
- Light Protocol ZK Compression docs: https://www.zkcompression.com/
- Helius compression and DAS API: https://docs.helius.dev/compression-and-das-api/digital-asset-standard-das-api
- TypeScript reference SDK (@lightprotocol/stateless.js): https://github.com/Lightprotocol/light-protocol
- solana Dart SDK: https://pub.dev/packages/solana
- Related skills in this set: solana-mobile-wallet-adapter-flutter, solana-dart-sdk, building-solana-transactions-flutter, flutter-solana-wallet-security

---
name: solana-mobile-wallet-adapter-flutter
description: Connect Flutter Android dApps to Solana wallets with the Mobile Wallet Adapter (MWA) protocol using solana_mobile_client and the solana Dart SDK. Use for MWA sessions, authorize and reauthorize, signing and sending transactions, off-chain message signing, and persisting auth tokens on Solana Mobile. Android only.
license: MIT
metadata:
  author: Dominion Nwakanma (web3flutter.dev)
  version: "1.0.0"
tags:
  - solana
  - mobile-wallet-adapter
  - mwa
  - flutter
  - dart
  - android
  - wallet-adapter
  - transaction-signing
  - solana-mobile
---

# Solana Mobile Wallet Adapter for Flutter dApps

## Overview

The Mobile Wallet Adapter (MWA) protocol is how a Flutter Android dApp gets a wallet app (Phantom, Solflare, Espresso Cash) to authorize the user and sign transactions. The `solana_mobile_client` package implements the dApp side. It opens a local session to the wallet, requests authorization, and submits payloads for signing or sign-and-send.

Two classes do the work. `LocalAssociationScenario` manages the session (create, start, close). `MobileWalletAdapterClient` runs the RPC methods (authorize, sign, send).

This is Android only. Apple blocks the inter-app patterns MWA relies on. For iOS use an embedded wallet or a deep-link flow. The package is at v0.1.1 (Espresso Cash), so pin it and expect minor API drift.

## Instructions

1. Add `solana_mobile_client: ^0.1.1` and `solana: ^0.31.0` to pubspec.yaml.
2. Gate every MWA call behind `Platform.isAndroid`, then `LocalAssociationScenario.isAvailable()`.
3. Create the session with `LocalAssociationScenario.create()`.
4. Launch the wallet chooser fire-and-forget with `session.startActivityForResult(null).ignore()`.
5. Await the client with `session.start()`.
6. Inside a try block, call `reauthorize()` if a saved authToken exists for the same cluster, otherwise call `authorize()`. A null result means the user declined.
7. To sign and submit, build a `SignedTx` with a 64-zero placeholder signature for the wallet pubkey, serialize with `toByteArray()`, then call `signAndSendTransactions`. To sign only, call `signTransactions` and submit the returned payloads yourself.
8. Always call `session.close()` in a finally block.
9. Persist authToken, publicKey, and cluster in flutter_secure_storage so you can reauthorize next time.

## Examples

### Connect, reauthorize, and persist

From a production app. Reauthorize if the saved cluster matches, otherwise do a fresh authorize, then persist.

```dart
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:solana/solana.dart';
import 'package:solana/base58.dart';
import 'package:solana_mobile_client/solana_mobile_client.dart';

class MobileWalletService {
  MobileWalletService(this._storage);
  final FlutterSecureStorage _storage;

  Future<AuthorizationResult?> connectWallet(String rpcUrl) async {
    final session = await LocalAssociationScenario.create();
    session.startActivityForResult(null).ignore();
    final client = await session.start();

    try {
      final cluster = _clusterFromUrl(rpcUrl);
      final savedToken = await _storage.read(key: 'mwa_auth_token');
      final savedCluster = await _storage.read(key: 'mwa_cluster');

      if (savedToken != null && savedCluster == cluster) {
        final reauth = await client.reauthorize(
          identityUri: Uri.parse('https://myapp.com'),
          identityName: 'My App',
          authToken: savedToken,
        );
        if (reauth != null) {
          await _persistAuth(reauth, cluster);
          return reauth;
        }
      }

      final auth = await client.authorize(
        identityUri: Uri.parse('https://myapp.com'),
        identityName: 'My App',
        cluster: cluster,
      );
      if (auth != null) {
        await _persistAuth(auth, cluster);
      }
      return auth;
    } finally {
      await session.close();
    }
  }

  Future<void> _persistAuth(AuthorizationResult auth, String cluster) async {
    await _storage.write(key: 'mwa_auth_token', value: auth.authToken);
    await _storage.write(
      key: 'mwa_public_key',
      value: Ed25519HDPublicKey(auth.publicKey).toBase58(),
    );
    await _storage.write(key: 'mwa_cluster', value: cluster);
  }

  String _clusterFromUrl(String url) {
    if (url.contains('devnet')) return 'devnet';
    if (url.contains('testnet')) return 'testnet';
    return 'mainnet-beta';
  }
}
```

### Sign and send with local co-signers

When the transaction has extra signers (for example a new account keypair). The wallet pubkey is the fee payer and gets a placeholder signature.

```dart
Future<String> signAndSendWithLocalSigners({
  required MobileWalletAdapterClient client,
  required Uint8List walletPubkey,
  required RpcClient rpc,
  required Message message,
  required List<Ed25519HDKeyPair> localSigners,
}) async {
  final bh = await rpc.getLatestBlockhash();
  final feePayer = Ed25519HDPublicKey(walletPubkey);
  final compiled = message.compile(
    recentBlockhash: bh.value.blockhash,
    feePayer: feePayer,
  );

  final compiledBytes = compiled.toByteArray();
  final signatures = <Signature>[
    Signature(List.filled(64, 0), publicKey: feePayer), // placeholder for wallet
  ];
  for (final signer in localSigners) {
    signatures.add(await signer.sign(compiledBytes));
  }

  final tx = SignedTx(signatures: signatures, compiledMessage: compiled);
  final txBytes = Uint8List.fromList(tx.toByteArray());

  final result = await client.signAndSendTransactions(transactions: [txBytes]);
  return base58encode(result.signatures.first);
}
```

### Off-chain message signing (sign in)

```dart
final result = await client.signMessages(
  messages: [Uint8List.fromList(utf8.encode('Sign in to My dApp'))],
  addresses: [auth.publicKey],
);
for (final signed in result.signedMessages) {
  // signed.signatures is List<Uint8List>
}
```

### Platform-aware entry point

```dart
import 'dart:io';

Future<AuthorizationResult?> connect(MobileWalletService mwa, String rpcUrl) async {
  if (Platform.isAndroid && await LocalAssociationScenario.isAvailable()) {
    return mwa.connectWallet(rpcUrl);
  }
  // iOS or no MWA wallet installed: use an embedded wallet or deep-link flow instead.
  return null;
}
```

## Guidelines

- DO close the session in a finally block. A leaked session leaves the wallet stuck until the user force-quits it.
- DO use the wallet's `auth.publicKey` as the fee payer, never a local keypair.
- DO clear the saved authToken when the cluster changes. Reauthorize fails across clusters.
- DO null-check every authorize and reauthorize result. The user can decline at any time.
- DON'T pass raw unsigned transaction bytes. Wallets expect a `SignedTx` with placeholder signatures, serialized with `toByteArray()`.
- DON'T mix up the signing methods. `signTransactions` signs only and you submit. `signAndSendTransactions` signs and submits.
- DON'T call MWA on iOS. Gate with `Platform.isAndroid` first.

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| Wallet stuck, user must force-quit | Session not closed on the error path | Call `session.close()` in a finally block |
| Reauthorize returns null | authToken is from a different cluster | Clear the stored token and call `authorize()` fresh |
| Transaction signature verification failure | Passed raw tx bytes instead of a `SignedTx` | Build `SignedTx` with a 64-zero placeholder, then `toByteArray()` |
| Transaction lands before the blockhash slot | `minContextSlot` not passed | Pass the slot from `getLatestBlockhash()` context |
| App crashes after a connect attempt | Null authorize result was ignored | Always null-check auth results, the user can decline |
| Wrong fee payer | Local keypair used as fee payer | Fee payer must be `auth.publicKey` from the wallet |

## References

- solana_mobile_client (Espresso Cash): https://github.com/espresso-cash/espresso-cash-public/tree/master/packages/solana_mobile_client
- Solana Mobile and MWA docs: https://docs.solanamobile.com
- solana Dart SDK: https://pub.dev/packages/solana
- Related skills in this set: solana-dart-sdk, building-solana-transactions-flutter, flutter-solana-wallet-security, flutter-solana-seed-vault

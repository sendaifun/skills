---
name: flutter-solana-wallet-security
description: Harden Solana wallets and dApps built in Flutter and Dart. Encrypt seed phrases and private keys at rest, gate sensitive actions with biometrics, hash PINs with salted Argon2id, manage secrets with dotenv and dart-define, validate RPC endpoints, and simulate transactions before sending. Use for secure key storage, app lock, logout wipes, and pre-ship security review on mobile.
license: MIT
metadata:
  author: Dominion Nwakanma (web3flutter.dev)
  version: "1.0.0"
tags:
  - solana
  - flutter
  - dart
  - security
  - wallet
  - secure-storage
  - encryption
  - biometrics
  - mobile
---

# Flutter Solana Wallet Security

## Overview

Web3 mobile apps hold assets with real value. One plaintext private key leak means total, irreversible loss. Every layer has to be hardened: storage, encryption, secrets, biometric gating, network transport, and the signing flow.

This skill covers the patterns that matter on mobile, with code that uses a cryptographically secure RNG, a fresh IV per encryption, and a salted Argon2id KDF for PINs. The patterns are drawn from production Solana Flutter apps.

Packages used:

| Package | Purpose |
|---------|---------|
| flutter_secure_storage | Keychain on iOS, EncryptedSharedPreferences on Android |
| encrypt | AES-256-CBC |
| crypto | SHA-256 for key derivation |
| cryptography | Argon2id for PIN hashing |
| local_auth | Face ID and fingerprint |
| flutter_dotenv | Loading environment secrets |
| bip39, ed25519_hd_key | Mnemonic and Solana keypair derivation |

```yaml
dependencies:
  flutter_secure_storage: ^9.2.2
  encrypt: ^5.0.3
  crypto: ^3.0.3
  cryptography: ^2.7.0
  local_auth: ^2.3.0
  flutter_dotenv: ^6.0.0
  bip39: ^1.0.6
  ed25519_hd_key: ^2.3.0
```

## Instructions

1. Store every secret in flutter_secure_storage. Turn on `encryptedSharedPreferences: true` on Android and set a Keychain accessibility level on iOS.
2. Add a second AES-256-CBC layer on top of secure storage for the most sensitive values (seed phrase, private key). Derive the key from a 32 byte value generated with `Random.secure()`, never from a timestamp.
3. Use a fresh random IV for every encryption and store the IV with the ciphertext. Never reuse a fixed IV.
4. Hash PINs with salted Argon2id, store the salt with the hash, and compare in constant time. Never store a bare SHA-256 of a PIN.
5. Keep secrets out of source control. Load them with flutter_dotenv from a gitignored `.env`, or pass them with `--dart-define` for CI builds.
6. Put a biometric gate in front of any action that reveals or uses key material (export mnemonic, sign a high value transaction). Decrypt the key only after the gate passes.
7. Reject non HTTPS RPC endpoints and check unknown hosts against a user approved list.
8. Simulate every transaction before sending so a bad transaction fails for free.
9. Never log keys or mnemonics. On logout, wipe all secure storage.

## Examples

### Secure storage service with a real CSPRNG and a per-encryption IV

```dart
import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';
import 'package:crypto/crypto.dart';
import 'package:encrypt/encrypt.dart' as encrypt;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class SecureStorageService {
  SecureStorageService({required this.namespace})
      : _storage = const FlutterSecureStorage(
          aOptions: AndroidOptions(encryptedSharedPreferences: true),
          iOptions: IOSOptions(
            accessibility: KeychainAccessibility.first_unlock,
          ),
        );

  final FlutterSecureStorage _storage;
  final String namespace;

  Future<void> saveValue(String key, String value) =>
      _storage.write(key: '${namespace}_$key', value: value);

  Future<String?> getValue(String key) =>
      _storage.read(key: '${namespace}_$key');

  Future<void> saveEncrypted(String key, String value) async {
    final derivedKey = await _getDeviceSpecificKey();
    await saveValue(key, _encryptAES(value, derivedKey));
  }

  Future<String?> getEncrypted(String key) async {
    final stored = await getValue(key);
    if (stored == null) return null;
    final derivedKey = await _getDeviceSpecificKey();
    try {
      return _decryptAES(stored, derivedKey);
    } catch (_) {
      return null; // tampered, malformed, or wrong key
    }
  }

  // 32 bytes from a cryptographically secure RNG, generated once per namespace.
  Future<String> _getDeviceSpecificKey() async {
    var deviceId = await getValue('device_id');
    if (deviceId == null) {
      final rnd = Random.secure();
      final bytes = List<int>.generate(32, (_) => rnd.nextInt(256));
      deviceId = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
      await saveValue('device_id', deviceId);
    }
    return sha256.convert(utf8.encode(deviceId + namespace)).toString();
  }

  // Returns "ivBase64:cipherBase64". A new IV is created for every call.
  static String _encryptAES(String plainText, String key) {
    final keyBytes = sha256.convert(utf8.encode(key)).bytes;
    final iv = encrypt.IV.fromSecureRandom(16);
    final encrypter = encrypt.Encrypter(
      encrypt.AES(encrypt.Key(Uint8List.fromList(keyBytes)),
          mode: encrypt.AESMode.cbc),
    );
    final ct = encrypter.encrypt(plainText, iv: iv);
    return '${iv.base64}:${ct.base64}';
  }

  static String _decryptAES(String stored, String key) {
    final parts = stored.split(':');
    if (parts.length != 2) throw const FormatException('Malformed ciphertext');
    final iv = encrypt.IV.fromBase64(parts[0]);
    final keyBytes = sha256.convert(utf8.encode(key)).bytes;
    final encrypter = encrypt.Encrypter(
      encrypt.AES(encrypt.Key(Uint8List.fromList(keyBytes)),
          mode: encrypt.AESMode.cbc),
    );
    return encrypter.decrypt64(parts[1], iv: iv);
  }
}
```

### Derive and store a Solana keypair, never in plaintext

```dart
import 'package:bip39/bip39.dart' as bip39;
import 'package:ed25519_hd_key/ed25519_hd_key.dart';

final mnemonic = bip39.generateMnemonic(); // 12 word BIP-39
final seed = bip39.mnemonicToSeed(mnemonic);

// Solana uses the BIP-44 path m/44'/501'/0'/0'
final derived = await ED25519_HD_KEY.derivePath("m/44'/501'/0'/0'", seed);

final storage = SecureStorageService(namespace: 'wallet');
await storage.saveEncrypted('seed_phrase', mnemonic);
await storage.saveEncrypted('private_key', base64Encode(derived.key));

// Keep the private key out of any serialization
Map<String, dynamic> toJson() => {
      'publicKey': publicKey,
      'walletId': walletId,
      // privateKey intentionally omitted
    };
```

### Salted Argon2id PIN hashing

```dart
import 'dart:convert';
import 'package:cryptography/cryptography.dart';

final _argon2 = Argon2id(
  memory: 19456, // 19 MiB
  parallelism: 1,
  iterations: 2,
  hashLength: 32,
);

// Returns "saltBase64:hashBase64"
Future<String> hashPin(String pin) async {
  final salt = SecretKeyData.random(length: 16).bytes;
  final key = await _argon2.deriveKey(
    secretKey: SecretKey(utf8.encode(pin)),
    nonce: salt,
  );
  final hash = await key.extractBytes();
  return '${base64Encode(salt)}:${base64Encode(hash)}';
}

Future<bool> verifyPin(String pin, String stored) async {
  final parts = stored.split(':');
  if (parts.length != 2) return false;
  final salt = base64Decode(parts[0]);
  final expected = base64Decode(parts[1]);
  final key = await _argon2.deriveKey(
    secretKey: SecretKey(utf8.encode(pin)),
    nonce: salt,
  );
  final actual = await key.extractBytes();
  return _constantTimeEquals(actual, expected);
}

bool _constantTimeEquals(List<int> a, List<int> b) {
  if (a.length != b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff == 0;
}
```

### Secrets from environment, never hardcoded

```dart
import 'package:flutter_dotenv/flutter_dotenv.dart';

class AppConfig {
  static String get rpcUrl =>
      dotenv.env['SOLANA_RPC_URL'] ?? 'https://api.devnet.solana.com';
}
```

```bash
# .env, add this to .gitignore
SOLANA_RPC_URL=https://your-project.helius-rpc.com/?api-key=SECRET
```

For CI or extra hardening, pass it at compile time so it is not sitting in APK assets:

```bash
flutter run --dart-define=SOLANA_RPC_URL=https://my-rpc.example.com
```

```dart
const rpcUrl = String.fromEnvironment('SOLANA_RPC_URL');
```

### Biometric gate before revealing a seed phrase

```dart
import 'package:flutter/services.dart';
import 'package:local_auth/local_auth.dart';
import 'package:local_auth/error_codes.dart' as auth_error;

final _localAuth = LocalAuthentication();

Future<bool> authenticate(String reason) async {
  try {
    if (!await _localAuth.isDeviceSupported()) return false;
    if (!await _localAuth.canCheckBiometrics) return false;
    return _localAuth.authenticate(
      localizedReason: reason,
      options: const AuthenticationOptions(stickyAuth: true, biometricOnly: true),
    );
  } on PlatformException catch (e) {
    if (e.code == auth_error.notAvailable || e.code == auth_error.notEnrolled) {
      return false;
    }
    rethrow;
  }
}

Future<List<String>?> exportSeedPhrase(
  SecureStorageService storage,
  String walletId,
) async {
  // Gate before decryption, not after
  if (!await authenticate('Authenticate to view recovery phrase')) return null;
  final mnemonic = await storage.getEncrypted('seed_$walletId');
  return mnemonic?.split(' ');
}
```

### Validate the RPC endpoint

```dart
import 'dart:io';

Future<bool> validateEndpoint(String endpoint) async {
  final uri = Uri.parse(endpoint);
  if (uri.scheme != 'https') return false; // reject plaintext transport

  const trusted = {
    'api.mainnet-beta.solana.com',
    'api.devnet.solana.com',
  };
  if (!trusted.contains(uri.host) && !await _isUserApprovedHost(uri.host)) {
    return false;
  }
  try {
    final client = HttpClient();
    final req = await client.getUrl(Uri.parse('$endpoint/health'))
        .timeout(const Duration(seconds: 10));
    final res = await req.close();
    return res.statusCode == 200;
  } on HandshakeException {
    return false; // invalid SSL certificate
  }
}
```

### Simulate before you send

```dart
import 'package:solana/solana.dart';

// base64SignedTx is a fully signed transaction. Simulate first so a bad
// transaction fails for free instead of burning fees.
Future<String?> simulateThenSend(RpcClient rpc, String base64SignedTx) async {
  final sim = await rpc.simulateTransaction(base64SignedTx);
  if (sim.value.err != null) return null; // do not send
  return rpc.sendTransaction(base64SignedTx);
}
```

### Logout wipes everything

```dart
Future<void> logout() async {
  await const FlutterSecureStorage().deleteAll();
}
```

## Guidelines

- DO generate key material with `Random.secure()`. Never derive entropy from a clock, a counter, or a device id you can guess.
- DO use a fresh IV per encryption and store it with the ciphertext.
- DO hash PINs with salted Argon2id (or scrypt or PBKDF2 with a high iteration count), store the salt, and compare in constant time.
- DO put a biometric or PIN gate before decrypting key material, and decrypt only at the moment of use.
- DO simulate transactions before sending.
- DON'T store private keys or mnemonics in SharedPreferences or in plaintext anywhere.
- DON'T put RPC URLs with API keys in source. Use a gitignored `.env` or `--dart-define`.
- DON'T include the private key in `toJson()`, logs, `print`, `debugPrint`, or crash reporters.
- DON'T reuse one encryption key or IV across wallets. Isolate per namespace.

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| Keys recoverable from a rooted device | Secrets in SharedPreferences or plaintext | Use flutter_secure_storage with encryptedSharedPreferences, plus an AES layer |
| Identical ciphertext for the same input | Fixed or zero IV reused every time | Use IV.fromSecureRandom(16) per encryption and store it with the ciphertext |
| Encryption key is guessable | Entropy from DateTime or a counter | Generate the source bytes with Random.secure() |
| PIN cracked from a leaked store | Bare unsalted SHA-256 of the PIN | Salted Argon2id, store the salt, constant time compare |
| API key extracted from the APK | RPC URL hardcoded in source | Load from gitignored .env or pass with --dart-define |
| Seed phrase shown without a check | No gate before decryption | Require local_auth before decrypting the mnemonic |
| Funds lost to a failing transaction | Sent without simulating | simulateTransaction first, send only if err is null |
| Man in the middle on RPC | Plaintext or untrusted endpoint | Reject non HTTPS, check the host against an approved list |

## References

- flutter_secure_storage: https://pub.dev/packages/flutter_secure_storage
- encrypt: https://pub.dev/packages/encrypt
- cryptography (Argon2id): https://pub.dev/packages/cryptography
- local_auth: https://pub.dev/packages/local_auth
- OWASP Mobile Top 10: https://owasp.org/www-project-mobile-top-10/
- Related skills in this set: solana-mobile-wallet-adapter-flutter, building-solana-transactions-flutter, flutter-solana-seed-vault, solana-dart-sdk

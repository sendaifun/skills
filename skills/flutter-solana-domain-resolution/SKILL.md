---
name: flutter-solana-domain-resolution
description: Resolve Solana domains in Flutter and Dart with the tld_parser SDK for the AllDomains Alternative Name Service (ANS), covering every custom TLD like .skr, .bonk, .backpack, and .solana. Use for forward lookup (domain to wallet), reverse lookup (wallet to main domain), reading records and avatars, listing user domains including NFT-wrapped ones, and batch resolution. ANS is a different protocol from Bonfida SNS (.sol), so use this when you need any TLD other than .sol.
license: MIT
metadata:
  author: Dominion Nwakanma (web3flutter.dev)
  version: "1.0.0"
tags:
  - solana
  - alldomains
  - ans
  - domain-resolution
  - tld-parser
  - flutter
  - dart
  - sns
  - name-service
---

# Solana Domain Resolution for Flutter (AllDomains ANS)

## Overview

`tld_parser` is the Dart SDK for the AllDomains Alternative Name Service (ANS) on Solana. It resolves domains with any TLD: `.skr`, `.bonk`, `.backpack`, `.solana`, `.blink`, `.monke`, and the rest. This is not the Bonfida SNS SDK. SNS only handles `.sol`. ANS handles everything else.

The two protocols are incompatible at the cryptographic level. SNS hashes names with the prefix `"SPL Name Service"` and uses program `namesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkX`. ANS hashes with the prefix `"ALT Name Service"` and uses program `ALTNSZ46uaAUU7XUV6awvdorLGqAsPwa9shm7h4uP2FK`. Every PDA derivation is different. You cannot resolve a `.sol` name through `tld_parser` or a `.bonk` name through `sns_sdk`. Most production apps run both side by side.

Three on-chain programs power AllDomains. ANS (`ALTNSZ46uaAUU7XUV6awvdorLGqAsPwa9shm7h4uP2FK`) is the name registry that stores domain to owner mappings. TLD House (`TLDHkysf5pCnKsVA4gXpNvmy7psXLPEu4LAdDJthT9S`) governs which TLDs exist. Name House (`NH3uX6FtVE2fNREAioP7hm5RaozotZxeL6khU1EHx51`) handles domains wrapped as NFTs.

AllDomains data lives on mainnet only. There is no devnet deployment. If you point `TldParser` at devnet, every lookup returns `null` and it looks like a deserialization bug.

## Instructions

1. Add `tld_parser: ^0.1.0` and `solana: ^0.31.0` to pubspec.yaml.
2. Construct `TldParser(rpcClient)` with a `solana.RpcClient`. Do NOT pass `SolanaClient` or `HttpRpcClient`. The constructor wants the raw `RpcClient` from `package:solana/solana.dart`.
3. Point the RpcClient at a mainnet URL even if the rest of your app uses devnet. A Helius or mainnet-beta endpoint is required.
4. Normalize every domain string with `.toLowerCase()` before passing it. The on-chain hash is computed from lowercase bytes, so `Miester.abc` and `miester.abc` derive different PDAs. The SDK does not auto-lowercase.
5. For forward lookup (domain to address), call `getOwnerFromDomainTld('name.tld')` with the full domain including the TLD. It returns `Ed25519HDPublicKey?` and gives `null` for missing domains.
6. For reverse lookup (address to main domain), call `tryGetMainDomain(pubkey)`, not `getMainDomain`. The throwing version spams logs because most wallets have no main domain set.
7. Build the full domain string as `'${main.domain}${main.tld}'`. The `tld` field already includes the leading dot.
8. Reuse one `TldParser` instance through a singleton. Add an in-memory cache and dedup concurrent lookups for the same key.
9. For lists (leaderboards, transaction history), pre-resolve all addresses with `Future.wait` before building widgets. Do not rely on `FutureBuilder` per row.

## Examples

### Production singleton resolver with cache and dedup

Forward and reverse lookup behind one reusable instance. The cache stops duplicate RPC calls and the pending map dedups concurrent lookups for the same address. This is the pattern used in Chumbucket's address name resolver.

```dart
import 'package:tld_parser/tld_parser.dart';
import 'package:solana/solana.dart' as solana;

class DomainResolver {
  static TldParser? _tldParser;
  static final Map<String, String> _cache = {};
  static final Map<String, DateTime> _timestamps = {};
  static final Map<String, Future<String>> _pending = {};
  static const Duration _cacheExpiry = Duration(hours: 1);

  static const List<String> _allDomainsTlds = [
    '.skr', '.bonk', '.backpack', '.blink', '.monke', '.ninja', '.solana',
  ];

  static TldParser _getParser() {
    return _tldParser ??= TldParser(
      solana.RpcClient('https://mainnet.helius-rpc.com/?api-key=YOUR_KEY'),
    );
  }

  /// Forward: domain to address.
  static Future<String?> resolveDomainToAddress(String domain) async {
    final normalized = domain.trim().toLowerCase();
    if (normalized.isEmpty) return null;

    final cacheKey = 'addr:$normalized';
    if (_cache.containsKey(cacheKey)) return _cache[cacheKey];

    if (!_allDomainsTlds.any((ext) => normalized.endsWith(ext))) return null;

    try {
      final owner = await _getParser().getOwnerFromDomainTld(normalized);
      if (owner != null) {
        final address = owner.toBase58();
        _cache[cacheKey] = address;
        return address;
      }
    } catch (e) {
      // Log but do not throw. Domain resolution is never on the critical path.
    }
    return null;
  }

  /// Reverse: address to display name, with caching and dedup.
  static Future<String> resolveAddressToName(String address) async {
    final cacheKey = 'name:$address';

    if (_cache.containsKey(cacheKey)) {
      final ts = _timestamps[cacheKey];
      if (ts != null && DateTime.now().difference(ts) < _cacheExpiry) {
        return _cache[cacheKey]!;
      }
      _cache.remove(cacheKey);
      _timestamps.remove(cacheKey);
    }

    if (_pending.containsKey(cacheKey)) return _pending[cacheKey]!;

    final future = _doReverseLookup(address, cacheKey);
    _pending[cacheKey] = future;
    try {
      return await future;
    } finally {
      _pending.remove(cacheKey);
    }
  }

  static Future<String> _doReverseLookup(String address, String cacheKey) async {
    try {
      final pubkey = solana.Ed25519HDPublicKey.fromBase58(address);
      final main = await _getParser().tryGetMainDomain(pubkey);
      if (main != null && main.domain.isNotEmpty) {
        final name = '${main.domain}${main.tld}';
        _cache[cacheKey] = name;
        _timestamps[cacheKey] = DateTime.now();
        return name;
      }
    } catch (_) {}

    final short =
        '${address.substring(0, 6)}..${address.substring(address.length - 4)}';
    _cache[cacheKey] = short;
    _timestamps[cacheKey] = DateTime.now();
    return short;
  }
}
```

### Forward and reverse lookup

```dart
import 'package:tld_parser/tld_parser.dart';
import 'package:solana/solana.dart';

Future<void> lookups(TldParser parser) async {
  // Forward: pass the FULL domain including the TLD, lowercased.
  final owner = await parser.getOwnerFromDomainTld('miester.abc');
  if (owner != null) {
    print('Owner: ${owner.toBase58()}');
  }

  // Subdomains use the same call: sub.domain.tld.
  final vaultOwner = await parser.getOwnerFromDomainTld('vault.miester.abc');
  if (vaultOwner != null) {
    print('Vault owner: ${vaultOwner.toBase58()}');
  }

  // Reverse: tryGetMainDomain returns null instead of throwing.
  final pubkey = Ed25519HDPublicKey.fromBase58(
    'Ggg9b4AZaQehNoQGfckVhKMNQiGF7XbGYWkWAsiJMTV5',
  );
  final main = await parser.tryGetMainDomain(pubkey);
  if (main != null) {
    // main.tld already includes the leading dot, so do not add one.
    print('Main domain: ${main.domain}${main.tld}'); // "miester.abc"
  }
}
```

### Reading records and resolving avatars

```dart
import 'package:tld_parser/tld_parser.dart';

Future<void> readProfile(TldParser parser) async {
  // Single record. Returns String? and null if unset.
  final twitter = await parser.getRecord('miester.abc', Record.twitter);
  if (twitter != null) print('Twitter: $twitter');

  // Several specific records in one call.
  final result = await parser.getRecords('miester.abc', [
    Record.twitter,
    Record.discord,
    Record.avatar,
    Record.displayName,
  ]);
  final discord = result.records[Record.discord];
  if (discord != null) print('Discord: $discord');

  // Avatar resolution with protocol detection. IPFS hashes become gateway
  // URLs, Arweave IDs become arweave.net URLs, NFT references resolve to the
  // metadata image, data URIs and direct URLs pass through unchanged.
  final avatarUrl = await parser.getAvatar('miester.abc');
  if (avatarUrl != null) print('Avatar: $avatarUrl');
}
```

### Listing a wallet's domains including NFT-wrapped

```dart
import 'package:tld_parser/tld_parser.dart';
import 'package:solana/solana.dart';

Future<void> listDomains(TldParser parser) async {
  final pubkey = Ed25519HDPublicKey.fromBase58(
    'Ggg9b4AZaQehNoQGfckVhKMNQiGF7XbGYWkWAsiJMTV5',
  );

  // Fast: just the name account public keys, one RPC call, no NFTs.
  final domainKeys = await parser.getAllUserDomains(pubkey);
  print('Owns ${domainKeys.length} name accounts');

  // Parsed with domain names. Costs more RPC calls.
  final parsed = await parser.getParsedAllUserDomains(pubkey);
  for (final d in parsed) {
    print('${d.domainName} -> ${d.nameAccount.toBase58()}');
  }

  // Includes both directly-owned and NFT-wrapped domains. Extra RPC per domain
  // to check NFT ownership, so use only when you actually need the wrapped set.
  final unwrapped = await parser.getParsedAllUserDomainsUnwrapped(pubkey);
  print('Owns ${unwrapped.length} domains including NFT-wrapped');
}
```

### Batch reverse lookup

```dart
import 'package:tld_parser/tld_parser.dart';
import 'package:solana/solana.dart';

Future<void> batch(TldParser parser) async {
  final addresses = [
    'Ggg9b4AZaQehNoQGfckVhKMNQiGF7XbGYWkWAsiJMTV5',
    '7M3RL9Tnsf5pCnKsVA4gXpNvmy7psXLPEu4LAdDJthT9',
  ];
  final pubkeys = addresses.map(Ed25519HDPublicKey.fromBase58).toList();

  // One call for many addresses. Returns List<String?>, null where no main
  // domain is set.
  final mainDomains = await parser.getMainDomains(pubkeys);
  for (var i = 0; i < addresses.length; i++) {
    print('${addresses[i]} -> ${mainDomains[i] ?? "(no main domain)"}');
  }
}
```

### Pre-resolving a list to avoid FutureBuilder flash

`FutureBuilder` reruns on every parent rebuild. Even with the cache, each row flashes from address to name. For leaderboards and transaction histories, resolve the whole batch up front, then feed plain strings into widgets.

```dart
import 'package:flutter/material.dart';

class ResolvedNameList extends StatefulWidget {
  const ResolvedNameList({super.key, required this.addresses});
  final List<String> addresses;

  @override
  State<ResolvedNameList> createState() => _ResolvedNameListState();
}

class _ResolvedNameListState extends State<ResolvedNameList> {
  List<String> _names = [];

  @override
  void initState() {
    super.initState();
    _resolveAll();
  }

  Future<void> _resolveAll() async {
    final names = await Future.wait(
      widget.addresses.map(DomainResolver.resolveAddressToName),
    );
    if (mounted) setState(() => _names = names);
  }

  @override
  Widget build(BuildContext context) {
    if (_names.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    return ListView.builder(
      itemCount: _names.length,
      itemBuilder: (context, i) => ListTile(
        title: Text(_names[i], maxLines: 1, overflow: TextOverflow.ellipsis),
      ),
    );
  }
}
```

## Guidelines

- DO point `TldParser` at a mainnet RPC. AllDomains has no devnet deployment, so devnet lookups always return `null`.
- DO pass `solana.RpcClient` to the constructor. Not `SolanaClient`, not `HttpRpcClient` from `sns_sdk`.
- DO lowercase every domain string before any lookup. The hash is over lowercase bytes.
- DO pass the full `domain.tld` including the TLD. `getOwnerFromDomainTld('miester')` cannot pick a namespace and throws.
- DO use `tryGetMainDomain` in production. `getMainDomain` throws `MainDomainNotFoundException` for the common case of no main domain.
- DO build the full domain as `'${main.domain}${main.tld}'`. The `tld` already has the dot.
- DO reuse one `TldParser` through a singleton and cache results. A new parser per call wastes connections.
- DON'T treat the return of `getOwnerFromDomainTld` as a `String`. SNS returns a base58 `String`, ANS returns `Ed25519HDPublicKey?`. Call `.toBase58()`.
- DON'T reuse SNS hash logic. ANS uses `"ALT Name Service"`, not `"SPL Name Service"`, so the PDAs differ.
- DON'T call `getAllRecords` casually. It fetches all 27 record types. Use `getRecords` with a short list.
- DON'T hardcode TLD parent accounts. Discover them with `getAllTld()` and cache, since TLD-scoped queries like `getAllUserDomainsFromTld` need the parent account.

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| Type error passing client to `TldParser()` | Passed `SolanaClient` or `sns_sdk`'s `HttpRpcClient` | Pass `solana.RpcClient(url)` directly |
| Every lookup returns null | RPC pointed at devnet | Use a mainnet RPC. AllDomains exists on mainnet only |
| Resolves on web but not for typed input | Input not lowercased | Call `.toLowerCase()` before every lookup |
| `getOwnerFromDomainTld('miester')` throws | TLD missing from the domain string | Pass the full `domain.tld`, including the extension |
| `MainDomainNotFoundException` floods logs | Used `getMainDomain` for wallets with no main domain | Use `tryGetMainDomain`, which returns `null` |
| Full domain renders as `miester..abc` | Added a dot before `main.tld` | `main.tld` already includes the dot: `'${main.domain}${main.tld}'` |
| `.sol` names never resolve | Routed `.sol` through `tld_parser` | Use `sns_sdk` for `.sol`. ANS and SNS are different protocols |
| `NullPointerException` on resolve result | Assumed a domain always resolves | Null-check `getOwnerFromDomainTld`, it returns `null` for missing domains |
| List rows flash from address to name | One `FutureBuilder` per row reruns on rebuild | Pre-resolve the batch with `Future.wait`, pass strings to widgets |

## References

- tld_parser is pinned low at `^0.1.0`. Verify method names (`getOwnerFromDomainTld`, `tryGetMainDomain`, `getMainDomains`, `getParsedAllUserDomainsUnwrapped`, `getRecords`, `getAvatar`, `getAllTld`) against the current pub.dev page before shipping, since the API can drift between patch releases.
- tld_parser on pub.dev: https://pub.dev/packages/tld_parser
- tld_parser on GitHub: https://github.com/onsol-labs/tld-parser-dart
- AllDomains: https://alldomains.id
- AllDomains docs: https://docs.alldomains.id
- solana Dart SDK: https://pub.dev/packages/solana
- Related skills in this set: solana-dart-sdk, solana-mobile-wallet-adapter-flutter, flutter-solana-wallet-security

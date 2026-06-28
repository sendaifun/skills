---
name: coral-xyz-anchor-dart
description: Build typed Dart clients for Solana programs with the coral_xyz package, the Dart equivalent of @coral-xyz/anchor. Load an IDL and integrate Anchor, Quasar, or Pinocchio programs in Flutter. Use to call instructions, fetch and decode accounts, derive PDAs, subscribe to events, and simulate transactions without manual Borsh wiring.
license: MIT
metadata:
  author: Dominion Nwakanma (web3flutter.dev)
  version: "1.0.0"
tags:
  - solana
  - anchor
  - coral-xyz
  - flutter
  - dart
  - idl
  - pda
  - program-client
  - borsh
---

# coral_xyz Anchor Client for Dart

## Overview

`coral_xyz` is the Dart equivalent of `@coral-xyz/anchor` from the TypeScript ecosystem. You give it a program's IDL (JSON) and it gives you a `Program` object with full namespace access: call instructions, fetch and decode accounts, subscribe to events, derive PDAs, and simulate transactions, all without writing manual Borsh serialization.

It supports three Solana program frameworks. Anchor uses SHA256 8-byte discriminators, Borsh-encoded accounts, and the standard Anchor IDL format. Quasar uses explicit N-byte discriminators, zero-copy `#[repr(C)]` accounts, and bounded strings and vecs. Pinocchio and manual programs define their interface through the `ProgramInterface` builder with raw byte layouts.

The IDL format is auto-detected. You do not choose. Pass any IDL JSON and `coral_xyz` figures out the framework and selects the right coder.

This package is pre-1.0 (v1.0.0-beta.9 at time of writing), so pin the version and expect minor API drift between betas.

## Instructions

1. Add `coral_xyz: ^1.0.0-beta.9` and `solana: ^0.32.0` to pubspec.yaml. coral_xyz beta.9 depends on solana ^0.32.0, so pin solana there, not on 0.31.x, or the resolve fails.
2. Load the IDL JSON from a file, asset bundle, or network, then parse it with `Idl.fromJson(jsonDecode(idlString) as Map<String, dynamic>)`.
3. If the IDL JSON has no `address` field, inject it (`idlMap['address'] = programId;`) before parsing, or build the program with `Program.withProgramId()`.
4. Create a `Connection` and a `Wallet`, then wrap them in an `AnchorProvider`. Use `AnchorProvider.readOnly(connection)` only for reads. Use `AnchorProvider(connection, wallet)` for writes.
5. Build the program with `Program(idl, provider: provider)`, `Program.withProgramId(idl, publicKey, provider: provider)`, or `Program.at(address, provider: provider)`.
6. Call instructions through the `methods` namespace. In Flutter, cast to `dynamic` so the `noSuchMethod` dispatch can route IDL method names: `(program.methods as dynamic).initialize().accounts({'config': configPda}).rpc()`.
7. Fetch accounts through `program.account['Name']!.fetch(pda)`. Account data comes back as `Map<String, dynamic>`. Decode u64 and i64 fields as `BigInt`.
8. Derive PDAs with `PublicKeyUtils.findProgramAddress(seeds, programId)` using the deployed program ID, not the hardcoded test ID from Rust source.
9. Call `await program.dispose()` when you are done to tear down event subscriptions and connections.

## Examples

### Quick start: load IDL, call an instruction, fetch an account

```dart
import 'dart:convert';
import 'package:coral_xyz/coral_xyz.dart';

Future<int> quickStart() async {
  // 1. Load IDL from JSON (file, asset bundle, or network).
  final idlJson =
      '{"address":"A9yYAEQ1sCfZbR5o","instructions":[],"accounts":[]}';
  final idlMap = jsonDecode(idlJson) as Map<String, dynamic>;
  final idl = Idl.fromJson(idlMap);

  // 2. Set up the provider.
  final connection = Connection('https://api.devnet.solana.com');
  final wallet = await KeypairWallet.generate();
  final provider = AnchorProvider(connection, wallet);

  // 3. Create the program.
  final program = Program(idl, provider: provider);

  // 4. Derive the PDA the instruction needs.
  final counterPda = (await PublicKeyUtils.findProgramAddress(
    [utf8.encode('counter')],
    program.programId,
  )).address;

  // 5. Call an instruction.
  await (program.methods as dynamic)
      .initialize()
      .accounts({
        'counter': counterPda,
        'payer': wallet.publicKey,
        'systemProgram': PublicKeyUtils.systemProgram,
      })
      .rpc();

  // 6. Fetch and decode an account. u64 fields come back as BigInt.
  final data = await program.account['Counter']!.fetch(counterPda);
  return (data['count'] as BigInt).toInt();
}
```

### Flutter service: read-only first, upgrade to a write provider on wallet connect

This is the common Flutter shape. Fetch accounts before the wallet connects, then rebuild the program with a full provider once it does.

```dart
import 'dart:convert';
import 'package:flutter/services.dart';
import 'package:coral_xyz/coral_xyz.dart';

class SolanaService {
  static const String _programId = 'A9yYAEQ1sCfZbR5o';
  static const String _rpcUrl = 'https://api.devnet.solana.com';

  Program? _program;
  PublicKey? _counterPda;

  // 1. Initialize read-only (fetch accounts before wallet connect).
  Future<void> initReadOnly() async {
    final idlString = await rootBundle.loadString('assets/idl.json');
    final idlMap = jsonDecode(idlString) as Map<String, dynamic>;
    idlMap['address'] = _programId; // inject if IDL JSON lacks it

    final idl = Idl.fromJson(idlMap);
    final connection = Connection(_rpcUrl);

    _program = Program.withProgramId(
      idl,
      PublicKeyUtils.fromBase58(_programId),
      provider: AnchorProvider.readOnly(connection),
    );
  }

  // 2. Upgrade to a full provider when the wallet connects.
  void connectWallet(Wallet wallet) {
    _program = Program.withProgramId(
      _program!.idl,
      _program!.programId,
      provider: AnchorProvider(Connection(_rpcUrl), wallet),
    );
  }

  // 3. Derive the PDA once and cache it.
  Future<PublicKey> getCounterPda() async {
    _counterPda ??= (await PublicKeyUtils.findProgramAddress(
      [utf8.encode('counter_v2')],
      _program!.programId,
    )).address;
    return _counterPda!;
  }

  // 4. Write: initialize.
  Future<String> initialize() async {
    final pda = await getCounterPda();
    return await ((_program!.methods as dynamic)
        .initialize()
        .accounts({
          'counter': pda,
          'payer': _program!.provider.wallet!.publicKey,
          'systemProgram': PublicKeyUtils.systemProgram,
        })
        .rpc()) as String;
  }

  // 5. Write: increment.
  Future<String> increment(int amount) async {
    final pda = await getCounterPda();
    return await ((_program!.methods as dynamic)
        .increment(BigInt.from(amount))
        .accounts({'counter': pda})
        .rpc()) as String;
  }

  // 6. Read: fetch the count. u64 decodes to BigInt.
  Future<int> getCount() async {
    final pda = await getCounterPda();
    final data = await _program!.account['Counter']!.fetch(pda);
    return (data['count'] as BigInt).toInt();
  }

  // 7. Cleanup.
  Future<void> dispose() async {
    await _program?.dispose();
  }
}
```

### Full fluent builder, then a terminal call

Every method access returns a `TypeSafeMethodBuilder`. Chain the modifiers, then pick one terminal.

```dart
import 'package:coral_xyz/coral_xyz.dart';

Future<String> transferWithBuilder({
  required Program program,
  required PublicKey fromPda,
  required PublicKey toPda,
  required PublicKey authority,
  required PublicKey customTokenProgram,
  required PublicKey extraAccount,
  required Wallet extraKeypair,
  required TransactionInstruction computeBudgetIx,
  required TransactionInstruction memoIx,
}) async {
  final builder = program.methods['transfer']!([BigInt.from(1000000)])
      .accounts({
        'from': fromPda,
        'to': toPda,
        'authority': authority,
      })
      .accountsPartial({                 // override only some accounts
        'tokenProgram': customTokenProgram,
      })
      .signers([extraKeypair])           // signers beyond the wallet
      .remainingAccounts([               // extra accounts not in the IDL
        AccountMeta(
          publicKey: extraAccount,
          isWritable: true,
          isSigner: false,
        ),
      ])
      .preInstructions([computeBudgetIx])
      .postInstructions([memoIx]);

  // Terminal: send and return the signature.
  return await builder.rpc();
}
```

Other terminals on the same builder: `builder.instruction()` returns a `TransactionInstruction`, `builder.transaction()` returns an `AnchorTransaction`, `builder.simulate()` returns a `SimulationResult` (with `success`, `logs`, and `unitsConsumed`), `builder.view()` runs a view function, and `builder.pubkeys()` returns the resolved `Map<String, PublicKey?>` without executing.

### Build an IDL programmatically for Pinocchio or native programs

When there is no JSON IDL, define the interface with the `ProgramInterface` builder. The resulting `Idl` works with the same `program.methods` and `program.account` API.

```dart
import 'package:coral_xyz/coral_xyz.dart';

Program buildNativeProgram(AnchorProvider provider) {
  final idl = ProgramInterface.define(
    name: 'my_program',
    address: 'A9yYAEQ1sCfZbR5o',
    version: '0.1.0',
  )
    .instruction('initialize', discriminator: [0])
      .account('counter', writable: true, signer: false)
      .account('payer', writable: true, signer: true)
      .account('systemProgram')
      .arg('initialValue', IdlType(kind: 'u64'))
      .done()
    .instruction('increment', discriminator: [1])
      .account('counter', writable: true)
      .arg('amount', IdlType(kind: 'u64'))
      .done()
    .account('Counter', discriminator: [0xFF, 0x01])
      .field('count', IdlType(kind: 'u64'))
      .field('authority', IdlType(kind: 'pubkey'))
      .done()
    .error(6000, 'Overflow', msg: 'Counter overflowed')
    .build();

  return Program(idl, provider: provider);
}
```

### Decode an account with nested structs

The coder auto-deserializes nested types from the IDL. Cast each field to the type the IDL maps it to.

```dart
import 'package:coral_xyz/coral_xyz.dart';

class PollOption {
  PollOption({required this.label, required this.id, required this.votes});
  final String label;
  final int id;
  final int votes;
}

Future<List<PollOption>> fetchPollOptions(
  Program program,
  PublicKey pollAddress,
) async {
  final data = await program.account['Poll']!.fetch(pollAddress);

  final rawOptions = data['options'] as List;
  return rawOptions.map((opt) {
    final m = opt as Map<String, dynamic>;
    return PollOption(
      label: m['label'] as String,
      id: (m['id'] as BigInt).toInt(),    // u64 decodes to BigInt
      votes: (m['votes'] as BigInt).toInt(),
    );
  }).toList();
}
```

### Subscribe to events

```dart
import 'package:coral_xyz/coral_xyz.dart';

int subscribeToCounter(Program program) {
  final listenerId = program.addEventListener<Map<String, dynamic>>(
    'CounterIncremented',
    (event, slot, signature) {
      print('Event at slot $slot: new count ${event['newCount']}');
    },
  );
  return listenerId; // pass to program.removeEventListener(listenerId) later
}
```

## Guidelines

- DO cast to `dynamic` for IDL method names in Flutter: `(program.methods as dynamic).initialize()`. Dart's static type system cannot resolve IDL-defined names at compile time, so the `noSuchMethod` override on `MethodsNamespace` routes the call. This mirrors `program.methods.initialize()` in TypeScript Anchor.
- DO use `AnchorProvider(connection, wallet)` for any write. `AnchorProvider.readOnly()` has no wallet, so calling `.rpc()` on it fails with a wallet-null error. Use read-only only for `program.account['myAccount'].fetch()`.
- DO decode u64, i64, u128, and i128 fields as `BigInt`. Cast with `(data['count'] as BigInt).toInt()` only when the value is below 2^53.
- DO derive PDAs with the deployed program ID. A program's hardcoded `ID_BYTES` in Rust source often differs from the deployed keypair, and a mismatch produces a different PDA than the program expects.
- DO match IDL account map keys exactly. The IDL may use camelCase where you wrote snake_case. Check `program.idl.findInstruction('methodName')?.accounts`.
- DON'T call `Program(idl)` when the IDL JSON has no `address` field. It throws "address required". Inject `idlMap['address'] = id` before `Idl.fromJson()`, or use `Program.withProgramId()`.
- DON'T treat account results as typed classes. They are `Map<String, dynamic>` keyed by IDL field names. PublicKey fields come back as `Ed25519HDPublicKey`, nested structs as nested maps.
- DON'T pass a PDA-derived account that the IDL has no seed definitions for and expect auto-resolution. `AccountsResolver` only auto-derives when the IDL has `pda.seeds`; otherwise pass the PDA explicitly in `.accounts({'config': configPda})`.

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Program(idl)` throws "address required" | IDL JSON has no `address` field | Inject `idlMap['address'] = id` before `Idl.fromJson()`, or use `Program.withProgramId(idl, publicKey)` |
| `.rpc()` fails with "wallet is null" | Program built on `AnchorProvider.readOnly()` | Rebuild with `AnchorProvider(connection, wallet)` for writes |
| Dynamic method cast required | `MethodsNamespace` uses `noSuchMethod` for dispatch | Use `(program.methods as dynamic).methodName(args)` |
| `BigInt` where `int` expected | IDL u64, i64, u128, i128 fields decode to `BigInt` | Cast with `(data['count'] as BigInt).toInt()`, safe below 2^53 |
| PDA mismatch between Dart and Rust | Hardcoded `ID_BYTES` in Rust differs from the deployed keypair | Derive with the DEPLOYED program ID, not the hardcoded test ID |
| Account fetch returns `null` | Account not initialized on-chain yet | Call the initialize instruction first, or null-check the fetch result |
| Accounts map keys rejected | IDL uses camelCase but you passed snake_case (or vice versa) | Match IDL names from `program.idl.findInstruction(name)?.accounts` |
| `AccountsResolver` cannot auto-derive a PDA | IDL lacks `pda.seeds` for that account | Pass the PDA explicitly in `.accounts({'pool': poolPda})` |

## References

- coral_xyz on pub.dev: https://pub.dev/packages/coral_xyz (pre-1.0, v1.0.0-beta.x, so the API may shift between betas; pin `coral_xyz: ^1.0.0-beta.9`)
- solana Dart SDK: https://pub.dev/packages/solana
- Anchor framework and IDL format: https://www.anchor-lang.com
- Solana PDA documentation: https://solana.com/docs/core/pda
- Related skills in this set: solana-mobile-wallet-adapter-flutter, solana-dart-sdk, building-solana-transactions-flutter

---
name: flutter-solana-metaplex-nft
description: Mint and read Solana NFTs from Flutter and Dart using the Metaplex Token Metadata program built into package:solana via package:solana/metaplex.dart. Use to create a 0-decimal NFT mint plus master edition, build createMetadataAccountV3 and createMasterEditionV3 instructions, parse on-chain Metadata and MasterEdition accounts, read off-chain JSON metadata, and run a backend-mediated MWA-signed mint on mobile.
license: MIT
metadata:
  author: Dominion Nwakanma (web3flutter.dev)
  version: "1.0.0"
tags:
  - solana
  - metaplex
  - nft
  - token-metadata
  - master-edition
  - flutter
  - dart
  - mobile-wallet-adapter
---

# Metaplex NFTs for Flutter and Dart

## Overview

Metaplex Token Metadata support is built into the `solana` package. There is no separate Metaplex SDK to add. You import the extra types and instruction builders from `package:solana/metaplex.dart`, alongside the usual `package:solana/solana.dart`.

The package gives you four things:

1. Instruction builders. `createMetadataAccountV3()` and `createMasterEditionV3()` return `AnchorInstruction` objects you drop into a `Message`.
2. Account parsers. `Metadata.fromBinary()` and `MasterEdition.fromBorsh()` read the raw on-chain accounts.
3. RPC extensions. `getMetadata()` and `getMasterEdition()` derive the PDA, fetch, and parse for you.
4. Off-chain models. `OffChainMetadata`, `Attribute`, `Properties`, `Collection`, and `File` model the JSON standard pointed to by the `uri` field.

The mint, ATA, and account-fetch helpers (`initializeMint`, `createAssociatedTokenAccount`, `mintTo`, `getMetadata`, `getMasterEdition`) are extension methods on `SolanaClient` and `RpcClient` from `package:solana`. They only resolve when that import is present.

The Metaplex program ID is `metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s`. Pin `solana: ^0.31.2` or newer.

## Instructions

1. Add `solana: ^0.31.2` to pubspec.yaml.
2. Import both `package:solana/solana.dart` and `package:solana/metaplex.dart`. The first import brings in the `SolanaClient` and `RpcClient` extension methods used below; the second brings in the Metaplex types.
3. Create the mint with `initializeMint(decimals: 0)`. An NFT is a mint with 0 decimals and a supply of exactly 1.
4. Create the associated token account with `createAssociatedTokenAccount`, then `mintTo` with `amount: 1`.
5. Build the metadata instruction with `createMetadataAccountV3` and send it before the master edition. The master edition instruction needs the metadata PDA to already exist.
6. Build the master edition instruction with `createMasterEditionV3`. Pass `maxSupply: BigInt.zero` for no prints, or `null` for unlimited prints.
7. To read an NFT, call `rpcClient.getMetadata(mint:)`. It returns `Metadata?`, null when the account does not exist. Call `getExternalJson()` on the result to fetch and parse the off-chain JSON.
8. On mobile, do not ship the update authority key in the app. Build the instructions on a backend, return the encoded transaction, sign it with Mobile Wallet Adapter, and submit from the backend.

## Examples

### Full 4-step mint (0-decimal mint plus master edition)

Create the mint, mint one token, write metadata, then promote it to a master edition. Each step is sent as its own transaction.

```dart
import 'package:solana/solana.dart';
import 'package:solana/metaplex.dart';

Future<void> mintNft(SolanaClient client, Ed25519HDKeyPair owner) async {
  // 1. Create a mint with 0 decimals. An NFT is 0 decimals, supply 1.
  // initializeMint is a SolanaClient extension method from package:solana.
  final mint = await client.initializeMint(
    mintAuthority: owner,
    decimals: 0,
  );

  // 2. Create the ATA and mint exactly 1 token.
  // createAssociatedTokenAccount and mintTo are SolanaClient extensions.
  final ata = await client.createAssociatedTokenAccount(
    mint: mint.address,
    funder: owner,
  );
  await client.mintTo(
    mint: mint.address,
    destination: Ed25519HDPublicKey.fromBase58(ata.pubkey),
    amount: 1,
    authority: owner,
  );

  // 3. Create the metadata account.
  final metadataIx = await createMetadataAccountV3(
    mint: mint.address,
    mintAuthority: owner.publicKey,
    payer: owner.publicKey,
    updateAuthority: owner.publicKey,
    data: CreateMetadataAccountV3Data(
      name: 'My NFT',
      symbol: 'MNFT',
      uri: 'https://arweave.net/your-metadata.json',
      sellerFeeBasisPoints: 500, // 5% royalty
      isMutable: true,
      // NOTE: "colectionDetails" is a known upstream typo in package:solana
      // (missing an l). Keep the misspelling; that is the real field name.
      colectionDetails: false,
    ),
  );
  await client.sendAndConfirmTransaction(
    message: Message.only(metadataIx),
    signers: [owner],
    onSigned: ignoreOnSigned,
  );

  // 4. Create the master edition. This makes it a true NFT.
  final editionIx = await createMasterEditionV3(
    mint: mint.address,
    updateAuthority: owner.publicKey,
    mintAuthority: owner.publicKey,
    payer: owner.publicKey,
    data: CreateMasterEditionV3Data(
      maxSupply: BigInt.zero, // BigInt.zero = no prints allowed
    ),
  );
  await client.sendAndConfirmTransaction(
    message: Message.only(editionIx),
    signers: [owner],
    onSigned: ignoreOnSigned,
  );
}
```

### Read on-chain Metadata and MasterEdition

`getMetadata` and `getMasterEdition` are `RpcClient` extension methods. They derive the PDA, fetch the account, and parse it. Both return null when the account is missing.

```dart
import 'package:solana/solana.dart';
import 'package:solana/metaplex.dart';

Future<void> readNft(RpcClient rpc, Ed25519HDPublicKey mintPubKey) async {
  final metadata = await rpc.getMetadata(
    mint: mintPubKey,
    commitment: Commitment.finalized,
  );
  if (metadata != null) {
    print(metadata.name);             // 'My NFT'
    print(metadata.symbol);           // 'MNFT'
    print(metadata.uri);              // 'https://arweave.net/your-metadata.json'
    print(metadata.updateAuthority);  // base58 string
    print(metadata.mint);             // base58 string
  }

  final edition = await rpc.getMasterEdition(mint: mintPubKey);
  if (edition != null) {
    print(edition.key);        // 6 = MasterEditionV2
    print(edition.supply);     // BigInt, prints minted so far
    print(edition.maxSupply);  // BigInt?, null = unlimited, 0 = no prints
  }
}
```

### Parse off-chain JSON metadata

The on-chain `uri` points to JSON. `getExternalJson()` fetches and parses it into an `OffChainMetadata`. `Properties` is a freezed union discriminated by the JSON `category` field, so resolve it with `map`.

```dart
import 'package:solana/solana.dart';
import 'package:solana/metaplex.dart';

Future<void> readOffChain(Metadata metadata) async {
  final offChain = await metadata.getExternalJson();

  print(offChain.name);         // 'My NFT'
  print(offChain.description);  // 'A cool NFT'
  print(offChain.symbol);       // 'MNFT'
  print(offChain.image);        // 'https://arweave.net/image.png'

  // Attributes are trait_type and value pairs. value is dynamic.
  for (final attr in offChain.attributes) {
    print(attr.traitType);  // 'Background'
    print(attr.value);      // 'Blue', can be String, int, etc.
  }

  // Properties is a freezed union keyed on media category.
  final mediaUri = offChain.properties.map(
    unknown: (_) => null,
    image: (p) => p.files.first.uri,
    video: (p) => p.files.first.uri,
    audio: (p) => p.files.first.uri,
    vr: (p) => p.files.first.uri,
    html: (p) => p.files.first.uri,
  );
  print(mediaUri);

  print(offChain.collection?.name);    // 'My Collection'
  print(offChain.collection?.family);  // 'My Family'
}
```

### Backend-mediated mint signed with MWA (mobile)

On mobile you must not embed the update authority key. Build the Metaplex instructions on a backend, return the encoded transaction, sign it with Mobile Wallet Adapter, and let the backend submit. The placeholder calls (`uploadService`, `backendApi`, `mwaClient`, `wallet`, `token`) are your own app services.

```dart
import 'dart:convert';

Future<String> mintViaBackend({
  required UploadService uploadService,
  required BackendApi backendApi,
  required MobileWalletAdapterClient mwaClient,
  required Wallet wallet,
  required String token,
  required String name,
  required String imagePath,
  required List<MapEntry<String, String>> attributes,
}) async {
  // 1. Upload media and JSON metadata to Arweave or IPFS.
  final metadataUri = await uploadService.upload(name, imagePath, attributes);

  // 2. Backend builds the Metaplex instructions server-side.
  final preparedTx = await backendApi.prepareNft(
    walletAddress: wallet.address,
    name: name,
    symbol: 'MNFT',
    metadataUri: metadataUri,
    sellerFeeBasisPoints: 500,
    creators: [CreatorDto(address: wallet.address, share: 100)],
  );

  // 3. Sign the prepared transaction with MWA.
  final signed = await mwaClient.signTransactions(
    transactions: [base64Decode(preparedTx.encodedTx)],
  );

  // 4. Backend submits the signed transaction and returns the signature.
  return backendApi.finalizeNft(
    preparedTx.id,
    base64Encode(signed.signedPayloads.first),
  );
}
```

### Build a gallery from a list of mints

Fetch each NFT's on-chain metadata, then resolve the off-chain JSON. Skip mints with missing or unreachable metadata.

```dart
import 'package:solana/solana.dart';
import 'package:solana/metaplex.dart';

Future<List<OffChainMetadata>> fetchNfts(
  RpcClient rpc,
  List<Ed25519HDPublicKey> mints,
) async {
  final results = <OffChainMetadata>[];
  for (final mint in mints) {
    final metadata = await rpc.getMetadata(mint: mint);
    if (metadata == null) continue;
    try {
      results.add(await metadata.getExternalJson());
    } catch (_) {
      // The uri may be invalid or unreachable. Skip it.
    }
  }
  return results;
}
```

## Reference: instruction data fields

`CreateMetadataAccountV3Data` fields passed to `createMetadataAccountV3`:

| Field | Type | Notes |
|-------|------|-------|
| `name` | `String` | Fixed 32 bytes (BFixedString) |
| `symbol` | `String` | Fixed 10 bytes |
| `uri` | `String` | Fixed 200 bytes, off-chain JSON URL |
| `sellerFeeBasisPoints` | `int` | Royalty in bps (500 = 5%) |
| `creators` | `List<MetadataCreator>?` | Optional creator list, shares must sum to 100 |
| `collection` | `MetadataCollection?` | Collection verification |
| `uses` | `MetadataUses?` | Usage tracking |
| `isMutable` | `bool` | Whether metadata can be updated later |
| `colectionDetails` | `bool` | Collection details flag. Misspelled in the real API (known upstream typo, missing an l). Use it as written |

`CreateMasterEditionV3Data` has one field, `maxSupply` of type `BigInt?`. `null` means unlimited prints, `BigInt.zero` means no prints.

Supporting types from `package:solana/metaplex.dart`:

```dart
import 'package:solana/solana.dart';
import 'package:solana/metaplex.dart';

void supportingTypes(Ed25519HDPublicKey creatorPubKey,
    Ed25519HDPublicKey collectionMintPubKey) {
  MetadataCreator(
    address: creatorPubKey,
    verified: false, // only true after on-chain verification
    share: 100,      // 0 to 100, must sum to 100 across all creators
  );

  MetadataCollection(
    verified: false, // only true after the collection authority verifies
    key: collectionMintPubKey,
  );

  MetadataUses(
    useMethod: 0,    // 0 = Burn, 1 = Multiple, 2 = Single
    remaining: BigInt.from(1),
    total: BigInt.from(1),
  );
}
```

## Guidelines

- DO use `decimals: 0` for the mint and mint exactly 1 token. That is what makes the asset an NFT.
- DO send the metadata transaction before the master edition transaction. The master edition needs the metadata PDA to exist.
- DO use `rpcClient.getMetadata(mint:)` and `getMasterEdition(mint:)` for reads. They derive the PDA for you.
- DO null-check the result of `getMetadata` and `getMasterEdition`. Both return null for missing accounts.
- DO keep the `colectionDetails` spelling exactly as the package defines it. It is misspelled upstream and will not resolve if you "correct" it.
- DO import `package:solana/metaplex.dart` for the Metaplex types and `package:solana/solana.dart` for the client extension methods. Both are required.
- DON'T set `maxSupply: null` when you want a 1-of-1 with no prints. `null` means unlimited. Use `BigInt.zero`.
- DON'T set `verified: true` on a creator or collection that has not been verified on-chain. Only the signing creator can be verified at creation time.
- DON'T mint more than 1 token before creating the master edition. The master edition instruction expects a supply of 1.
- DON'T embed the update authority key in a mobile app. Build instructions on a backend and sign with MWA.
- DON'T call the internal PDA helper `findMetaplexMetadataProgramAddress` directly. Go through the RPC extensions.

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `colectionDetails` is not defined | Spelling "corrected" to `collectionDetails` | Use `colectionDetails`, the real field is misspelled upstream |
| `initializeMint` / `getMetadata` is not defined | Missing `package:solana/solana.dart` import | These are extension methods from `package:solana`, import it |
| Master edition instruction fails | Metadata account does not exist yet | Send `createMetadataAccountV3` before `createMasterEditionV3` |
| NFT shows fractional balance or supply above 1 | Mint created with non-zero decimals or over-minted | Use `decimals: 0` and `mintTo(amount: 1)` |
| Unlimited prints created by accident | `maxSupply: null` used for a 1-of-1 | Pass `maxSupply: BigInt.zero` for no prints |
| Transaction rejected, creator shares invalid | `MetadataCreator.share` values do not sum to 100 | Make all creator shares sum to exactly 100 |
| Creator or collection stays unverified | `verified: true` set without on-chain verification | Set `verified: false` at creation, verify on-chain later |
| `getExternalJson()` throws | The `uri` is invalid or the host is unreachable | Wrap in try/catch and skip, as in the gallery example |

## References

- solana Dart SDK on pub.dev: https://pub.dev/packages/solana
- Metaplex Token Metadata program docs: https://developers.metaplex.com/token-metadata
- Token Metadata standard (off-chain JSON): https://developers.metaplex.com/token-metadata/token-standard
- Related skills in this set: solana-dart-sdk, building-solana-transactions-flutter, solana-mobile-wallet-adapter-flutter

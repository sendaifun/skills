---
name: integrating-jupiter-flutter
description: Quote and execute Solana token swaps from Flutter and Dart using the Jupiter aggregator, the jupiter_aggregator Retrofit and Dio client, and the solana Dart SDK. Use to build QuoteRequestDto and JupiterSwapRequestDto calls, read multi-hop routePlan splits, pick slippage tiers, guard on priceImpactPct, fetch token USD prices from the Price API, decode and sign swap transactions with MWA or a local keypair, and proxy swaps through a backend. There is no pub.dev package, so vendor the source from the Espresso Cash monorepo.
license: MIT
metadata:
  author: Dominion Nwakanma (web3flutter.dev)
  version: "1.0.0"
tags:
  - solana
  - jupiter
  - dex
  - swap
  - defi
  - flutter
  - dart
  - retrofit
  - freezed
  - price-api
---

# Integrating Jupiter Aggregator in Flutter

## Overview

Jupiter is the swap aggregator for Solana. It finds the best route across DEXes (Raydium, Orca, Phoenix, and more), returns a quote, and hands you a ready-to-sign transaction. The `jupiter_aggregator` package wraps the Jupiter swap API and the Price API with Retrofit-generated Dio clients and freezed DTOs.

Two clients do the work. `JupiterAggregatorClient` handles the swap flow (quote and execute) against `quote-api.jup.ag/v6`. `JupiterPriceClient` fetches token USD prices against `api.jup.ag`. Every request and response is a freezed DTO, so the field names below are exact.

There is no pub.dev package for Jupiter in Dart. You vendor the source from the Espresso Cash monorepo (`packages/jupiter_aggregator`) or rewrite the client against the same endpoint contracts. The package is internal (`publish_to: "none"`) and pinned at 0.0.5. It depends on `dio` ^5.4.0, `freezed_annotation` ^2.2.0, and `retrofit` ^4.0.3.

## Instructions

1. Vendor the `jupiter_aggregator` source into your repo from the Espresso Cash monorepo, or add it as a path or git dependency. There is no published package to pull from pub.dev.
2. Construct `JupiterAggregatorClient()`. Pass `apiKey` for higher rate limits in production, or `baseUrl` to point at a proxy or self-hosted endpoint.
3. Build a `QuoteRequestDto` with mints, `amount` in the input token's smallest unit, and `slippageBps`. Call `getQuote` to fetch a route.
4. Read `quote.priceImpactPct` (a String) and warn the user before continuing if it is high.
5. Build a `JupiterSwapRequestDto` with the user's public key and the entire `quoteResponse` object. Call `getSwapTransactions`.
6. Decode `swap.swapTransaction` from base64. Sign with MWA (`signTransactions`) or a local `Ed25519HDKeyPair`. Send with the `solana` RpcClient.
7. Fetch a fresh quote immediately before each swap. Quotes go stale fast and the transaction fails with an expired blockhash.
8. For production, proxy swaps through your backend so the API key and fee logic stay server-side.

## Examples

### Quote, swap, sign, and send with a local keypair

A full SOL to USDC swap signed by a local keypair. Note the fresh quote right before the swap request.

```dart
import 'dart:convert';
import 'package:jupiter_aggregator/jupiter_aggregator.dart';
import 'package:solana/solana.dart';
import 'package:solana/encoder.dart';

Future<String> swapSolToUsdc(Ed25519HDKeyPair wallet) async {
  final jupiter = JupiterAggregatorClient();
  final rpc = RpcClient('https://api.mainnet-beta.solana.com');

  final quote = await jupiter.getQuote(QuoteRequestDto(
    inputMint: 'So11111111111111111111111111111111111111112',  // wSOL
    outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    amount: 1000000000,  // 1 SOL in lamports
    slippageBps: 50,     // 0.5%
  ));

  final impact = double.tryParse(quote.priceImpactPct) ?? 0;
  if (impact > 5.0) {
    throw Exception('Price impact too high: $impact%');
  }

  final swap = await jupiter.getSwapTransactions(JupiterSwapRequestDto(
    userPublicKey: wallet.address,
    quoteResponse: quote,
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
    computeUnitPriceMicroLamports: 50000,
  ));

  // Decode the base64 transaction Jupiter built. It is unsigned: the
  // compiled message and an empty signature slot for the fee payer.
  final txBytes = base64Decode(swap.swapTransaction);
  final tx = SignedTx.fromBytes(txBytes);

  // Sign the compiled message with the local keypair and place the
  // signature in the fee payer slot, then re-serialize.
  final messageBytes = tx.compiledMessage.toByteArray().toList();
  final signature = await wallet.sign(messageBytes);
  final signed = SignedTx(
    compiledMessage: tx.compiledMessage,
    signatures: [signature],
  );

  final sig = await rpc.sendTransaction(
    signed.encode(),
    preflightCommitment: Commitment.confirmed,
  );
  return sig;
}
```

### Full QuoteRequestDto with every parameter

```dart
import 'package:jupiter_aggregator/jupiter_aggregator.dart';

const quote = QuoteRequestDto(
  inputMint: 'So11111111111111111111111111111111111111112',
  outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  amount: 1000000000,                // smallest unit of the input token
  slippageBps: 50,                   // 0.5%, 1 bps = 0.01%
  swapMode: SwapMode.exactIn,        // or SwapMode.exactOut
  onlyDirectRoutes: false,           // true = single hop only
  asLegacyTransaction: false,        // true = no versioned tx
  autoSlippage: true,                // Jupiter computes optimal slippage
  maxAutoSlippageBps: 300,           // cap auto slippage at 3%
  platformFeeBps: 25,                // your platform fee (0.25%)
  maxAccounts: 64,                   // transaction account limit
  restrictIntermediateTokens: true,  // only well-known intermediaries
);
```

`SwapMode.exactIn` means `amount` is the exact input and the output varies. This is the common case. `SwapMode.exactOut` means `amount` is the exact desired output and the input varies.

### Reading a multi-hop route

`quote.routePlan` is a `List<RoutePlan>`. Each hop carries its DEX label, mints, amounts, and fee.

```dart
import 'package:jupiter_aggregator/jupiter_aggregator.dart';

void describeRoute(QuoteResponseDto quote) {
  print('in:  ${quote.inAmount} of ${quote.inputMint}');
  print('out: ${quote.outAmount} of ${quote.outputMint}');
  print('min out after slippage: ${quote.otherAmountThreshold}');

  for (final step in quote.routePlan) {
    print('${step.percent}% via ${step.swapInfo.label}');
    print('  ${step.swapInfo.inAmount} -> ${step.swapInfo.outAmount}');
    print('  fee ${step.swapInfo.feeAmount} of ${step.swapInfo.feeMint}');
    print('  pool ${step.swapInfo.ammKey}');
  }
}
```

### Fetching token prices with caching

The Price client batches token IDs into one call (the `ids` param is comma-joined) and caches the result. It also handles Jupiter sometimes returning JSON as a raw string instead of a parsed object.

```dart
import 'package:jupiter_aggregator/jupiter_aggregator.dart';

Future<double?> fetchSolPrice() async {
  final priceClient = JupiterPriceClient();

  final response = await priceClient.getPrice(PriceRequestDto(
    ids: [
      'So11111111111111111111111111111111111111112',  // SOL
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    ],
  ));

  // PriceDto.price is a nullable String. Null-check before parsing.
  final raw = response.data['So11111111111111111111111111111111111111112']?.price;
  if (raw == null) return null;
  return double.tryParse(raw);
}
```

For a cached client, annotate the Retrofit interface so repeat reads hit the Dio cache instead of hammering Jupiter on fast UI rebuilds.

```dart
import 'package:injectable/injectable.dart';
import 'package:retrofit/retrofit.dart';
import 'package:jupiter_aggregator/jupiter_aggregator.dart';

@injectable
@RestApi(baseUrl: 'https://api.jup.ag')
abstract class CachedJupiterPriceClient {
  @factoryMethod
  factory CachedJupiterPriceClient(DioCacheClient client) =>
      _CachedJupiterPriceClient(client.dio);

  @GET('/price/v2')
  @Extra({maxAgeOption: Duration(minutes: 1)})
  Future<PriceResponseDto> getPrice(@Queries() PriceRequestDto request);
}
```

### Backend-proxied swap with slippage tiers

In production, proxy swaps through your backend to keep API keys server-side, add platform fees without exposing the logic, co-sign for gasless swaps, and rate-limit requests. These are the simplified proxy DTOs from Espresso Cash. `SwapSlippage` is a pre-defined tier enum, not a raw bps value.

```dart
import 'package:freezed_annotation/freezed_annotation.dart';

part 'swap_route_dto.freezed.dart';

@freezed
class SwapRouteRequestDto with _$SwapRouteRequestDto {
  const factory SwapRouteRequestDto({
    required String inputToken,
    required String outputToken,
    required String amount,
    required SwapSlippage slippage,   // pre-defined tier
    required String userAccount,
  }) = _SwapRouteRequestDto;
}

@freezed
class SwapRouteResponseDto with _$SwapRouteResponseDto {
  const factory SwapRouteResponseDto({
    required String inAmount,
    required String outAmount,
    required String encodedTx,        // ready-to-sign transaction
    required int feeInUsdc,
  }) = _SwapRouteResponseDto;
}
```

### JupiterSwapRequestDto with dynamic slippage

```dart
import 'package:jupiter_aggregator/jupiter_aggregator.dart';

JupiterSwapRequestDto buildSwapRequest(
  String walletAddress,
  QuoteResponseDto quote,
) {
  return JupiterSwapRequestDto(
    userPublicKey: walletAddress,
    quoteResponse: quote,                  // pass the ENTIRE quote object
    wrapAndUnwrapSol: true,                // auto wrap and unwrap SOL to wSOL
    useSharedAccounts: true,               // Jupiter shared ATAs, saves rent
    computeUnitPriceMicroLamports: 50000,  // priority fee
    dynamicComputeUnitLimit: true,         // Jupiter sets optimal CU
    dynamicSlippage: DynamicSlippage(      // server-side slippage optimization
      minBps: 10,
      maxBps: 300,
    ),
  );
}
```

The response is a `JupiterSwapResponseDto`. Read `swap.swapTransaction` (base64 unsigned tx), `swap.lastValidBlockHeight` (block height expiry), `swap.prioritizationFeeLamports` (applied priority fee), and `swap.dynamicSlippageReport` (actual slippage if dynamic).

## Guidelines

- DO multiply by `10^decimals` for `amount`. 1 SOL is `1000000000`, 1 USDC is `1000000`. The field is in the input token's smallest unit, never whole tokens.
- DO fetch a fresh quote immediately before `getSwapTransactions`. A stale quote fails with an expired blockhash.
- DO pass the entire `quoteResponse` object to `JupiterSwapRequestDto`. The swap endpoint needs the full `QuoteResponseDto`, not hand-picked fields.
- DO parse `priceImpactPct` to a double and warn above 1%, block or hard-warn above 5%.
- DO null-check `PriceDto.price`. It is a `String?` and is null for unlisted tokens.
- DO set a priority fee (`computeUnitPriceMicroLamports` or `prioritizationFeeLamports`) so swaps land.
- DON'T expose your Jupiter API key in client code. Route swap calls through a backend proxy. Only price lookups should go direct from the client.
- DON'T hardcode one slippage for all pairs. Use `autoSlippage: true` with `maxAutoSlippageBps`, or tune per token volatility.
- DON'T cache quotes. Cache prices for at least a minute, but always re-quote before swapping.

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| Output far smaller than expected | `amount` passed in whole tokens, not smallest unit | Multiply by `10^decimals`, 1 SOL = `1000000000` |
| Transaction failed, blockhash expired | Reusing a stale quote for the swap | Fetch a fresh quote right before `getSwapTransactions` |
| Swap endpoint rejects the request | Hand-picked fields sent instead of the full quote | Pass the entire `quoteResponse` object |
| User loses value on an illiquid swap | `priceImpactPct` ignored | Parse the String to double, warn above 1%, block above 5% |
| Swap fails on a volatile token | One hardcoded slippage for all pairs | Use `autoSlippage: true` with `maxAutoSlippageBps` |
| Swap lands slowly or drops | No priority fee set | Set `computeUnitPriceMicroLamports` or `prioritizationFeeLamports` |
| API key leaked from the app | Swap called directly from the client | Move swap calls behind a backend proxy |
| Crash parsing a token price | `PriceDto.price` parsed as non-nullable | It is `String?`, null-check before `double.tryParse` |

## References

- jupiter_aggregator source (Espresso Cash monorepo): https://github.com/espresso-cash/espresso-cash-public/tree/master/packages/jupiter_aggregator
- Jupiter developer docs: https://dev.jup.ag
- solana Dart SDK: https://pub.dev/packages/solana
- Re-verify the Jupiter endpoint hosts (`quote-api.jup.ag/v6` and `api.jup.ag/price/v2`) against current Jupiter docs before shipping. Jupiter has migrated its API surface and host names and versions can change.
- Related skills in this set: solana-dart-sdk, building-solana-transactions-flutter, solana-mobile-wallet-adapter-flutter

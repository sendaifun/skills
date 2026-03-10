# Manifest Troubleshooting Guide

Common issues and solutions when integrating with the Manifest SDK.

## Setup And Account Errors

### "Read only"

**Cause:** A write method was called on a read-only client, or the client was created without wrapper/payer context.

**Solution:**

```typescript
const setup = await ManifestClient.getSetupIxs(
  connection,
  marketPk,
  walletPublicKey
);

if (setup.setupNeeded) {
  // execute setup first, then create the wallet-aware client
}

const client = await ManifestClient.getClientForMarketNoPrivateKey(
  connection,
  marketPk,
  walletPublicKey
);
```

For signer-controlled scripts and bots, use `getClientForMarket(...)` instead.

### Setup still required

**Cause:** Wrapper creation and/or market seat claim has not been completed yet.

**Solution:**

- Call `ManifestClient.getSetupIxs(...)`
- Execute the returned setup instructions
- If `wrapperKeypair` is returned, partially sign the transaction with it
- Only then call `getClientForMarketNoPrivateKey(...)`

### Missing market seat behavior

**Cause:** Market-local flows require a trader seat on the market, but the wallet has not claimed one yet.

**Solution:**

Use the `getSetupIxs(...)` path. Do not assume seat existence from wallet connection alone.

## Global Account Errors

### Global order funded incorrectly

**Cause:** `OrderType.Global` was used without a funded global account for the supporting token.

**Solution:**

```typescript
const addTraderIx = await ManifestClient.createGlobalAddTraderIx(
  trader.publicKey,
  mint
);

const depositIx = await ManifestClient.globalDepositIx(
  connection,
  trader.publicKey,
  mint,
  100
);
```

After setup and deposit, place the order with `OrderType.Global`.

### Market-local balance confusion

**Cause:** Local deposited balances and global balances are being treated as interchangeable.

**Solution:**

- Market-local orders depend on wrapper balances on that market
- Global orders depend on token-level global balances
- Keep those two accounting paths separate in application logic

## Order Management Errors

### Reverse/global orders remain after cancel-all

**Cause:** `cancelAllIx()` is wrapper-based and does not fully clean up all core-level reverse/global edge cases.

**Solution:**

Use `cancelAllOnCoreIx()` when full cleanup is required.

### Unexpected orderbook display values

**Cause:** UI code is using raw orderbook helpers when display-ready levels were intended.

**Solution:**

Use:

```typescript
await client.market.reload(connection);
const bids = client.market.bidsL2();
const asks = client.market.asksL2();
```

Prefer `bidsL2()` / `asksL2()` for UI and price-display flows.

## Integration Advice

- Use `Market.loadFromAddress(...)` or `getClientReadOnly(...)` for read-only pages
- Use `getSetupIxs(...)` for wallet-adapter flows
- Use `getClientForMarket(...)` for signer-controlled automation
- Use `placeOrderWithRequiredDepositIxs(...)` when you want the SDK to help calculate missing funding for a local or global order

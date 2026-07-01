# Troubleshooting the classic `@solana/wallet-adapter` stack

The exhaustive error catalog for the classic Anza wallet-adapter (`@solana/wallet-adapter-*`,
web3.js v1). SKILL.md keeps the six headline errors; this is the full reference. Each entry is
**symptom → root cause → exact fix**, with the precise class/package so you know where the type
actually lives (several are commonly attributed to the wrong package).

Format: `### Error` / **Cause** / **Solution**.

---

### Error: `WalletNotConnectedError`
**Cause:** you called `sendTransaction` / `signMessage` / `signTransaction` / etc. while
`publicKey` is `null` (no wallet connected). The class is exported from
**`@solana/wallet-adapter-base`** (`errors.ts`).
**Solution:** guard before acting, and disable the action button until `connected`:

```ts
import { WalletNotConnectedError } from '@solana/wallet-adapter-base';
const { publicKey, connected, sendTransaction } = useWallet();
if (!publicKey) throw new WalletNotConnectedError();
// <button disabled={!connected}>…</button>
```

---

### Error: `WalletNotSelectedError`
**Cause:** an operation requires a *selected* wallet but none is chosen — e.g. calling
`connect()` / `sendTransaction` before `select(walletName)` or before the user picks a wallet in
the modal. The class is exported from **`@solana/wallet-adapter-react`** (NOT `-base`);
`name === 'WalletNotSelectedError'`.
**Solution:** open the modal or select a wallet first, and ensure `WalletModalProvider` wraps the
tree:

```ts
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
const { setVisible } = useWalletModal();
setVisible(true);            // let the user pick a wallet
// or: const { select } = useWallet(); select('Phantom' as WalletName);
```

---

### Error: user rejection — `WalletSignTransactionError` / `WalletSignMessageError` / `WalletConnectionError`
**Cause:** the user declined the request in the wallet. The adapter wraps the wallet's underlying
error; Phantom/Solflare surface the provider code **`4001`** ("User rejected the request"). All
three wrapper classes are from `@solana/wallet-adapter-base` and extend `WalletError`.
**Solution:** catch it, treat it as **non-fatal**, and do **not** auto-retry. Detect by code
(preferred) or message:

```ts
try {
  await sendTransaction(tx, connection, { minContextSlot });
} catch (err: any) {
  if (err?.code === 4001 || /user rejected/i.test(err?.message ?? '')) {
    // soft "request cancelled" state — do not retry, do not log as an error
    return;
  }
  throw err;
}
```

Centralize this via `WalletProvider`'s `onError?: (error: WalletError, adapter?) => void` prop.

---

### Error: `window is not defined` (SSR) / React hydration mismatch
**Cause:** wallet/provider code executed during Next.js SSR or prerender, **or**
`WalletMultiButton` was server-rendered. Its label is derived from `localStorage['walletName']`,
so the server prints "Select Wallet" and the client swaps it → a hydration mismatch. Reading
`window`/`localStorage` at module top level throws `window is not defined` outright.
**Solution:** keep the whole provider subtree behind a `'use client'` boundary, and import
`WalletMultiButton` **client-only** with `dynamic(..., { ssr: false })`:

```tsx
'use client';
import dynamic from 'next/dynamic';

export const WalletMultiButtonDynamic = dynamic(
  async () => (await import('@solana/wallet-adapter-react-ui')).WalletMultiButton,
  { ssr: false },
);
```

Never read `window`/`localStorage` at module top level. Full walkthrough:
[docs/nextjs-app-router.md](nextjs-app-router.md).

---

### Error: `"signMessage is not a function"` (also `signIn` / `signTransaction` / `signAllTransactions`)
**Cause:** you called an **optional** signing method without feature-detecting. On
`WalletContextState`, only `sendTransaction` is guaranteed present; `signTransaction`,
`signAllTransactions`, `signMessage`, and `signIn` are `| undefined` and are absent on wallets
that lack that feature.
**Solution:** guard before every call:

```ts
const { signMessage } = useWallet();
if (!signMessage) throw new Error('This wallet does not support message signing');
const sig = await signMessage(new TextEncoder().encode('Hello Solana'));
```

Same pattern for `signIn` (SIWS — see [docs/siws-and-auth.md](siws-and-auth.md)),
`signTransaction`, and `signAllTransactions`.

---

### Error: `Cannot destructure property 'publicKey' of 'useWallet(...)'` / `WalletContext` is undefined
**Cause:** the component calling `useWallet()` / `useConnection()` is rendered **outside** the
provider tree, so the context is its default `undefined`.
**Solution:** ensure the component is a descendant of `ConnectionProvider` → `WalletProvider` →
`WalletModalProvider`. In the App Router, that means it must live inside the `'use client'`
provider subtree (not in a Server Component that renders a sibling). Verify the provider order —
the modal needs both the connection and wallet contexts above it.

---

### Error: "Wallet doesn't support versioned transactions" / a v0 tx is rejected
**Cause:** you built a `VersionedTransaction` (v0) for a wallet whose
`adapter.supportedTransactionVersions` is `undefined` (legacy-only) or does not include `0`.
**Solution:** feature-gate on the capability set before building a v0 message; fall back to a
legacy `Transaction`:

```ts
const { wallet } = useWallet();
const supported = wallet?.adapter.supportedTransactionVersions; // Set<TransactionVersion> | undefined
if (!supported?.has(0)) {
  // build a legacy Transaction instead, or tell the user to use a v0-capable wallet
  throw new Error("Wallet doesn't support v0 transactions");
}
```

More on v0 building (address-lookup tables, extra co-signers):
[docs/sending-transactions.md](sending-transactions.md).

---

### Error: the connect modal / button renders unstyled (raw, no theme)
**Cause:** the react-ui stylesheet was never imported. The components ship with CSS you must
include once.
**Solution:** import it exactly — the `package.json` `exports` map only exposes this path:

```ts
import '@solana/wallet-adapter-react-ui/styles.css';
```

Import it once (in the provider module or root layout). To theme, override the `.wallet-adapter-*`
CSS classes, or drop to the headless `useWalletMultiButton` hook from
`@solana/wallet-adapter-base-ui` and bring your own markup.

---

### Error: `autoConnect` never reconnects the wallet on reload
**Cause:** several possibilities, most benign:
- The `autoConnect` prop is not set — its **default is `false`**.
- **First-time user:** there is no wallet name in `localStorage['walletName']` yet, so the
  silent auto-connect has nothing to reconnect. Auto-connect **never pops a wallet dialog** for a
  first-time user — by design it only silently re-authorizes a previously-approved wallet.
- The remembered wallet is not installed/registered yet on this load (extension slow to inject).
- A custom `localStorageKey` was used inconsistently between renders.
**Solution:** set `autoConnect` on `WalletProvider`; connect the wallet once so its name is
persisted; keep `localStorageKey` consistent. Remember: `autoConnect` reconnecting silently is
the *expected* behavior — it is not meant to prompt a fresh user. For one-click sign-in on load,
pass the `autoConnect` **predicate** and drive SIWS from it
([docs/siws-and-auth.md](siws-and-auth.md)).

```tsx
<WalletProvider wallets={[]} autoConnect>{children}</WalletProvider>
```

---

### Error: the same wallet appears twice in the connect modal
**Cause:** you hand-listed a legacy adapter (e.g. `new PhantomWalletAdapter()`) **and** the same
wallet auto-registered through the Wallet Standard. `WalletProvider` de-duplicates by name, but a
mismatched or non-standard adapter can slip through and duplicate the entry.
**Solution:** pass `wallets={[]}` and rely on Wallet Standard auto-registration. Only add
adapters for wallets that have **not** adopted the Standard, or dev-only adapters
(`UnsafeBurnerWalletAdapter`, WalletConnect). Do **not** list Phantom/Solflare/Backpack manually.

---

### Error: connecting to Mobile Wallet Adapter (MWA) works once, then re-prompts every time / loses authorization
**Cause:** something is calling `disconnect()` on the MWA adapter. Disconnecting MWA **wipes its
authorization cache**, so the next connect requires a fresh in-wallet approval. `WalletProvider`
special-cases this — selecting a *different* wallet does not disconnect MWA — but an explicit
`disconnect()` in your code does.
**Solution:** avoid calling `disconnect()` on MWA casually. Let the provider manage MWA lifecycle;
only disconnect when the user explicitly signs out. Note MWA is auto-injected only on **Android
mobile web** (no iOS MWA at the protocol level). See [docs/mobile.md](mobile.md).

---

### Error: `WalletConnectionError` on connect with no user rejection
**Cause:** the wallet failed to connect for a non-user reason — extension locked, wrong network,
a blocked popup (`WalletWindowBlockedError` / `WalletWindowClosedError`), or a wallet that is
present but in a bad state (`readyState !== 'Installed'`).
**Solution:** check `wallet?.readyState` before connecting (`'Installed' | 'Loadable'` are
connectable; `'NotDetected' | 'Unsupported'` are not), surface a "unlock your wallet / allow
popups" hint, and route all connect errors through `WalletProvider onError` for consistent UX.

---

### Error: transaction "sent" but never confirms / `TransactionExpiredBlockheightExceededError`
**Cause:** `sendTransaction` signs **and broadcasts**, but wallet-adapter delegates the actual
send to the wallet's RPC. If you confirm against a stale blockhash, or the wallet used a lagging
RPC node, confirmation can time out.
**Solution:** always fetch a fresh blockhash with `getLatestBlockhashAndContext`, pass
`minContextSlot` through `sendTransaction`, and confirm with the matching
`{ blockhash, lastValidBlockHeight, signature }`:

```ts
const { context: { slot: minContextSlot }, value: { blockhash, lastValidBlockHeight } } =
  await connection.getLatestBlockhashAndContext();
const signature = await sendTransaction(tx, connection, { minContextSlot });
await connection.confirmTransaction({ blockhash, lastValidBlockHeight, signature });
```

For priority fees, robust rebroadcast, and confirmation strategy, cross-link the
**transaction-landing** skill — those concerns still apply even though the wallet does the send.

---

### Error: `Module not found` / Node polyfill errors (`Buffer`, `crypto`, `stream`) at build time
**Cause:** a wallet dependency pulled Node built-ins into a bundle where they were not expected
(older bundler configs, or wallet code leaking into the server bundle).
**Solution:** keep all wallet-adapter code behind `'use client'` and the button behind
`ssr:false`. With modern Next.js (App Router) you generally do **not** need manual `fallback`
polyfills — isolating the code to the client bundle avoids the Node-built-in resolution entirely.
See [docs/nextjs-app-router.md](nextjs-app-router.md).

---

## Related references

- Provider setup, hooks, and UI component surface: [resources/api-reference.md](../resources/api-reference.md)
- SIWS / `signMessage` auth and server verification: [docs/siws-and-auth.md](siws-and-auth.md)
- Next.js App Router SSR specifics: [docs/nextjs-app-router.md](nextjs-app-router.md)
- Sending transactions (legacy + v0): [docs/sending-transactions.md](sending-transactions.md)
- Wallet Adapter FAQ (upstream): https://github.com/anza-xyz/wallet-adapter/blob/master/FAQ.md

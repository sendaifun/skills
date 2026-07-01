# API reference — classic `@solana/wallet-adapter`

Exhaustive type/signature lookup for the classic stack (web3.js v1). This is the reference behind
the SKILL.md "Provider setup", "`useWallet()` and `useConnection()`", and "UI components"
sections — pure lookup, no tutorial. Signatures are verified against the published `.d.ts` for the
pinned versions (`-react@0.15.39`, `-base@0.9.27`, `-react-ui@0.9.39`, `-base-ui@0.1.6`).

For install pins, peer deps, download reality, and the Kit version-skew matrix, see the
**Packages + versions** section at the bottom of this file. For the modern (Kit) hook surface,
see [docs/modern-stack.md](../docs/modern-stack.md).

---

## Hooks (`@solana/wallet-adapter-react@0.15.39`)

### `useWallet(): WalletContextState`

```ts
interface Wallet {
  adapter: Adapter;
  readyState: WalletReadyState;
}

interface WalletContextState {
  autoConnect: boolean;
  wallets: Wallet[];            // all available wallets (Standard + provided), each with readyState
  wallet: Wallet | null;        // currently selected wallet
  publicKey: PublicKey | null;  // connected account; null until connected
  connecting: boolean;
  connected: boolean;
  disconnecting: boolean;

  select(walletName: WalletName | null): void;  // choose by branded name; does not connect by itself
  connect(): Promise<void>;
  disconnect(): Promise<void>;

  // Signing — ONLY sendTransaction is guaranteed present. The rest are `| undefined`.
  sendTransaction: WalletAdapterProps['sendTransaction'];                    // ALWAYS present
  signTransaction?:     SignerWalletAdapterProps['signTransaction'];          // optional — feature-detect
  signAllTransactions?: SignerWalletAdapterProps['signAllTransactions'];      // optional — feature-detect
  signMessage?:         MessageSignerWalletAdapterProps['signMessage'];       // optional — feature-detect
  signIn?:              SignInMessageSignerWalletAdapterProps['signIn'];       // optional — feature-detect (SIWS)
}

const WalletContext: React.Context<WalletContextState>;
function useWallet(): WalletContextState;
```

Correctness notes:

- **Feature-detect** `signTransaction` / `signAllTransactions` / `signMessage` / `signIn` before
  calling — they are `undefined` on wallets lacking that feature. Only `sendTransaction` is
  guaranteed. This is the #1 `"… is not a function"` bug.
- `select(name)` sets the active wallet; it connects only if `autoConnect` is on, otherwise call
  `connect()`.
- Each `wallets[i]` carries `readyState` so you can sort installed wallets first.

### `useConnection(): { connection: Connection }`

```ts
interface ConnectionContextState { connection: Connection; }  // web3.js v1 Connection
function useConnection(): ConnectionContextState;             // const { connection } = useConnection();
```

### `useAnchorWallet(): AnchorWallet | undefined`

For building an Anchor `AnchorProvider`. Returns `undefined` until a signing wallet connects.

```ts
interface AnchorWallet {
  publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]>;
}
function useAnchorWallet(): AnchorWallet | undefined;
```

### `useWalletModal(): { visible, setVisible }` (from `@solana/wallet-adapter-react-ui`)

```ts
interface WalletModalContextState {
  visible: boolean;
  setVisible(open: boolean): void;
}
function useWalletModal(): WalletModalContextState;  // open/close the connect modal programmatically
```

---

## `WalletReadyState` enum (`@solana/wallet-adapter-base`)

```ts
enum WalletReadyState {
  Installed   = 'Installed',    // wallet detected (injected API present) → connectable
  NotDetected = 'NotDetected',  // not present on this page
  Loadable    = 'Loadable',     // always available (e.g. loaded on demand) → connectable
  Unsupported = 'Unsupported',  // cannot be used in this environment
}
```

Use `wallet?.readyState` to decide whether to offer connect: `Installed` / `Loadable` are
connectable; `NotDetected` / `Unsupported` are not.

---

## Provider props

### `ConnectionProvider` (`@solana/wallet-adapter-react`)

```ts
interface ConnectionProviderProps {
  children: ReactNode;
  endpoint: string;            // RPC URL
  config?: ConnectionConfig;   // web3.js ConnectionConfig, e.g. { commitment: 'confirmed', wsEndpoint, httpHeaders }
}
```

### `WalletProvider` (`@solana/wallet-adapter-react`)

```ts
interface WalletProviderProps {
  children: ReactNode;
  wallets: Adapter[];          // legacy/non-standard + dev adapters; pass [] to rely on Wallet Standard auto-registration
  autoConnect?: boolean | ((adapter: Adapter) => Promise<boolean>); // predicate → false means "I handled auth (SIWS)"
  localStorageKey?: string;    // default 'walletName' — where the selected wallet name is persisted
  onError?: (error: WalletError, adapter?: Adapter) => void;         // central error handling
}
```

- `autoConnect` as a **predicate** is the one-click SIWS hook: return `false` to skip the default
  silent reconnect because you authenticated via `signIn`. See
  [docs/siws-and-auth.md](../docs/siws-and-auth.md).
- The selected wallet name persists to `localStorage[localStorageKey]` so the session survives
  reloads.

### `WalletModalProvider` (`@solana/wallet-adapter-react-ui`)

```ts
interface WalletModalProviderProps extends WalletModalProps {
  children: ReactNode;
}
// WalletModalProps controls modal chrome: className, container, etc.
```

Provider nesting order is fixed: `ConnectionProvider` → `WalletProvider` → `WalletModalProvider`
(the modal needs both contexts above it).

---

## Signing signatures (`@solana/wallet-adapter-base@0.9.27`)

```ts
interface SendTransactionOptions extends SendOptions {  // SendOptions: skipPreflight,
  signers?: Signer[];                                   //   preflightCommitment, maxRetries, minContextSlot
}

// WalletAdapterProps — always present. Signs AND broadcasts; returns the signature string.
sendTransaction(
  transaction: Transaction | VersionedTransaction,   // legacy or v0
  connection: Connection,
  options?: SendTransactionOptions,
): Promise<TransactionSignature>;

// SignerWalletAdapterProps — optional on the hook (feature-detect).
signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]>;

// MessageSignerWalletAdapterProps — optional.
signMessage(message: Uint8Array): Promise<Uint8Array>;   // 64-byte Ed25519 signature

// SignInMessageSignerWalletAdapterProps — optional (SIWS).
signIn(input?: SolanaSignInInput): Promise<SolanaSignInOutput>;
```

Capability gate for versioned transactions (v0) lives on the adapter:

```ts
wallet.adapter.supportedTransactionVersions: Set<TransactionVersion> | undefined;
// gate: if (!wallet.adapter.supportedTransactionVersions?.has(0)) throw …
```

### SIWS I/O types (`@solana/wallet-standard-features@1.4.0`)

```ts
// All input fields optional strings (resources is readonly string[]).
interface SolanaSignInInput {
  domain?: string; address?: string; statement?: string; uri?: string; version?: string;
  chainId?: string; nonce?: string; issuedAt?: string; expirationTime?: string;
  notBefore?: string; requestId?: string; resources?: readonly string[];
}

interface SolanaSignInOutput {
  account: WalletAccount;      // account.publicKey is a Uint8Array
  signedMessage: Uint8Array;   // exact bytes the wallet built + signed (ABNF)
  signature: Uint8Array;       // Ed25519
  signatureType?: 'ed25519';
}
```

Field rules, ABNF layout, and server verification (`verifySignIn` from
`@solana/wallet-standard-util@1.1.3`): [docs/siws-and-auth.md](../docs/siws-and-auth.md).

---

## UI components (`@solana/wallet-adapter-react-ui@0.9.39`)

| Export | Type | Purpose |
|---|---|---|
| `WalletMultiButton` | `FC<ButtonProps>` | All-in-one: "Select Wallet" → modal → connected address + dropdown (copy / change / disconnect). Use 95% of the time. |
| `WalletModalButton` | `FC<ButtonProps>` | Opens the connect modal only; pair with your own connected-state UI. |
| `WalletConnectButton` | `FC<ButtonProps>` | Connects the selected wallet. |
| `WalletDisconnectButton` | `FC<ButtonProps>` | Disconnects. |
| `WalletModal` / `WalletModalProvider` | component / provider | The connect modal + its context provider. |
| `useWalletModal` | hook | `{ visible, setVisible }` — open/close the modal programmatically. |
| `WalletIcon` | component | Renders a wallet's icon. |
| `BaseWalletMultiButton`, `BaseWalletConnectButton`, `BaseWalletDisconnectButton` | components | Themeable base versions of the buttons. |

`WalletMultiButton` accepts standard `ButtonProps` plus a `labels` override map keyed by state:

```ts
'copy-address' | 'copied' | 'change-wallet' | 'disconnect' | 'has-wallet' | 'no-wallet' | 'connecting' | 'connected'
```

CSS (required once — exact path from the package `exports` map):

```ts
import '@solana/wallet-adapter-react-ui/styles.css';
```

### Headless hooks (`@solana/wallet-adapter-base-ui@0.1.6`) — build your own button, no CSS

```ts
function useWalletMultiButton({ onSelectWallet }): {
  buttonState: 'connecting' | 'connected' | 'disconnecting' | 'has-wallet' | 'no-wallet';
  onConnect?: () => void;
  onDisconnect?: () => void;
  onSelectWallet?: () => void;
  publicKey?: PublicKey;
  walletIcon?: string;
  walletName?: WalletName;
};

// also exported:
function useWalletConnectButton(): { buttonState; onConnect?; walletIcon?; walletName? };
function useWalletDisconnectButton(): { buttonState; onDisconnect?; walletIcon?; walletName? };
```

Runnable custom button: [examples/custom-wallet-button.tsx](../examples/custom-wallet-button.tsx).

---

## `Wallet*Error` classes

All extend `WalletError` (which extends `Error` and carries an `error: any` cause). Match by
`error.name` or `instanceof`. **Location matters** — `WalletNotSelectedError` is the only one in
the react package, not base.

### `@solana/wallet-adapter-base@0.9.27` (`errors.ts`)

| Class | Typical cause |
|---|---|
| `WalletError` | Base class for all of the below. |
| `WalletNotReadyError` | Wallet not in a connectable `readyState`. |
| `WalletLoadError` | Adapter failed to load. |
| `WalletConfigError` | Adapter misconfigured. |
| `WalletConnectionError` | Connect failed (non-user reason). |
| `WalletDisconnectedError` | Wallet became disconnected mid-session. |
| `WalletDisconnectionError` | Disconnect failed. |
| `WalletAccountError` | Could not read the account. |
| `WalletPublicKeyError` | Could not read the public key. |
| `WalletKeypairError` | Keypair-related failure. |
| `WalletNotConnectedError` | Action attempted while `publicKey` is `null`. |
| `WalletSendTransactionError` | `sendTransaction` failed. |
| `WalletSignTransactionError` | Sign-transaction failed / rejected (user code `4001`). |
| `WalletSignMessageError` | Sign-message failed / rejected (user code `4001`). |
| `WalletSignInError` | SIWS `signIn` failed / rejected. |
| `WalletTimeoutError` | Operation timed out. |
| `WalletWindowBlockedError` | Wallet popup blocked by the browser. |
| `WalletWindowClosedError` | User closed the wallet popup. |

### `@solana/wallet-adapter-react@0.15.39` (`errors.ts`)

| Class | Cause |
|---|---|
| `WalletNotSelectedError` | An operation needs a selected wallet but none is chosen. `name === 'WalletNotSelectedError'`. |

Cause/solution playbook for the common ones: [docs/troubleshooting.md](../docs/troubleshooting.md).

---

## Packages + versions

### Classic stack (web3.js v1) — verified pins

| Package | Version | Role |
|---|---|---|
| `@solana/wallet-adapter-base` | **0.9.27** | Adapter/signer interfaces, `Wallet*Error`, `WalletReadyState`, `WalletAdapterNetwork`. |
| `@solana/wallet-adapter-react` | **0.15.39** | `ConnectionProvider`, `WalletProvider`, `useWallet`, `useConnection`, `useAnchorWallet`, `WalletNotSelectedError`. |
| `@solana/wallet-adapter-react-ui` | **0.9.39** | `WalletMultiButton`, `WalletModalProvider`, `useWalletModal`, `styles.css`. |
| `@solana/wallet-adapter-base-ui` | **0.1.6** | Headless button hooks (`useWalletMultiButton`, …). |
| `@solana/wallet-adapter-wallets` | **0.19.38** | Legacy adapter bundle (`UnsafeBurnerWalletAdapter`, WalletConnect, …) — mostly unneeded. |
| `@solana-mobile/wallet-adapter-mobile` | **2.2.9** | `SolanaMobileWalletAdapter` (classic MWA; auto-injected on mobile web). |
| `@solana/wallet-standard-wallet-adapter-react` | **1.1.5** | `useStandardWalletAdapters()` — auto-registers Standard wallets. |
| `@solana/wallet-standard-wallet-adapter-base` | **1.1.5** | `StandardWalletAdapter` wrapper. |
| `@wallet-standard/core` | **1.1.2** | `getWallets()` discovery registry + base types. |
| `@solana/wallet-standard-features` | **1.4.0** | `SolanaSignIn`, `SolanaSignInInput/Output`, other Solana feature types. |
| `@solana/wallet-standard-util` | **1.1.3** | `verifySignIn`, `createSignInMessage(Text)`, `verifyMessageSignature`. |
| `@solana/web3.js` | **1.98.4** | The v1 client the classic stack's types reference (peer dep `^1.98.0`). |

Peer deps: all wallet-adapter packages peer `@solana/web3.js@^1.98.0` and `react: "*"` (works with
**React 18 and 19**). The classic stack has **not** migrated to `@solana/kit`.

### Modern stack (Kit) — for greenfield apps (label: current-recommended)

| Package | Version | Role | Pins Kit |
|---|---|---|---|
| `@solana/kit` | **7.0.0** | Modern client/RPC/tx/signers (ex-web3.js v2). | — |
| `@solana/react` | **7.0.0** | Low-level Kit hooks (`useSignIn`, `useSignAndSendTransaction`, `useWalletAccountTransactionSendingSigner`). | **v7** |
| `@solana/client` | **1.7.0** | framework-kit client (`createClient`, `autoDiscover`, connectors). | v5 (transitive) |
| `@solana/react-hooks` | **1.4.1** | framework-kit React provider + hooks (`SolanaProvider`, `useWalletConnection`). | v5 (transitive) |
| `@solana/connector` | **0.2.4** | ConnectorKit — headless Wallet Standard connector (used by `@solana/client`). | — |
| `@wallet-ui/react` | **4.2.0** | Drop-in connect UI (`WalletUi`, `WalletUiDropdown`, `useWalletUiAuth`). | **v6** |
| `@wallet-ui/core` | **4.2.0** | Framework-agnostic state + cluster factories. | — |
| `gill` | **0.14.0** | Kit-compatible client (RPC/tx) — **not** a wallet connector. | — |
| `@gillsdk/react` | **0.7.0** | React-Query data hooks over gill — no wallet connect. | — |
| `@solana-mobile/wallet-standard-mobile` | **0.5.3** | `registerMwa(...)` — MWA as a Wallet Standard wallet (+ desktop QR). | — |
| `create-solana-dapp` | **4.8.5** | Official scaffolder (Kit templates ship framework-kit). | — |

> **Version-skew warning:** the three modern React layers each pin a *different* Kit generation
> — framework-kit → Kit **v5** (transitive), `@wallet-ui/react` 4.2 → Kit **v6**, `@solana/react`
> 7 → Kit **v7**. Installing `@solana/kit@7` directly *alongside* framework-kit yields **two Kit
> copies**. Pin exact versions and don't mix layers. Full narrative + download reality:
> [docs/modern-stack.md](../docs/modern-stack.md).

---

## See also

- Provider setup, hooks, UI walkthrough: [SKILL.md](../SKILL.md)
- SIWS + `signMessage` auth: [docs/siws-and-auth.md](../docs/siws-and-auth.md)
- Error playbook: [docs/troubleshooting.md](../docs/troubleshooting.md)
- Modern Kit hook surface: [docs/modern-stack.md](../docs/modern-stack.md)
- Version matrix + peer deps + skew: the **Packages + versions** section above
- Upstream `.d.ts`: https://unpkg.com/@solana/wallet-adapter-react@0.15.39/lib/types/ ·
  https://unpkg.com/@solana/wallet-adapter-base@0.9.27/lib/types/

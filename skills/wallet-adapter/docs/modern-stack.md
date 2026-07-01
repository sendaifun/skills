# Modern / Current-Recommended Wallet Stack (Wallet Standard + Kit)

The long form of SKILL.md's "Modern / current-recommended path" and the "Which stack?" table.
This is the path to reach for in a **greenfield** app already on `@solana/kit` — it drops the
monolithic `useWallet()` in favour of Wallet Standard-native hooks that operate on
`UiWalletAccount` handles and produce Kit signers directly.

Three important framings up front, all verified against the mid-2026 registry:

- **There is no single "official" modern React wallet library that has won.** The Solana
  Foundation ships a high-level one (framework-kit), Anza ships low-level hooks in Kit
  (`@solana/react`), and the community ships a drop-in UI (`@wallet-ui/react`). All three are
  legitimate. Pick by ergonomics, not by "which is official."
- **The classic `@solana/wallet-adapter` stack is NOT deprecated.** It is in maintenance mode
  but still dwarfs every modern React wallet layer combined in downloads (~662k/wk vs ~18k/wk).
  Lead with it for compatibility; reach for this doc for new apps. See the version matrix in
  [resources/api-reference.md](../resources/api-reference.md) for the download reality.
- **The three modern layers pin three different Kit generations** — mixing them yields *two
  copies of Kit* in one bundle. The [version-skew section](#version-skew-read-this-before-you-mix-layers)
  below is mandatory reading.

## The layered architecture (who sits on whom)

Every path discovers the **same** wallets via the same Wallet Standard registry. The only
difference is the React surface and which Kit generation it targets.

```
App-facing React options — pick ONE per app:

  A) framework-kit          @solana/react-hooks + @solana/client
     (Foundation, high-level, create-solana-dapp Kit template default)
     SolanaProvider + useWalletConnection / useBalance / useSolTransfer …

  B) @solana/react          low-level Kit hooks + @wallet-standard/react
     (Anza; used by Kit's own example app)
     useWallets() → UiWalletAccount → useWalletAccountTransactionSendingSigner,
     useSignIn, useSignMessage, useSignAndSendTransaction

  C) @wallet-ui/react       drop-in connect UI, built on (B)
     WalletUi + WalletUiDropdown / WalletUiModal, useWalletUiAuth (SIWS)

  D) LEGACY  @solana/wallet-adapter-react (+ -react-ui)   ← the rest of this skill
                     │
        all discover the same wallets via ↓
  Wallet Standard  (chain-agnostic base — wallets self-register on window)
   @wallet-standard/base/app/react-core/ui + @solana/wallet-standard-features (solana:signIn …)
                     │ client / tx / signers ↓
  @solana/kit  (Address, signers, RPC, tx messages, createClient plugin model)
   gill / @gillsdk/react  — kit-compatible client + data hooks (NO wallet connect)
```

## Which modern layer? Decision table

| You want… | Use | Kit gen | Notes |
|---|---|---|---|
| Fastest official path, batteries included (wallet **and** data/action hooks) | **framework-kit** `@solana/client` + `@solana/react-hooks` | **v5** (transitive) | `create-solana-dapp` Kit template default; one `SolanaProvider` + rich hooks. |
| Full control over Kit tx building; direct `UiWalletAccount` → Kit signers | **`@solana/react`** + `@wallet-standard/react` | **v7** | Used by Kit's own example app. Most flexible, most manual. |
| A polished connect dropdown/modal with minimal code | **`@wallet-ui/react`** | **v6** | Drop-in `WalletUiDropdown` / `WalletUiModal`; built on (B). |
| SIWS auth | `useSignIn` (`@solana/react`) or `useWalletUiAuth` (`@wallet-ui/react`) | matches host | Both implement `solana:signIn`. |
| Just data hooks over Kit (balances, accounts) — no wallet connect | **`gill` + `@gillsdk/react`** | Kit | Pair with any wallet layer above; does **not** connect wallets. |

All four discover the same Wallet Standard wallets — the choice is React ergonomics and Kit
generation, not wallet support.

## Path A — framework-kit (high-level, template default)

**Packages:** `@solana/client@1.7.0` + `@solana/react-hooks@1.4.1` (from
`solana-foundation/framework-kit`). This is what the official `create-solana-dapp@4.8.5` Kit
templates (`kit/nextjs`, `kit/react-vite`) ship. Positioning: *"one provider, many hooks."* It is
opinionated and batteries-included — wallet connection **plus** data hooks (`useBalance`,
`useAccount`, `useSplToken`) **plus** action hooks (`useSolTransfer`, `useSendTransaction`).

### Provider

Build the client at **module scope** (or `useMemo` it): `SolanaProvider` treats the client
identity as its resubscribe key, so a fresh client on every render tears down connections.

```tsx
// app/components/providers.tsx — the shape the kit/nextjs template ships
'use client';
import { SolanaProvider } from '@solana/react-hooks';
import { autoDiscover, createClient } from '@solana/client';
import { PropsWithChildren } from 'react';

const client = createClient({
  endpoint: 'https://api.devnet.solana.com',
  walletConnectors: autoDiscover(), // auto-detect every Wallet Standard wallet
});

export function Providers({ children }: PropsWithChildren) {
  return <SolanaProvider client={client}>{children}</SolanaProvider>;
}
```

`SolanaClientConfig` (verified shape):

```ts
type SolanaClientConfig = Readonly<{
  cluster?: ClusterMoniker;         // 'mainnet' | 'devnet' | 'testnet' | 'localnet'
  commitment?: Commitment;
  endpoint?: ClusterUrl;            // RPC http url
  websocketEndpoint?: ClusterUrl;   // RPC ws url (optional)
  walletConnectors?: readonly WalletConnector[];
  rpcClient?: SolanaRpcClient;      // bring your own
  initialState?: SerializableSolanaState; // SSR hydration
  logger?: ClientLogger;
}>;
```

### Connect UI + SSR gating

`useWalletConnection()` returns everything you need. **Gate the connect UI on `isReady`** — it is
`false` during SSR, so rendering connectors before the client is ready causes a mismatch. Render a
skeleton until `isReady`.

```tsx
'use client';
import { useWalletConnection } from '@solana/react-hooks';

export default function ConnectWallet() {
  const { connectors, connect, disconnect, wallet, status, isReady } = useWalletConnection();

  if (!isReady) return <button disabled>Loading…</button>; // SSR / pre-hydration

  if (wallet) {
    const address = wallet.account.address.toString();
    return <button onClick={() => disconnect()}>Disconnect {address.slice(0, 4)}…</button>;
  }

  return (
    <>
      {connectors.map((c) => (
        <button key={c.id} onClick={() => connect(c.id)} disabled={status === 'connecting'}>
          Connect {c.name}
        </button>
      ))}
    </>
  );
}
```

`useWalletConnection()` return surface (verified):

```ts
{
  connectors: readonly WalletConnector[];             // available wallets
  connect(connectorId: string, opts?): Promise<WalletSession>;
  disconnect(): Promise<void>;
  wallet: WalletSession | undefined;                  // wallet.account.address
  status: 'disconnected' | 'connecting' | 'connected' | ...;
  connected: boolean; connecting: boolean; isReady: boolean; // isReady=false during SSR
  currentConnector?: WalletConnector; connectorId?: string; error: unknown;
}
```

### Sending — no manual tx building

```ts
import { useSendTransaction, useSolTransfer } from '@solana/react-hooks';
const { send, status } = useSendTransaction();   // send(request, opts?) -> Promise<Signature>
```

### Key exports (verified from `.d.ts`)

- **`@solana/react-hooks`** — provider: `SolanaProvider`, `SolanaClientProvider`,
  `SolanaQueryProvider`, `useSolanaClient`, `useClientStore`. Wallet: `useWalletConnection`,
  `useWallet`, `useConnectWallet`, `useDisconnectWallet`, `useWalletSession`, `useWalletActions`,
  `useWalletModalState`, `WalletConnectionManager`. Data: `useAccount`, `useBalance`,
  `useSplToken`, `useLatestBlockhash`, `useProgramAccounts`, `useSimulateTransaction`,
  `useSignatureStatus`, `useClusterState`, `useNonceAccount`, `useLookupTable`, `useStake`.
  Actions: `useSendTransaction`, `useSolTransfer`, `useWrapSol`, `useWaitForSignature`,
  `useTransactionPool`.
- **`@solana/client`** — `createClient`, `createDefaultClient`, `createClientStore`,
  `resolveClientConfig`. Connectors: `autoDiscover`, `defaultWalletConnectors`, and named
  `phantom`, `solflare`, `backpack`, `metamask`, `injected`, `filterByNames`,
  `createWalletStandardConnector`. Actions: `connectWallet`, `disconnectWallet`, `fetchAccount`,
  `fetchBalance`, `requestAirdrop`, `sendTransaction`, `setCluster`. Constants/helpers:
  `TOKEN_PROGRAM_ADDRESS`, `TOKEN_2022_PROGRAM_ADDRESS`, `detectTokenProgram`,
  `LAMPORTS_PER_SOL`, `lamports`, `WRAPPED_SOL_MINT`, `createWalletTransactionSigner`,
  `prepareTransaction`, `createSolanaRpcClient`.

Runnable: [examples/modern-framework-kit.tsx](../examples/modern-framework-kit.tsx).

## Path B — `@solana/react` (low-level Kit signers)

**Package:** `@solana/react@7.0.0` (part of `anza-xyz/kit`, lock-step with `@solana/kit@7.0.0`).
This is the **low-level bridge** from a Wallet Standard `UiWalletAccount` to Kit signers. You pair
it with `@wallet-standard/react` (`useWallets()`) and your own selected-account state (or Kit's
`SelectedWalletAccountContextProvider`). No provider gymnastics for signing — the hooks are pure —
but wallet discovery is still client-only, so keep it behind `'use client'`.

### The hooks (verified)

Each hook takes a `UiWalletAccount` (and, where a transaction is involved, a `chain` id) and
returns a bound function or a Kit signer:

| Hook | Returns |
|---|---|
| `useSignIn(account)` | `(input?) => Promise<{ account, signedMessage, signature }>` — SIWS |
| `useSignMessage(account)` | `(input: { message }) => Promise<{ signedMessage, signature }>` |
| `useSignTransaction(account, chain)` | signs without sending |
| `useSignAndSendTransaction(account, chain)` | `({ transaction }) => Promise<{ signature }>` |
| `useWalletAccountTransactionSendingSigner(account, chain)` | a Kit `TransactionSendingSigner` |
| `useWalletAccountTransactionSigner(account, chain)` | a Kit `TransactionSigner` |
| `useWalletAccountMessageSigner(account)` | a Kit `MessageSigner` |

`chain` is a Wallet Standard chain-id **string**: `'solana:mainnet' | 'solana:devnet' |
'solana:testnet'` (typed as `OnlySolanaChains<TWalletAccount['chains']>` — passing a chain the
selected account doesn't support is a type error). `@solana/react@7` also adds a Kit client plugin
layer (`ClientProvider`, `useClient`, `useClientCapability`) and async/data hooks (`useAction`,
`useRequest`, `useSubscription`) plus `@solana/react/swr` and `@solana/react/query` subpaths.

### The signer → Kit tx pattern

Obtain `UiWalletAccount`s from `useWallets()`, select one, then feed the derived signer straight
into a Kit transaction message. Because the signing hooks require an account, put them in a child
component that only renders once an account exists — that keeps the hooks unconditional (never
call hooks after an early `return`):

```tsx
'use client';
import { useWallets } from '@wallet-standard/react';
import type { UiWalletAccount } from '@wallet-standard/ui';
import {
  useSignIn,
  useWalletAccountTransactionSendingSigner,
} from '@solana/react';
import {
  appendTransactionMessageInstruction,
  createSolanaRpc,
  createTransactionMessage,
  getBase58Decoder,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signAndSendTransactionMessageWithSigners,
} from '@solana/kit';
import { getAddMemoInstruction } from '@solana-program/memo';

export function Wallets() {
  const wallets = useWallets();                 // Wallet Standard discovery
  const account = wallets[0]?.accounts[0];      // pick via your own UI / selected-account ctx
  return account ? <SignerPanel account={account} /> : <p>Connect a wallet</p>;
}

function SignerPanel({ account }: { account: UiWalletAccount }) {
  // Hooks are unconditional here because `account` is guaranteed non-null.
  const signer = useWalletAccountTransactionSendingSigner(account, 'solana:devnet');
  const signIn = useSignIn(account);

  async function recordMemo(text: string) {
    const rpc = createSolanaRpc('https://api.devnet.solana.com');
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const message = pipe(
      createTransactionMessage({ version: 'legacy' }),
      (m) => setTransactionMessageFeePayerSigner(signer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
      (m) => appendTransactionMessageInstruction(getAddMemoInstruction({ memo: text }), m),
    );
    const signature = await signAndSendTransactionMessageWithSigners(message);
    return getBase58Decoder().decode(signature);
  }

  return (
    <>
      <button onClick={() => signIn({ requestId: crypto.randomUUID() })}>Sign In (SIWS)</button>
      <button onClick={() => recordMemo('gm')}>Send memo</button>
    </>
  );
}
```

`signAndSendTransactionMessageWithSigners` discovers the sending signer already attached to the
message (via `setTransactionMessageFeePayerSigner`) and routes signing + broadcast through the
wallet. Verify the SIWS `signedMessage`/`signature` server-side exactly as in the classic path —
see [docs/siws-and-auth.md](siws-and-auth.md). Kit's own reference app
(`anza-xyz/kit/examples/react-app`) implements the full pattern (`ConnectWalletMenu`,
`SignInMenu`, per-feature panels, `SelectedWalletAccountContext`). Runnable:
[examples/modern-solana-react.tsx](../examples/modern-solana-react.tsx).

## Path C — `@wallet-ui/react` (drop-in connect UI)

**Package:** `@wallet-ui/react@4.2.0` (from `wallet-ui/wallet-ui`, by beeman of
`create-solana-dapp`). *"A modern UI component library for Solana apps, built on the Wallet
Standard."* It is built on `@solana/react` + `@wallet-standard/*` and **re-exports** them, so you
get a connect dropdown/modal, cluster switcher, and hooks with almost no code.

```tsx
'use client';
import { WalletUi, createWalletUiConfig, WalletUiDropdown } from '@wallet-ui/react';
import { createSolanaDevnet, createSolanaMainnet } from '@wallet-ui/core';
import '@wallet-ui/tailwind/index.css'; // Wallet UI's Tailwind styles (exact export path)

const config = createWalletUiConfig({
  clusters: [createSolanaDevnet(), createSolanaMainnet()],
});

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WalletUi config={config}>
      <WalletUiDropdown /> {/* connect button + wallet/account menu */}
      {children}
    </WalletUi>
  );
}
```

> Caveat: `createWalletUiConfig` accepts more than `clusters` (e.g. an initial cluster and
> connection/store options), but `clusters` is the only field required for a working setup.
> Confirm the full option shape against the `@wallet-ui/react@4.2.0` `.d.ts` for your version,
> since Wallet UI iterates faster than the classic stack.

Verified exports (from `@wallet-ui/react@4.2.0` `index.d.ts`):

- **Provider / config:** `WalletUi`, `createWalletUiConfig`, `WalletUiContextProvider`,
  `WalletUiAccountContextProvider`, `WalletUiClusterContextProvider`, `WalletUiAccountGuard`.
- **Components:** `WalletUiDropdown`, `WalletUiClusterDropdown`, `WalletUiModal`,
  `WalletUiModalTrigger`, `WalletUiList`, `WalletUiListButton`, `WalletUiIcon`, `WalletUiQrCode`,
  `WalletUiAuth`.
- **Hooks:** `useWalletUi`, `useWalletUiAccount`, `useWalletUiSigner`, `useWalletUiCluster`,
  `useWalletUiWallet`, `useWalletUiWallets`, `useWalletUiAuth` (SIWS →
  `WalletUiAuthState` / `WalletUiAuthError`), `useWalletUiDropdown`.
- **Cluster factories (`@wallet-ui/core`):** `createSolanaMainnet`, `createSolanaDevnet`,
  `createSolanaTestnet`, `createSolanaLocalnet`.

`useWalletUiSigner()` gives you a Kit signer for the connected account (feed it into the same
Kit tx pattern as Path B); `useWalletUiAuth()` handles SIWS. Peer deps: `@solana/kit ^6.1.0`,
`react >=18` (note the **Kit-v6** pin — see below).

### `gill` is data-only

`gill@0.14.0` + `@gillsdk/react@0.7.0` provide a Kit-compatible RPC/tx client and React-Query
**data** hooks (`useBalance`, `useAccount`, `useTokenAccount`, `useLatestBlockhash`,
`useProgramAccounts`, `useSignatureStatuses`, `useSimulateTransaction`). Neither connects wallets
— combine gill with a Path A/B/C wallet layer.

## Version skew (read this before you mix layers)

The three modern React wallet layers each target a **different Kit generation**. This is the
single biggest footgun in the modern stack:

| React layer | Version | Pins Kit | Evidence |
|---|---|---|---|
| `@solana/react` | 7.0.0 | **Kit v7** (`@solana/kit 7.0.0`, exact peer) | peerDeps |
| `@wallet-ui/react` | 4.2.0 | **Kit v6** (`@solana/react 6.1.0`, peer `@solana/kit ^6.1.0`) | deps/peerDeps |
| framework-kit (`@solana/client 1.7.0` + `@solana/react-hooks 1.4.1`) | — | **Kit v5** (`@solana/kit ^5.0.0`) | deps |

**Consequences:**

- The officially-scaffolded framework-kit template resolves a **transitive `@solana/kit@5.x`**,
  while the standalone latest is `7.x`. If your app installs `@solana/kit@7` directly **and**
  uses framework-kit, you end up with **two copies of Kit** in the bundle — larger bundle, and
  subtle bugs when a `Signer`/`Address` from one copy is passed to a function from the other
  (`instanceof`/branded-type checks fail across copies).
- Kit moves fast (`5.0.0` 2025-10 → `6.0.0` 2026-02 → `7.0.0` 2026-06, plus daily canaries).
  **Always pin exact versions** — never `^` a Kit or Kit-adjacent package.

**Rules of thumb:**

1. Pick **one** modern React wallet layer per app; don't combine framework-kit with
   `@solana/react` hooks in the same flow.
2. If you add `@solana/kit` directly, match the generation your wallet layer pins (v5 for
   framework-kit, v6 for `@wallet-ui/react`, v7 for `@solana/react`).
3. Build the client at **module scope** or `useMemo` it — provider identity is the resubscribe key.
4. Run `npm ls @solana/kit` after install; more than one resolved version is a red flag.

**Do not** claim a single official modern React wallet library has "won" (none has), and **do
not** claim `@solana/wallet-adapter` is deprecated (it isn't) — see the version matrix in
[resources/api-reference.md](../resources/api-reference.md).

## Guidelines

**DO**
- Pick one modern layer per app; pin **exact** versions of Kit and every Kit-adjacent package.
- Build the framework-kit / Kit client at module scope (or `useMemo`) so its identity is stable.
- Gate framework-kit connect UI on `useWalletConnection().isReady` (false during SSR).
- Pass the correct `chain` string (`'solana:devnet'` etc.) to Path B send/sign hooks.
- Verify SIWS output server-side — the modern `useSignIn` is no more trusted than the classic one.
- Keep wallet discovery (`useWallets()`, `autoDiscover()`) behind `'use client'`.

**DON'T**
- Mix framework-kit (Kit v5) with a direct `@solana/kit@7` install — two Kit copies.
- Combine framework-kit hooks and `@solana/react` hooks in the same signing flow.
- Use `gill` / `@gillsdk/react` for wallet connection — they are data hooks only.
- Assume the modern path supports different wallets than the classic one — same Wallet Standard registry.
- Call the signing hooks after an early `return` — render a child once an account exists (hooks stay unconditional).

## Common Errors

### Error: two copies of `@solana/kit` in the bundle
**Cause:** mixing layers that pin different Kit generations (e.g. framework-kit's transitive Kit
v5 plus a direct `@solana/kit@7`), or `^`-ranged Kit deps resolving to two majors.
**Solution:** pin exact versions, pick one wallet layer, and run `npm ls @solana/kit` — collapse
to a single resolved version (align to the generation your wallet layer pins).

### Error: hydration mismatch / connectors flash on first paint (framework-kit)
**Cause:** rendering the connect UI before `isReady` is `true` (it is `false` during SSR).
**Solution:** `if (!useWalletConnection().isReady) return <Skeleton/>;` before rendering connectors.

### Error: `chain` type error on `useSignAndSendTransaction` / `useWalletAccountTransactionSendingSigner`
**Cause:** passing a chain string the selected `UiWalletAccount` doesn't advertise, or a typo like
`'devnet'` instead of `'solana:devnet'`.
**Solution:** use a full CAIP-2-style Solana chain id: `'solana:mainnet' | 'solana:devnet' |
'solana:testnet'`, and one the account supports.

### Error: signer/address rejected across a package boundary
**Cause:** a Kit `Signer`/`Address` created by one Kit copy passed into a function from another
copy — branded-type/`instanceof` checks fail.
**Solution:** eliminate the duplicate Kit install (see the two-copies error above).

Broader catalog: [docs/troubleshooting.md](troubleshooting.md).

## References

- Solana Foundation framework-kit: https://github.com/solana-foundation/framework-kit
- `create-solana-dapp` (scaffolder) → templates: https://github.com/solana-foundation/templates
- `@solana/react` / Kit API docs: https://www.solanakit.com
- Anza Kit repo + React example app: https://github.com/anza-xyz/kit (`examples/react-app`)
- Wallet UI: https://github.com/wallet-ui/wallet-ui — https://wallet-ui.dev
- Wallet Standard: https://github.com/wallet-standard/wallet-standard
- gill: https://github.com/DecalLabs/gill — https://gillsdk.com
- ConnectorKit (`@solana/connector`): https://github.com/solana-foundation/connectorkit
</content>

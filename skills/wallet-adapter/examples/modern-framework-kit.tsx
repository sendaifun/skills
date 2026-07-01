/**
 * modern-framework-kit.tsx — the MODERN (current-recommended) wallet path.
 *
 * This is the Solana Foundation "framework-kit" stack that `create-solana-dapp`'s Kit
 * template ships: one `SolanaProvider` + rich hooks. It replaces the classic monolithic
 * `useWallet()` with connection + action hooks, and it's built on `@solana/kit` instead
 * of web3.js v1. All Wallet Standard wallets (Phantom, Solflare, Backpack, …) are
 * auto-discovered — you never hand-list adapters.
 *
 * Packages (pinned):
 *   @solana/client@1.7.0        // createClient, autoDiscover, connectors
 *   @solana/react-hooks@1.4.1   // SolanaProvider, useWalletConnection, action hooks
 *   @solana-program/memo@0.10.0 // Kit-v5-compatible memo instruction builder
 *
 * ⚠ VERSION SKEW: framework-kit (@solana/client 1.7 / @solana/react-hooks 1.4) resolves
 * `@solana/kit@^5` transitively (the Kit v5 API). Any @solana-program/* instruction
 * builder you add MUST target Kit v5 too — hence @solana-program/memo@0.10.0 (peerDeps
 * `@solana/kit@^5.0`). Installing the latest @solana-program/memo (Kit v6) or
 * `@solana/kit@7` directly here would pull in a SECOND Kit copy and break instruction
 * type identity. Pin exact versions. See docs/modern-stack.md and the low-level Kit v7
 * alternative in examples/modern-solana-react.tsx.
 *
 * Usage: wrap your app in <Providers> (once, at the root) and render <WalletPanel />.
 */
'use client';

import { PropsWithChildren, useState } from 'react';
import { autoDiscover, createClient } from '@solana/client';
import {
  SolanaProvider,
  useSendTransaction,
  useSolTransfer,
  useWalletConnection,
} from '@solana/react-hooks';
import { getAddMemoInstruction } from '@solana-program/memo';

// Build the client ONCE at module scope. SolanaProvider treats client identity as the
// resubscribe key, so recreating it on every render tears down all subscriptions.
const client = createClient({
  endpoint: 'https://api.devnet.solana.com',
  walletConnectors: autoDiscover(), // auto-detect every Wallet Standard wallet
});

export function Providers({ children }: PropsWithChildren) {
  return <SolanaProvider client={client}>{children}</SolanaProvider>;
}

/**
 * Connect / disconnect UI driven entirely by useWalletConnection().
 * `isReady` is false during SSR / before hydration — render a stable placeholder to
 * avoid a hydration mismatch (the modern analogue of the classic `dynamic(ssr:false)`).
 */
export function WalletPanel() {
  const { connectors, connect, disconnect, wallet, connecting, isReady } =
    useWalletConnection();

  if (!isReady) return <button disabled>Loading wallets…</button>;

  if (wallet) {
    const address = wallet.account.address.toString();
    return (
      <div>
        <p>Connected: {address}</p>
        <button onClick={() => disconnect()}>Disconnect</button>
        <SolTransferButton />
        <MemoButton />
      </div>
    );
  }

  if (connectors.length === 0) return <p>No Solana wallets detected. Install one and reload.</p>;

  return (
    <div>
      {connectors.map((c) => (
        <button key={c.id} onClick={() => connect(c.id)} disabled={connecting}>
          Connect {c.name}
        </button>
      ))}
    </div>
  );
}

/**
 * Send SOL with zero manual transaction building. The hook injects the connected
 * wallet as `authority` (signer + fee payer), so you pass only amount + destination.
 * `amount` accepts lamports (bigint), decimal SOL (number), or a SOL string.
 */
function SolTransferButton() {
  const { send, isSending, signature } = useSolTransfer();
  const [to, setTo] = useState('');

  async function onTransfer() {
    const sig = await send({
      amount: 10_000_000n, // 0.01 SOL, in lamports
      destination: to, // a base58 address string is accepted directly
    });
    console.log('SOL transfer signature:', sig);
  }

  return (
    <div>
      <input
        value={to}
        onChange={(e) => setTo(e.target.value)}
        placeholder="Recipient address"
      />
      <button onClick={onTransfer} disabled={isSending || !to}>
        {isSending ? 'Sending…' : 'Send 0.01 SOL'}
      </button>
      {signature && <p>Sent: {signature}</p>}
    </div>
  );
}

/**
 * Send an arbitrary instruction with useSendTransaction() — here a memo. Instruction
 * builders come from @solana-program/* clients (Codama-generated). Keep them on the
 * SAME Kit generation as framework-kit (v5) — see the version-skew note at the top.
 */
function MemoButton() {
  const { send, isSending, signature } = useSendTransaction();

  async function onMemo() {
    const memoIx = getAddMemoInstruction({ memo: 'gm from framework-kit' });

    // Caveat: framework-kit is expected to inject the connected wallet session as the
    // authority / fee payer automatically, so `send({ instructions })` needs no explicit
    // signer here (its request type marks `feePayer`/`authority` optional). If your
    // framework-kit version does not auto-bind the active wallet, pass `feePayer`
    // explicitly — check the `useSendTransaction` request shape in the installed
    // @solana/react-hooks@1.4.1 `.d.ts`.
    const sig = await send({ instructions: [memoIx] });
    console.log('memo signature:', sig);
  }

  return (
    <div>
      <button onClick={onMemo} disabled={isSending}>
        {isSending ? 'Recording…' : 'Record on-chain memo'}
      </button>
      {signature && <p>Memo tx: {signature}</p>}
    </div>
  );
}

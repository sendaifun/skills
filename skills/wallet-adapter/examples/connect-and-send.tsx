'use client';

/**
 * connect-and-send.tsx — connect a wallet and send a v0 VersionedTransaction with
 * the classic @solana/wallet-adapter stack.
 *
 * Flow demonstrated:
 *   1. Render `WalletMultiButton` (client-only via dynamic import) for connect/UI.
 *   2. Guard on `connected` / `publicKey` before building anything.
 *   3. Feature-gate v0: not every wallet signs VersionedTransactions.
 *   4. Build a v0 message (SystemProgram.transfer) with a fresh blockhash.
 *   5. `sendTransaction(tx, connection)` — the wallet SIGNS AND BROADCASTS.
 *   6. Confirm against `lastValidBlockHeight`.
 *   7. Handle user rejection (WalletSendTransactionError / provider code 4001).
 *
 * Must be rendered inside the provider tree from examples/nextjs-providers.tsx.
 *
 * Pins: @solana/wallet-adapter-react 0.15.39, @solana/wallet-adapter-base 0.9.27,
 *       @solana/web3.js 1.98.4 (this stack is web3.js v1, not @solana/kit).
 *
 * Note: wallet-adapter delegates BROADCAST to the wallet, so mainnet landing
 * concerns (priority fees, rebroadcast, confirmation strategy) still apply — see
 * the `transaction-landing` skill.
 */

import { FC, useCallback, useState } from 'react';
import dynamic from 'next/dynamic';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import {
  WalletError,
  WalletNotConnectedError,
  WalletSendTransactionError,
} from '@solana/wallet-adapter-base';
import {
  LAMPORTS_PER_SOL,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';

// WalletMultiButton's label is read from localStorage, so render it client-only to
// avoid a Next.js App Router hydration mismatch. (See templates/WalletProviders.tsx
// for the provider wrap that must sit above this component.)
const WalletMultiButton = dynamic(
  async () => (await import('@solana/wallet-adapter-react-ui')).WalletMultiButton,
  { ssr: false },
);

type SendState = 'idle' | 'sending' | 'confirming';

/**
 * Wallets surface provider code 4001 ("User rejected the request") when the user
 * declines. `sendTransaction` wraps the wallet's raw error in
 * WalletSendTransactionError; the original error (carrying `.code`) is on
 * WalletError.error — so check both the top-level and the wrapped code.
 */
function isUserRejection(err: unknown): boolean {
  const top = (err as { code?: number })?.code;
  const inner = (err as WalletError)?.error?.code;
  return top === 4001 || inner === 4001;
}

export const ConnectAndSend: FC = () => {
  const { connection } = useConnection();
  const { publicKey, connected, wallet, sendTransaction } = useWallet();

  const [state, setState] = useState<SendState>('idle');
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSend = useCallback(async () => {
    setError(null);
    setSignature(null);

    // 1) Must be connected. `publicKey` is null until a wallet connects; the button
    //    below is disabled in that state, but guard anyway — WalletNotConnectedError
    //    is the canonical signal.
    if (!connected || !publicKey) {
      setError(new WalletNotConnectedError().message);
      return;
    }

    // 2) Feature-gate v0. `supportedTransactionVersions` is a Set<TransactionVersion>
    //    or `undefined` (legacy-only wallet). Never assume v0 is supported.
    const supported = wallet?.adapter.supportedTransactionVersions;
    if (!supported?.has(0)) {
      setError("This wallet doesn't support v0 (versioned) transactions.");
      return;
    }

    try {
      // 3) Fresh blockhash + lastValidBlockHeight. minContextSlot guards against the
      //    wallet broadcasting through a stale/behind RPC node.
      const {
        context: { slot: minContextSlot },
        value: { blockhash, lastValidBlockHeight },
      } = await connection.getLatestBlockhashAndContext();

      // 4) Build a v0 message. This demo sends a tiny amount to yourself so no funds
      //    are lost — swap `toPubkey` for a real recipient. Pass address-lookup
      //    tables to compileToV0Message([lookupTable]) to compress account keys.
      const message = new TransactionMessage({
        payerKey: publicKey,
        recentBlockhash: blockhash,
        instructions: [
          SystemProgram.transfer({
            fromPubkey: publicKey,
            toPubkey: publicKey, // TODO: real recipient
            lamports: 0.001 * LAMPORTS_PER_SOL,
          }),
        ],
      }).compileToV0Message();

      const tx = new VersionedTransaction(message);

      // 5) The wallet SIGNS AND BROADCASTS, returning the signature string. Do not
      //    call connection.sendRawTransaction yourself — the wallet already sent it.
      setState('sending');
      const sig = await sendTransaction(tx, connection, { minContextSlot });

      // 6) Confirm against the blockhash's lastValidBlockHeight.
      setState('confirming');
      const result = await connection.confirmTransaction(
        { blockhash, lastValidBlockHeight, signature: sig },
        'confirmed',
      );
      if (result.value.err) {
        throw new Error(`Transaction failed on-chain: ${JSON.stringify(result.value.err)}`);
      }

      setSignature(sig);
    } catch (err) {
      if (isUserRejection(err)) {
        // Expected UX, not a bug. Keep it soft and NEVER auto-retry.
        setError('Request cancelled.');
      } else if (err instanceof WalletSendTransactionError) {
        // The wallet accepted the request but broadcasting failed (expired
        // blockhash, insufficient funds, RPC error, …).
        setError(`Could not send transaction: ${err.message}`);
      } else {
        setError((err as Error).message);
      }
    } finally {
      setState('idle');
    }
  }, [connection, connected, publicKey, wallet, sendTransaction]);

  const busy = state !== 'idle';

  return (
    <div style={{ display: 'grid', gap: 12, maxWidth: 420 }}>
      <WalletMultiButton />

      <button onClick={onSend} disabled={!connected || !publicKey || busy}>
        {state === 'idle'
          ? 'Send 0.001 SOL (v0 tx)'
          : state === 'sending'
            ? 'Approve in wallet…'
            : 'Confirming…'}
      </button>

      {signature && (
        <p>
          Confirmed:{' '}
          <a
            href={`https://explorer.solana.com/tx/${signature}?cluster=devnet`}
            target="_blank"
            rel="noreferrer"
          >
            {signature.slice(0, 8)}…{signature.slice(-8)}
          </a>
        </p>
      )}

      {error && <p role="alert" style={{ color: 'crimson' }}>{error}</p>}
    </div>
  );
};

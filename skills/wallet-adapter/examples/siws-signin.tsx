/**
 * siws-signin.tsx — Sign In With Solana (SIWS) client, CLASSIC wallet-adapter path.
 *
 * Flow (one wallet prompt on the happy path):
 *   1. Fetch a fresh SolanaSignInInput (domain, nonce, issuedAt, …) from YOUR server.
 *   2. Feature-detect useWallet().signIn (the `solana:signIn` Wallet Standard feature).
 *   3. Call signIn(input) — the wallet builds + signs the message (connect + sign in one).
 *   4. POST { input, output } to the server, which re-verifies and issues a session.
 *   5. Fallback for wallets WITHOUT signIn: connect + signMessage over the same
 *      SIWS-formatted message, reshaped into a SolanaSignInOutput so ONE server
 *      endpoint verifies both paths.
 *
 * Security is server-side. The client-side verifySignIn() below is only a snappy UX
 * pre-check — the authoritative verification + nonce/domain/expiry/replay enforcement
 * happens in examples/verify-siws.ts. Never trust the client's result.
 *
 * Install (pinned):
 *   npm i @solana/wallet-adapter-react@0.15.39 @solana/wallet-adapter-base@0.9.27 \
 *         @solana/wallet-standard-features@1.4.0 @solana/wallet-standard-util@1.1.3 \
 *         @solana/web3.js@1.98.4 react
 *
 * Requires the classic provider tree (ConnectionProvider → WalletProvider →
 * WalletModalProvider) above this component — see examples/nextjs-providers.tsx.
 * Server counterpart: examples/verify-siws.ts. Deep dive: docs/siws-and-auth.md.
 */
'use client';

import { useCallback, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import type {
  SolanaSignInInput,
  SolanaSignInOutput,
} from '@solana/wallet-standard-features';
import {
  createSignInMessageText,
  verifySignIn,
} from '@solana/wallet-standard-util';

// ---------------------------------------------------------------------------
// Wire format shared with examples/verify-siws.ts.
// SolanaSignInOutput carries Uint8Arrays (publicKey, signature, signedMessage);
// JSON can't represent them, so we send number[] and the server rebuilds them
// with `new Uint8Array(...)`.
// ---------------------------------------------------------------------------
type WireOutput = {
  account: { address: string; publicKey: number[] };
  signature: number[];
  signedMessage: number[];
  signatureType?: 'ed25519';
};

type VerifyPayload = {
  method: 'siws' | 'signMessage';
  /** Echoed for telemetry/debugging only — the server does NOT trust this. */
  input: SolanaSignInInput;
  output: WireOutput;
};

const toArray = (bytes: Uint8Array): number[] => Array.from(bytes);

function serializeOutput(output: SolanaSignInOutput): WireOutput {
  return {
    account: {
      address: output.account.address,
      publicKey: toArray(output.account.publicKey),
    },
    signature: toArray(output.signature),
    signedMessage: toArray(output.signedMessage),
    signatureType: output.signatureType,
  };
}

async function fetchChallenge(): Promise<SolanaSignInInput> {
  const res = await fetch('/api/siws/challenge', { method: 'GET' });
  if (!res.ok) throw new Error('Could not fetch a sign-in challenge');
  return (await res.json()) as SolanaSignInInput;
}

async function postVerify(payload: VerifyPayload): Promise<{ address: string }> {
  const res = await fetch('/api/siws/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    address?: string;
    error?: string;
  };
  if (!res.ok || !body.ok) throw new Error(body.error ?? 'Server verification failed');
  return { address: body.address ?? '' };
}

/** Provider error code 4001 ("User rejected the request") is NOT a failure to retry. */
function isUserRejection(e: unknown): boolean {
  const err = e as { code?: number; message?: string } | null;
  return err?.code === 4001 || /reject|declin|cancel/i.test(err?.message ?? '');
}

type Status = 'idle' | 'signing' | 'verifying' | 'success' | 'error';

export function SignInWithSolanaButton() {
  const { publicKey, wallet, signIn, signMessage } = useWallet();
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);

  const busy = status === 'signing' || status === 'verifying';

  const onSignIn = useCallback(async () => {
    setError(null);
    try {
      const input = await fetchChallenge();

      // ---- Preferred path: one-tap SIWS via the solana:signIn feature ----
      if (signIn) {
        setStatus('signing');
        // The wallet fills in `address` (and connects if needed) and returns the
        // EXACT bytes it signed.
        const output = await signIn(input);

        // Optional local pre-check for instant feedback. NOT authoritative: the
        // server re-runs verifySignIn AND enforces nonce/domain/expiry/replay.
        if (!verifySignIn(input, output)) {
          throw new Error('Local SIWS check failed — refusing to submit');
        }

        setStatus('verifying');
        const { address: verified } = await postVerify({
          method: 'siws',
          input,
          output: serializeOutput(output),
        });
        setAddress(verified);
        setStatus('success');
        return;
      }

      // ---- Fallback: connect + signMessage (wallet lacks solana:signIn) ----
      if (!signMessage) {
        throw new Error('Wallet supports neither Sign In With Solana nor message signing');
      }
      if (!publicKey) {
        throw new Error('Connect your wallet first, then sign in');
      }

      setStatus('signing');
      // createSignInMessageText requires both `domain` and `address`. The wallet
      // won't fill `address` on the plain signMessage path, so we set it here.
      const filledInput = {
        ...input,
        domain: input.domain ?? window.location.host,
        address: publicKey.toBase58(),
      };
      const messageText = createSignInMessageText(filledInput);
      const signedMessage = new TextEncoder().encode(messageText);
      const signature = await signMessage(signedMessage);

      // Reshape into a SolanaSignInOutput so the SAME server endpoint verifies it.
      const output: WireOutput = {
        account: { address: publicKey.toBase58(), publicKey: toArray(publicKey.toBytes()) },
        signature: toArray(signature),
        signedMessage: toArray(signedMessage),
        signatureType: 'ed25519',
      };

      setStatus('verifying');
      const { address: verified } = await postVerify({ method: 'signMessage', input: filledInput, output });
      setAddress(verified);
      setStatus('success');
    } catch (e) {
      if (isUserRejection(e)) {
        setStatus('idle'); // user cancelled — soft state, no error banner
        return;
      }
      setStatus('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [signIn, signMessage, publicKey]);

  const label =
    status === 'signing' ? 'Check your wallet…'
    : status === 'verifying' ? 'Verifying…'
    : status === 'success' ? 'Signed in ✓'
    : 'Sign in with Solana';

  return (
    <div>
      <button onClick={onSignIn} disabled={busy || !wallet}>
        {label}
      </button>
      {!wallet && <p>Select a wallet first (e.g. via &lt;WalletMultiButton /&gt;).</p>}
      {status === 'success' && address && <p role="status">Authenticated as {address}</p>}
      {status === 'error' && error && <p role="alert">Sign-in failed: {error}</p>}
    </div>
  );
}

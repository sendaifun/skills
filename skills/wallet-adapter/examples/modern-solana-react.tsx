'use client';

/**
 * modern-solana-react.tsx — the LOW-LEVEL modern wallet path: Wallet Standard
 * discovery + `@solana/react` (Kit) hooks that bridge a `UiWalletAccount` to a
 * `@solana/kit` signer. This is the most flexible (and most manual) of the modern
 * options — it's what Kit's own example app uses. For the batteries-included
 * alternative see examples/modern-framework-kit.tsx; for the framing/decision table
 * see docs/modern-stack.md.
 *
 * The core idea:
 *   useWallets()  ──▶  UiWalletAccount  ──▶  useWalletAccountTransactionSendingSigner
 *                                             (a Kit TransactionSendingSigner)
 *   ──▶ attach it to a Kit transaction message via setTransactionMessageFeePayerSigner
 *   ──▶ signAndSendTransactionMessageWithSigners(message)  (wallet signs AND broadcasts)
 *
 * Packages (pinned — @solana/react 7 is LOCK-STEP with @solana/kit 7):
 *   @solana/react            7.0.0   // useWallets bridge hooks (Kit signers, SIWS)
 *   @solana/kit              7.0.0   // Address, tx messages, signers, RPC
 *   @wallet-standard/react   1.0.3   // useWallets() discovery
 *   @wallet-standard/ui      1.0.3   // UiWalletAccount type
 *
 * ⚠ VERSION SKEW: @solana/react 7 pins @solana/kit 7 EXACTLY. Do not also install a
 * different Kit generation, and match any @solana-program/* instruction builder to
 * Kit 7 (its peerDependencies must allow @solana/kit ^7). NOTE: at the time of
 * writing, @solana-program/memo's latest (0.11.2) declares
 * `peerDependencies: { "@solana/kit": "^6.4.0" }` — i.e. it does NOT yet allow Kit 7.
 * To keep this example on a single, Kit-7-native dependency graph, the memo
 * instruction below is built INLINE from the Memo program address instead of pulling
 * in a Kit-6-pinned @solana-program/memo. Run `npm ls @solana/kit` after install; a
 * second resolved Kit version is a red flag (see docs/modern-stack.md "Version skew").
 */

import { useWallets } from '@wallet-standard/react';
import type { UiWalletAccount } from '@wallet-standard/ui';
import {
  useSignIn,
  useWalletAccountTransactionSendingSigner,
} from '@solana/react';
import {
  address,
  appendTransactionMessageInstruction,
  createSolanaRpc,
  createTransactionMessage,
  getBase58Decoder,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signAndSendTransactionMessageWithSigners,
} from '@solana/kit';

// SPL Memo program. With zero accounts the program simply logs the UTF-8 data.
const MEMO_PROGRAM_ADDRESS = address('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const RPC_URL = 'https://api.devnet.solana.com';
const CHAIN = 'solana:devnet'; // one of 'solana:mainnet' | 'solana:devnet' | 'solana:testnet'

/**
 * Discovery + selection. `useWallets()` returns every Wallet-Standard wallet; a real
 * app lets the user pick a wallet/account (or uses Kit's
 * SelectedWalletAccountContextProvider). Here we grab the first account for brevity.
 *
 * The signing hooks require a non-null account, so we render them in a CHILD component
 * that only mounts once an account exists — that keeps hook calls unconditional (never
 * call a hook after an early `return`).
 */
export function ModernWallets() {
  const wallets = useWallets();
  const account = wallets[0]?.accounts[0]; // pick via your own UI / selected-account ctx

  if (!account) return <p>Connect a Wallet-Standard wallet (e.g. Phantom, Solflare).</p>;
  return <SignerPanel account={account} />;
}

function SignerPanel({ account }: { account: UiWalletAccount }) {
  // Bridge the UiWalletAccount to Kit signer / SIWS hooks. `chain` is a full CAIP-2-style
  // Solana chain id; passing one the account doesn't advertise is a type error.
  const signer = useWalletAccountTransactionSendingSigner(account, CHAIN);
  const signIn = useSignIn(account);

  async function recordMemo(text: string) {
    const rpc = createSolanaRpc(RPC_URL);
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

    // Inline Kit-native memo instruction (see version-skew note in the header for why we
    // don't import @solana-program/memo here): no accounts, UTF-8 data.
    const memoInstruction = {
      programAddress: MEMO_PROGRAM_ADDRESS,
      data: new TextEncoder().encode(text),
    };

    const message = pipe(
      createTransactionMessage({ version: 'legacy' }),
      (m) => setTransactionMessageFeePayerSigner(signer, m),      // wallet = fee payer + signer
      (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
      (m) => appendTransactionMessageInstruction(memoInstruction, m),
    );

    // Discovers the sending signer attached to the message and routes signing + broadcast
    // through the wallet, returning the signature bytes.
    const signatureBytes = await signAndSendTransactionMessageWithSigners(message);
    return getBase58Decoder().decode(signatureBytes); // base58 signature string
  }

  async function onSignIn() {
    // SIWS via the modern hook. Verify server-side exactly as on the classic path
    // (see examples/verify-siws.ts) — the client result is never authoritative.
    const { account: acct, signedMessage, signature } = await signIn({
      requestId: crypto.randomUUID(),
    });
    console.log('SIWS output', { address: acct.address, signedMessage, signature });
  }

  return (
    <div style={{ display: 'grid', gap: 8, maxWidth: 420 }}>
      <p>Selected account: {account.address}</p>
      <button onClick={onSignIn}>Sign In (SIWS)</button>
      <button
        onClick={async () => {
          const sig = await recordMemo('gm from @solana/react');
          console.log('memo signature:', sig);
        }}
      >
        Send on-chain memo
      </button>
    </div>
  );
}

/*
 * ALTERNATIVE — useSignAndSendTransaction(account, chain):
 *
 *   const signAndSend = useSignAndSendTransaction(account, CHAIN);
 *   const { signature } = await signAndSend({ transaction });
 *
 * This takes a already-compiled Kit `transaction` (you build + compile the message
 * yourself) rather than attaching a sending signer to the message. It's handy when you
 * already have serialized transaction bytes. Caveat: the exact input shape beyond
 * `transaction` (e.g. optional `options`) can vary between @solana/react releases —
 * confirm it against the installed @solana/react@7.0.0 `.d.ts`. The
 * useWalletAccountTransactionSendingSigner + signAndSendTransactionMessageWithSigners
 * flow above is the more ergonomic path when you're building the message with Kit.
 */

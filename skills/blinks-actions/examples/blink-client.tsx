'use client';

/**
 * blink-client.tsx — render a Solana Blink inside your own Next.js (App Router) app.
 *
 * A Blink is a *client* that unfurls an Action URL into a signable card. This file wires
 * @dialectlabs/blinks (useBlink + <Blink> + useBlinkSolanaWalletAdapter) INSIDE the classic
 * wallet-adapter provider stack that the Blinks client requires.
 *
 * Dependencies (pin explicitly):
 *   @dialectlabs/blinks              0.22.5  (+ @dialectlabs/blinks-core 0.20.7)
 *   @solana/wallet-adapter-react     0.15.39
 *   @solana/wallet-adapter-react-ui  0.9.39
 *   @solana/web3.js                  1.98.4
 *   npm i @dialectlabs/blinks @solana/wallet-adapter-react @solana/wallet-adapter-react-ui @solana/web3.js@^1
 *
 * Notes:
 *   - 'use client' is REQUIRED — hooks + wallet-adapter context are client-only.
 *   - BOTH stylesheets must be imported (Blinks CSS + wallet-adapter-ui CSS), or the
 *     Blink card / connect modal render unstyled.
 *   - @dialectlabs/blinks REQUIRES the classic wallet-adapter stack; see the
 *     `wallet-adapter` skill for the full provider tree. Pass `wallets={[]}` —
 *     Wallet-Standard wallets auto-register.
 *   - The Action→Blink rename kept legacy aliases: `useAction`/`<Action>`/
 *     `useActionSolanaWalletAdapter` still compile.
 *   - Client render deep-dive → ../docs/blinks-client-and-registry.md
 */
import '@dialectlabs/blinks/index.css';
import '@solana/wallet-adapter-react-ui/styles.css';

import { useMemo } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider, WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { clusterApiUrl } from '@solana/web3.js';

import { Blink, useBlink, useBlinksRegistryInterval } from '@dialectlabs/blinks';
import { useBlinkSolanaWalletAdapter } from '@dialectlabs/blinks/hooks/solana';

// Use a paid RPC in production — clusterApiUrl is rate-limited.
const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC ?? clusterApiUrl('mainnet-beta');

/**
 * The Blink card itself. Must live UNDER the wallet-adapter providers (below), because
 * useBlinkSolanaWalletAdapter reads the connected wallet from that React context.
 */
function BlinkCard({ actionUrl }: { actionUrl: string }) {
  // Loads + periodically refreshes the Dialect security registry (~10 min), so
  // `securityLevel` can gate trusted / malicious / unknown Actions.
  useBlinksRegistryInterval();

  // Wraps wallet-adapter connect/sign/confirm into the adapter <Blink> expects.
  const { adapter } = useBlinkSolanaWalletAdapter(RPC_URL);

  // `url` accepts a direct Action API URL, a dial.to interstitial URL, or any URL
  // mappable via the host's actions.json — NO `solana-action:` prefix needed.
  const { blink, isLoading } = useBlink({ url: actionUrl });

  if (isLoading || !blink) return null;

  return (
    <Blink
      blink={blink}
      adapter={adapter}
      stylePreset="x-dark" // "default" | "x-dark" | "x-light" | "custom"
      // Production default: only render registry-`trusted` Actions. Use
      // "non-malicious" or "all" to preview unregistered blinks in development.
      securityLevel="only-trusted"
    />
  );
}

/**
 * Page component: the classic wallet-adapter provider stack + the Blink card.
 * Drop `<BlinkPage actionUrl="https://your.app/api/actions/donate" />` into any route.
 */
export default function BlinkPage({
  actionUrl = 'https://dial.to/donate',
}: {
  actionUrl?: string;
}) {
  const endpoint = useMemo(() => RPC_URL, []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      {/* wallets={[]} → Wallet-Standard wallets (Phantom, Solflare, Backpack…) auto-register. */}
      <WalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>
          <main style={{ maxWidth: 420, margin: '0 auto', display: 'grid', gap: 16, padding: 16 }}>
            {/*
              In Next.js App Router, WalletMultiButton is commonly dynamic-imported with
              { ssr: false } to avoid a hydration mismatch (it reads localStorage).
              See the wallet-adapter skill. Direct import is fine for a self-contained demo.
            */}
            <WalletMultiButton />
            <BlinkCard actionUrl={actionUrl} />
          </main>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

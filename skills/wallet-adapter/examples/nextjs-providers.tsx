'use client';

/**
 * nextjs-providers.tsx — the classic @solana/wallet-adapter provider tree for the
 * Next.js App Router.
 *
 * What this shows:
 *   - The correct 3-provider wrap and order: ConnectionProvider → WalletProvider →
 *     WalletModalProvider (the modal needs both the connection and wallet contexts).
 *   - `wallets={[]}` — every Wallet Standard wallet (Phantom, Solflare, Backpack,
 *     Coinbase, …) is auto-registered by WalletProvider, and Mobile Wallet Adapter
 *     is auto-injected on mobile web. You no longer hand-list adapters.
 *   - A `'use client'` boundary (the providers touch `window`/`localStorage`).
 *   - The one required CSS import.
 *
 * Pins (classic stack, verified — this stack is web3.js v1, NOT @solana/kit):
 *   @solana/wallet-adapter-base      0.9.27
 *   @solana/wallet-adapter-react     0.15.39
 *   @solana/wallet-adapter-react-ui  0.9.39
 *   @solana/web3.js                  1.98.4
 *   react                            18 or 19
 *
 * Install:
 *   npm install --save \
 *     @solana/wallet-adapter-base@0.9.27 \
 *     @solana/wallet-adapter-react@0.15.39 \
 *     @solana/wallet-adapter-react-ui@0.9.39 \
 *     @solana/web3.js@1.98.4 react
 */

import { FC, ReactNode, useMemo } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { clusterApiUrl } from '@solana/web3.js';

// REQUIRED once, anywhere in the client tree. The path is exact — react-ui's
// package.json maps `"./styles.css"`. Without it the modal/button render unstyled.
import '@solana/wallet-adapter-react-ui/styles.css';

export const SolanaProviders: FC<{ children: ReactNode }> = ({ children }) => {
  // 'devnet' | 'testnet' | 'mainnet-beta'. clusterApiUrl gives a public RPC; use a
  // paid RPC in production via NEXT_PUBLIC_RPC_URL (public-safe env, exposed to the
  // browser). useMemo keeps the endpoint string stable across renders.
  const network = WalletAdapterNetwork.Devnet;
  const endpoint = useMemo(
    () => process.env.NEXT_PUBLIC_RPC_URL ?? clusterApiUrl(network),
    [network],
  );

  // Empty is correct. WalletProvider internally calls useStandardWalletAdapters(),
  // which subscribes to the Wallet Standard registry and wraps each registered
  // wallet in a StandardWalletAdapter (de-duplicated by name). Wallets installed
  // AFTER page load appear automatically via the `wallet-standard:register-wallet`
  // event. Add adapters here ONLY for wallets that do not implement the Wallet
  // Standard, or dev-only adapters (e.g. UnsafeBurnerWalletAdapter).
  const wallets = useMemo(() => [], []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      {/* autoConnect silently re-authorizes the last-used wallet (persisted to
          localStorage['walletName']). It never pops a dialog for a first-time user.
          It also accepts a predicate (adapter) => Promise<boolean> for one-click
          Sign In With Solana on load. */}
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};

// ---------------------------------------------------------------------------
// Usage — app/layout.tsx (a Server Component wraps this client provider):
//
//   import { SolanaProviders } from '@/components/nextjs-providers';
//
//   export default function RootLayout({ children }: { children: React.ReactNode }) {
//     return (
//       <html lang="en">
//         <body>
//           <SolanaProviders>{children}</SolanaProviders>
//         </body>
//       </html>
//     );
//   }
//
// The connect button and any component calling useWallet()/useConnection() must be
// rendered INSIDE this tree. Render `WalletMultiButton` client-only — its label is
// derived from localStorage, so SSR causes a hydration mismatch. Dynamic-import it:
//
//   const WalletMultiButton = dynamic(
//     async () => (await import('@solana/wallet-adapter-react-ui')).WalletMultiButton,
//     { ssr: false },
//   );
//
// See examples/connect-and-send.tsx for the button + a full send flow.
// ---------------------------------------------------------------------------

'use client';

/**
 * WalletProviders.tsx — drop-in classic @solana/wallet-adapter provider wrapper.
 *
 * Reusable version of examples/nextjs-providers.tsx: it takes the RPC `endpoint` as
 * a prop so the caller owns cluster/RPC selection (env, cluster switcher, tests).
 * Wrap your Next.js App Router tree with it once, then render the connect button and
 * any component that calls useWallet()/useConnection() INSIDE it.
 *
 * Provider order is load-bearing: ConnectionProvider → WalletProvider →
 * WalletModalProvider (the modal needs both contexts).
 *
 * Pins (classic stack, web3.js v1 — NOT @solana/kit):
 *   @solana/wallet-adapter-base      0.9.27
 *   @solana/wallet-adapter-react     0.15.39
 *   @solana/wallet-adapter-react-ui  0.9.39
 *   @solana/web3.js                  1.98.4
 *   react                            18 or 19
 */

import { FC, ReactNode, useMemo } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import type { Adapter } from '@solana/wallet-adapter-base';
import type { ConnectionConfig } from '@solana/web3.js';

// REQUIRED once. Exact path (react-ui maps `"./styles.css"`). Without it the connect
// modal and WalletMultiButton render unstyled. Override `.wallet-adapter-*` to theme.
import '@solana/wallet-adapter-react-ui/styles.css';

export interface WalletProvidersProps {
  /**
   * RPC endpoint URL. Pass `clusterApiUrl('devnet')` for a quick start, or your own
   * paid RPC. In Next.js, a browser-safe env like NEXT_PUBLIC_RPC_URL works:
   *   <WalletProviders endpoint={process.env.NEXT_PUBLIC_RPC_URL ?? clusterApiUrl('devnet')}>
   */
  endpoint: string;
  children: ReactNode;
}

export const WalletProviders: FC<WalletProvidersProps> = ({ endpoint, children }) => {
  // TODO: tune for production — e.g. { commitment: 'confirmed', wsEndpoint,
  //       httpHeaders: { Authorization: '...' } } for an authed RPC.
  const config: ConnectionConfig = useMemo(() => ({ commitment: 'confirmed' }), []);

  // TODO: keep this EMPTY to rely on Wallet Standard auto-registration (Phantom,
  //       Solflare, Backpack, Coinbase, … all self-register; Mobile Wallet Adapter
  //       is auto-injected on mobile web). Add adapters here ONLY for a wallet that
  //       does NOT implement the Wallet Standard, or a dev-only adapter, e.g.:
  //         import { UnsafeBurnerWalletAdapter } from '@solana/wallet-adapter-wallets';
  //         return [new UnsafeBurnerWalletAdapter()];
  const wallets = useMemo<Adapter[]>(() => [], []);

  return (
    <ConnectionProvider endpoint={endpoint} config={config}>
      {/* TODO: `autoConnect` also accepts a predicate (adapter) => Promise<boolean>
          to trigger one-click Sign In With Solana (SIWS) on load — return false to
          skip the silent auto-connect after you authenticate via `signIn`.
          TODO: add `onError={(err) => ...}` for centralized wallet-error handling
          (user rejection surfaces as provider code 4001). */}
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};

// ---------------------------------------------------------------------------
// Usage — app/layout.tsx (Server Component wrapping this client provider):
//
//   import { clusterApiUrl } from '@solana/web3.js';
//   import { WalletProviders } from '@/components/WalletProviders';
//
//   export default function RootLayout({ children }: { children: React.ReactNode }) {
//     const endpoint = process.env.NEXT_PUBLIC_RPC_URL ?? clusterApiUrl('devnet');
//     return (
//       <html lang="en">
//         <body>
//           <WalletProviders endpoint={endpoint}>{children}</WalletProviders>
//         </body>
//       </html>
//     );
//   }
// ---------------------------------------------------------------------------

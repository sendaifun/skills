'use client';

/**
 * WalletButtonDynamic.tsx — drop-in dynamic wrapper around `WalletMultiButton` for the
 * Next.js App Router.
 *
 * WHY THIS EXISTS: `WalletMultiButton`'s label is derived from
 * `localStorage['walletName']` (via `useWalletMultiButton`). On the server there is no
 * localStorage, so it renders "Select Wallet"; on the client, if a wallet is already
 * remembered, it immediately renders "Connect"/the address instead. React compares the
 * two and throws a HYDRATION MISMATCH ("server rendered HTML didn't match the client").
 * Rendering the button client-only with `next/dynamic` + `{ ssr: false }` means there is
 * no server HTML to mismatch — and the button code stays out of the server bundle.
 *
 * `dynamic` expects a module with a default export OR a promise resolving to a
 * component. `WalletMultiButton` is a NAMED export, so the loader awaits the package and
 * returns the named component.
 *
 * Requirements:
 *   - Import the react-ui stylesheet once (here, the provider file, or the root layout):
 *       import '@solana/wallet-adapter-react-ui/styles.css';
 *   - Render inside the provider tree (ConnectionProvider → WalletProvider →
 *     WalletModalProvider) — see templates/WalletProviders.tsx.
 *
 * Pins (classic stack, web3.js v1 — NOT @solana/kit):
 *   @solana/wallet-adapter-react-ui  0.9.39
 *   next                             13+ (App Router)
 *   react                            18 or 19
 */

import dynamic from 'next/dynamic';

export const WalletMultiButtonDynamic = dynamic(
  async () => (await import('@solana/wallet-adapter-react-ui')).WalletMultiButton,
  {
    ssr: false,
    // Optional: reserve space so the button doesn't cause layout shift while it mounts.
    // `wallet-adapter-button` is the react-ui class, so the placeholder matches the size.
    loading: () => (
      <button className="wallet-adapter-button" disabled>
        Loading…
      </button>
    ),
  },
);

// Give WalletDisconnectButton / WalletModalButton the SAME treatment if you use them
// standalone — any component whose output depends on localStorage must be ssr:false.
export const WalletDisconnectButtonDynamic = dynamic(
  async () => (await import('@solana/wallet-adapter-react-ui')).WalletDisconnectButton,
  { ssr: false },
);

// ---------------------------------------------------------------------------
// Usage — anywhere inside the provider tree (a page or layout under it):
//
//   import { WalletMultiButtonDynamic } from '@/components/WalletButtonDynamic';
//
//   export default function Home() {
//     return (
//       <main>
//         {/* Override any state's label via the `labels` prop if you like: */}
//         <WalletMultiButtonDynamic
//           labels={{ 'no-wallet': 'Connect Wallet', connected: 'Account' }}
//         />
//       </main>
//     );
//   }
//
// `page.tsx` can stay a Server Component — WalletMultiButtonDynamic is already a Client
// Component with ssr:false, so it's skipped on the server and mounted only in the browser.
// ---------------------------------------------------------------------------

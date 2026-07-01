'use client';

/**
 * custom-wallet-button.tsx — a fully custom connect button with NO wallet-adapter CSS,
 * driven by the headless `useWalletMultiButton` hook from
 * `@solana/wallet-adapter-base-ui`. This is the escape hatch when the prebuilt
 * `WalletMultiButton` doesn't fit your design system.
 *
 * The hook returns STATE, not markup, so you render whatever you like. It drives the
 * built-in connect modal via `useWalletModal().setVisible(true)`, which is why this
 * still requires the classic provider tree WITH `WalletModalProvider`:
 *   ConnectionProvider → WalletProvider → WalletModalProvider
 * (see examples/nextjs-providers.tsx). Only the MODAL needs the react-ui stylesheet
 * (`@solana/wallet-adapter-react-ui/styles.css`); this button itself needs no CSS.
 *
 * Because the hook lives inside a 'use client' component and you render conditionally,
 * there's no server HTML to mismatch — no `dynamic(ssr:false)` wrapper needed for the
 * button itself.
 *
 * Pins (classic stack, web3.js v1 — NOT @solana/kit):
 *   @solana/wallet-adapter-base-ui   0.1.6   // useWalletMultiButton
 *   @solana/wallet-adapter-react-ui  0.9.39  // useWalletModal + the connect modal
 *   @solana/wallet-adapter-react     0.15.39
 *   react                            18 or 19
 */

import { useState } from 'react';
import { useWalletMultiButton } from '@solana/wallet-adapter-base-ui';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';

// buttonState is one of these five values (verified against the base-ui .d.ts):
//   'no-wallet'      — nothing selected yet → open the wallet picker (modal)
//   'has-wallet'     — a wallet is selected but not connected → connect it
//   'connecting'     — connect in progress
//   'connected'      — connected → show address + a disconnect/switch menu
//   'disconnecting'  — disconnect in progress
export function CustomWalletButton() {
  const { setVisible } = useWalletModal();
  const [menuOpen, setMenuOpen] = useState(false);

  const {
    buttonState,
    publicKey,
    walletIcon,
    walletName,
    onConnect,
    onDisconnect,
    onSelectWallet,
  } = useWalletMultiButton({
    // Called when the button needs the user to CHOOSE a wallet. Here we open the
    // built-in modal; swap this for your own wallet picker if you have one.
    onSelectWallet: () => setVisible(true),
  });

  const address = publicKey?.toBase58();
  const short = address ? `${address.slice(0, 4)}…${address.slice(-4)}` : '';

  switch (buttonState) {
    case 'no-wallet':
      // `onSelectWallet` is defined in this state; fall back to opening the modal.
      return (
        <button onClick={() => (onSelectWallet ? onSelectWallet() : setVisible(true))}>
          Select Wallet
        </button>
      );

    case 'has-wallet':
      return (
        <button onClick={() => onConnect?.()}>
          {walletIcon && walletName && (
            <img src={walletIcon} alt="" width={16} height={16} style={{ marginRight: 8 }} />
          )}
          Connect{walletName ? ` ${walletName}` : ''}
        </button>
      );

    case 'connecting':
      return <button disabled>Connecting…</button>;

    case 'disconnecting':
      return <button disabled>Disconnecting…</button>;

    case 'connected':
      return (
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <button onClick={() => setMenuOpen((o) => !o)}>
            {walletIcon && (
              <img src={walletIcon} alt="" width={16} height={16} style={{ marginRight: 8 }} />
            )}
            {short}
          </button>

          {menuOpen && (
            <div
              role="menu"
              style={{
                position: 'absolute',
                marginTop: 4,
                display: 'grid',
                gap: 4,
                padding: 8,
                border: '1px solid #ccc',
                borderRadius: 8,
                background: 'white',
              }}
            >
              <button
                role="menuitem"
                onClick={() => {
                  if (address) void navigator.clipboard.writeText(address);
                  setMenuOpen(false);
                }}
              >
                Copy address
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  // Switch wallet: reopen the picker (or call onSelectWallet).
                  onSelectWallet ? onSelectWallet() : setVisible(true);
                }}
              >
                Change wallet
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onDisconnect?.();
                }}
              >
                Disconnect
              </button>
            </div>
          )}
        </div>
      );

    default:
      return null;
  }
}

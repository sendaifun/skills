# Sign In With Solana (SIWS) and wallet auth

Deep dive on wallet-based authentication with the classic `@solana/wallet-adapter` stack:
the `solana:signIn` Wallet Standard feature, its input/output types, the exact message the
wallet builds, authoritative **server-side** verification with `verifySignIn`, the one-click
`autoConnect` sign-in pattern, and the simpler `signMessage` fallback. This is the long form of
the SKILL.md "Sign In With Solana (SIWS) and auth" section.

> Golden rule, stated up front: **the client can never authenticate itself.** Every snippet
> here ends at a server route that re-verifies the signature *and* enforces a freshness policy
> the client cannot influence. `verifySignIn` checks cryptography and message↔input
> consistency — it does **not** check that the nonce was yours, unused, or recent. You do.

---

## What SIWS is (and why prefer it)

SIWS is the Wallet Standard **`solana:signIn`** feature (identifier `solana:signIn`, from
`@solana/wallet-standard-features@1.4.0`). It merges `connect` + `signMessage` into **one**
wallet prompt, and crucially **the wallet builds the message** from the fields you supply —
the dApp never hand-formats the text. That gives you:

- **Domain-binding.** The wallet renders the requesting `domain` and can warn on a mismatch
  between the message domain and the actual origin — the core anti-phishing property.
- **One prompt instead of two.** No separate "connect", then "sign this message" dance.
- **A structured consent screen.** Wallets show `statement`, `resources`, expiry, etc. in a
  readable layout instead of an opaque blob.
- **A standard, verifiable format.** Modeled on **EIP-4361 (Sign-In With Ethereum)**; the
  message is an ABNF-defined string both sides can parse.

Prefer SIWS over ad-hoc `signMessage` auth for new apps. Keep `signMessage` as a fallback for
wallets that have not shipped `signIn` (see [Alternative: `signMessage`-based auth](#alternative-signmessage-based-auth)).

---

## The method: `useWallet().signIn`

The classic adapter surfaces the feature on the hook as an **optional** method:

```ts
// from @solana/wallet-adapter-react useWallet() -> WalletContextState
signIn?: (input?: SolanaSignInInput) => Promise<SolanaSignInOutput>;
```

It is `| undefined` because not every selected wallet implements `solana:signIn`. **Always
feature-detect** before calling — calling `undefined()` is the #1 SIWS bug:

```ts
const { signIn } = useWallet();
if (!signIn) throw new Error('This wallet does not support Sign In With Solana');
```

`SolanaSignInInput` / `SolanaSignInOutput` are imported from
`@solana/wallet-standard-features`; `verifySignIn` from `@solana/wallet-standard-util@1.1.3`.

---

## `SolanaSignInInput` fields

**All fields are optional strings** (`resources` is `readonly string[]`). You may pass `{}` and
let the wallet fill everything in — but a secure flow supplies at least `domain` and `nonce`.

| Field | Type | Rule / meaning |
|---|---|---|
| `domain` | `string` | Requesting authority (e.g. `example.com`). **Domain-binding is the security core** — set it and re-check it server-side. |
| `address` | `string` | Case-sensitive base58 Solana address. If omitted, the wallet fills in the connecting account. |
| `statement` | `string` | Human-readable consent line. **Must not contain `\n`** (newlines break the ABNF layout). |
| `uri` | `string` | The URI the user is signing in to. |
| `version` | `string` | SIWS message version (wallets default it; usually `"1"`). |
| `chainId` | `string` | One of `mainnet \| testnet \| devnet \| localnet \| solana:mainnet \| solana:testnet \| solana:devnet`. |
| `nonce` | `string` | Alphanumeric, **≥ 8 characters**. The primary anti-replay token — issue it server-side, single-use. |
| `issuedAt` | `string` | ISO-8601 timestamp. **Phantom enforces `issuedAt` within ±10 minutes** of verification time. |
| `expirationTime` | `string` | ISO-8601; message invalid after this instant. |
| `notBefore` | `string` | ISO-8601; message invalid before this instant. |
| `requestId` | `string` | Opaque token to bind the request to server state (defense-in-depth / CSRF). |
| `resources` | `readonly string[]` | List of URIs; rendered one per line prefixed with `- `. |

**Who should set what.** The strongest pattern (below) has the **server build the entire
input** — `domain`, `nonce`, `issuedAt`, `expirationTime`, `chainId`, `statement`, `uri` — and
store it keyed by `nonce`. The client passes that input through unchanged, and the server later
verifies the signed output against the *exact* input it issued. That removes any client control
over the security-relevant fields.

---

## `SolanaSignInOutput`

```ts
interface SolanaSignInOutput {
  account: WalletAccount;       // account.publicKey is a Uint8Array (NOT a base58 string)
  signedMessage: Uint8Array;    // the EXACT bytes the wallet built + signed (ABNF format)
  signature: Uint8Array;        // Ed25519, 64 bytes
  signatureType?: 'ed25519';
}
```

Two things bite people:

1. `account.publicKey` is a **`Uint8Array`**, not a base58 string. Use
   `new PublicKey(output.account.publicKey).toBase58()` when you need the address.
2. `signedMessage` is the **wallet's** bytes — do not reconstruct the message yourself and
   compare. `verifySignIn` re-parses these bytes and rebuilds the ABNF for you.

---

## The message the wallet builds (ABNF)

You never format this — it is shown here so you can recognize it in logs and understand what
`verifySignIn` parses. With an empty input the wallet emits the minimal form:

```
${domain} wants you to sign in with your Solana account:
${address}
```

With every field populated, the maximal form is:

```
${domain} wants you to sign in with your Solana account:
${address}

${statement}

URI: ${uri}
Version: ${version}
Chain ID: ${chainId}
Nonce: ${nonce}
Issued At: ${issuedAt}
Expiration Time: ${expirationTime}
Not Before: ${notBefore}
Request ID: ${requestId}
Resources:
- ${resources[0]}
- ${resources[1]}
```

`@solana/wallet-standard-util` also exports `createSignInMessage(Text)`,
`parseSignInMessage(Text)`, and `deriveSignInMessage(Text)` if you ever need to build or parse
this string manually — but for auth you should rely on `verifySignIn`, not hand-rolling.

---

## End-to-end: the recommended flow (server owns the input)

Three hops: **GET `/api/siws/create`** mints and stores the input → client calls `signIn(input)`
→ **POST `/api/siws/verify`** verifies and issues a session. The server owns every
security-relevant field.

### Server: mint the input (`/api/siws/create`)

```ts
// app/api/siws/create/route.ts  (Next.js App Router, runs on the server)
import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import type { SolanaSignInInput } from '@solana/wallet-standard-features';
import { putNonce } from '@/lib/siws-store';

const APP_DOMAIN = process.env.NEXT_PUBLIC_APP_DOMAIN ?? 'localhost:3000';

export async function GET() {
  const now = Date.now();
  const nonce = randomBytes(16).toString('hex'); // 32 chars, well over the 8-char minimum

  const input: SolanaSignInInput = {
    domain: APP_DOMAIN,
    statement: 'Sign in to Example App. This request will not trigger a transaction or cost fees.',
    uri: `https://${APP_DOMAIN}`,
    version: '1',
    chainId: 'solana:devnet',
    nonce,
    issuedAt: new Date(now).toISOString(),
    expirationTime: new Date(now + 10 * 60_000).toISOString(), // 10 minutes
  };

  // Persist the FULL input keyed by nonce so /verify checks against exactly what we issued.
  // Use Redis/DB in production; an in-memory Map (see lib/siws-store) is fine for a demo.
  putNonce(nonce, input);

  return NextResponse.json(input);
}
```

```ts
// lib/siws-store.ts — illustrative single-use nonce store (swap for Redis in production)
import type { SolanaSignInInput } from '@solana/wallet-standard-features';

const store = new Map<string, { input: SolanaSignInInput; expiresAt: number }>();

export function putNonce(nonce: string, input: SolanaSignInInput) {
  store.set(nonce, { input, expiresAt: Date.now() + 10 * 60_000 });
}

// Returns the issued input and atomically consumes the nonce (single-use → replay-proof).
export function consumeNonce(nonce: string): SolanaSignInInput | null {
  const entry = store.get(nonce);
  if (!entry) return null;
  store.delete(nonce);                       // consume: a second verify with the same nonce fails
  if (Date.now() > entry.expiresAt) return null;
  return entry.input;
}
```

### Client: prompt the wallet (`siws-signin.tsx`)

```tsx
'use client';
import { useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import type { SolanaSignInInput, SolanaSignInOutput } from '@solana/wallet-standard-features';
import { verifySignIn } from '@solana/wallet-standard-util';

export function SignInButton() {
  const { signIn, connected } = useWallet();

  const onSignIn = useCallback(async () => {
    if (!signIn) throw new Error('This wallet does not support Sign In With Solana');

    // 1. Server mints the input (domain + nonce + timestamps it controls).
    const input: SolanaSignInInput = await (await fetch('/api/siws/create')).json();

    // 2. One wallet prompt: connect + sign. `output.signedMessage` are the wallet's bytes.
    let output: SolanaSignInOutput;
    try {
      output = await signIn(input);
    } catch (err: any) {
      if (err?.code === 4001) return; // user rejected — treat as non-fatal, no retry
      throw err;
    }

    // 3. Optional client-side sanity check — UX pre-flight ONLY, never authoritative.
    if (!verifySignIn(input, output)) throw new Error('Local SIWS check failed');

    // 4. Send { input, output } to the server; JSON-encode the Uint8Arrays as arrays.
    const res = await fetch('/api/siws/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        input,
        output: {
          account: { ...output.account, publicKey: Array.from(output.account.publicKey) },
          signature: Array.from(output.signature),
          signedMessage: Array.from(output.signedMessage),
        },
      }),
    });
    if (!res.ok) throw new Error('Server rejected the sign-in');
    // res sets an httpOnly session cookie — you're authenticated.
  }, [signIn]);

  return <button onClick={onSignIn}>Sign in with Solana</button>;
}
```

> `Array.from(uint8Array)` is the transport step: `Uint8Array` does not survive `JSON.stringify`
> as bytes (it serializes to `{"0":..,"1":..}`). Encode explicitly on the client and re-wrap on
> the server — that is the single most common cause of "signature verification failed" bugs.

### Server: verify (authoritative) — `/api/siws/verify`

`verifySignIn(input, output): boolean` from `@solana/wallet-standard-util` (1) parses the
returned `signedMessage`, (2) checks the parsed fields against `input`, (3) rebuilds the ABNF
message, and (4) verifies the Ed25519 signature. That covers **cryptography + consistency** — it
does **not** enforce your freshness policy. Layer that on top.

```ts
// app/api/siws/verify/route.ts
import { NextResponse } from 'next/server';
import type { SolanaSignInInput, SolanaSignInOutput } from '@solana/wallet-standard-features';
import { verifySignIn } from '@solana/wallet-standard-util';
import { consumeNonce } from '@/lib/siws-store';
import { issueSession } from '@/lib/session';

const APP_DOMAIN = process.env.NEXT_PUBLIC_APP_DOMAIN ?? 'localhost:3000';

export async function POST(req: Request) {
  const body = await req.json();
  const input = body.input as SolanaSignInInput;

  // Re-wrap the transported arrays back into Uint8Arrays exactly as the util expects.
  const output: SolanaSignInOutput = {
    account: {
      ...body.output.account,
      publicKey: new Uint8Array(body.output.account.publicKey),
    },
    signature: new Uint8Array(body.output.signature),
    signedMessage: new Uint8Array(body.output.signedMessage),
  };

  // (A) Cryptographic + message↔input consistency check.
  if (!verifySignIn(input, output)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  // (B) YOUR freshness/replay policy — verifySignIn does NOT do any of this:
  //  1. Nonce must be one we issued and not yet used. consumeNonce() deletes it (single-use).
  const issued = input.nonce ? consumeNonce(input.nonce) : null;
  if (!issued) {
    return NextResponse.json({ error: 'Unknown or reused nonce' }, { status: 401 });
  }
  //  2. The client must not have altered the input we issued (bind to the stored copy).
  if (issued.domain !== input.domain || issued.nonce !== input.nonce) {
    return NextResponse.json({ error: 'Input tampered' }, { status: 401 });
  }
  //  3. Domain must match this server's host (anti-phishing).
  if (input.domain !== APP_DOMAIN) {
    return NextResponse.json({ error: 'Wrong domain' }, { status: 401 });
  }
  //  4. Timestamp window (also caught by expirationTime, but check issuedAt skew explicitly).
  const issuedAt = input.issuedAt ? Date.parse(input.issuedAt) : NaN;
  if (!Number.isFinite(issuedAt) || Math.abs(Date.now() - issuedAt) > 10 * 60_000) {
    return NextResponse.json({ error: 'Stale sign-in' }, { status: 401 });
  }

  // Authenticated. account.publicKey is bytes — derive the address for the session subject.
  const address = Buffer.from(output.account.publicKey).toString('base64'); // or new PublicKey(...).toBase58()
  const cookie = await issueSession(address); // your JWT/session logic
  const res = NextResponse.json({ ok: true, address });
  res.headers.set('set-cookie', cookie);
  return res;
}
```

**What `verifySignIn` does NOT enforce (you must):**

- **Replay** — that the `nonce` was issued by you and is unused. (Single-use store above.)
- **Domain** — that `input.domain` equals your real host (it only checks message↔input match).
- **Timestamp** — that `issuedAt`/`expirationTime` fall in an acceptable window.
- **`requestId`** — if you use it, that it matches the value bound to the session/CSRF token.

The runnable server counterpart — challenge route, `verifySignIn`, and the full freshness
policy — lives in [examples/verify-siws.ts](../examples/verify-siws.ts).

---

## One-click sign-in: the `autoConnect` predicate

`WalletProvider`'s `autoConnect` prop is not just a boolean — it accepts a predicate
`(adapter: Adapter) => Promise<boolean>`:

- **return `true`** → do the normal silent auto-connect (reconnect the remembered wallet);
- **return `false`** → skip the built-in auto-connect **because you already authenticated the
  user via `signIn` inside the predicate.**

This is the canonical wallet-adapter one-click SIWS pattern: on load, if the remembered wallet
supports `signIn`, run the full SIWS flow in a single prompt instead of a silent reconnect.

```tsx
'use client';
import { useCallback } from 'react';
import { WalletProvider } from '@solana/wallet-adapter-react';
import type { Adapter } from '@solana/wallet-adapter-base';
import type { SolanaSignInInput, SolanaSignInOutput } from '@solana/wallet-standard-features';

export function ProvidersWithSiws({ children }: { children: React.ReactNode }) {
  const autoSignIn = useCallback(async (adapter: Adapter) => {
    // No SIWS support on this wallet → fall back to plain silent auto-connect.
    if (!('signIn' in adapter)) return true;

    const input: SolanaSignInInput = await (await fetch('/api/siws/create')).json();
    const output = (await (adapter as any).signIn(input)) as SolanaSignInOutput;

    const ok = await (
      await fetch('/api/siws/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          input,
          output: {
            account: { ...output.account, publicKey: Array.from(output.account.publicKey) },
            signature: Array.from(output.signature),
            signedMessage: Array.from(output.signedMessage),
          },
        }),
      })
    ).json();
    if (!ok?.ok) throw new Error('Sign In verification failed');

    return false; // we authenticated via SIWS — do NOT also run the default auto-connect
  }, []);

  return (
    // Other providers (ConnectionProvider / WalletModalProvider) omitted for brevity.
    <WalletProvider wallets={[]} autoConnect={autoSignIn}>
      {children}
    </WalletProvider>
  );
}
```

Notes:

- The predicate runs against the **remembered** wallet (persisted under
  `localStorageKey`, default `'walletName'`). A first-time user with no stored wallet triggers
  nothing — SIWS-on-load only applies to a returning, previously-selected wallet.
- Because the wallet may still be registering when the predicate fires, guard with
  `'signIn' in adapter` and handle a thrown user-rejection (`4001`) gracefully.
- This does not replace the button flow — keep an explicit "Sign in" button
  ([end-to-end above](#end-to-end-the-recommended-flow-server-owns-the-input)) for users who
  connect a fresh wallet in-session.

---

## Alternative: `signMessage`-based auth

Simpler and older, still valid, and the fallback when a wallet lacks `signIn`. You format the
message yourself and verify an Ed25519 signature. Prefer SIWS for new apps (domain-binding + one
prompt); use this when you must support wallets without `solana:signIn`.

### Client

```tsx
'use client';
import { useWallet } from '@solana/wallet-adapter-react';
import { ed25519 } from '@noble/curves/ed25519';
import bs58 from 'bs58';

export function SignMessageAuth() {
  const { publicKey, signMessage } = useWallet();

  async function authenticate(serverNonce: string) {
    if (!publicKey) throw new Error('Wallet not connected');
    if (!signMessage) throw new Error('Wallet does not support message signing'); // feature-detect

    // Bind the domain + address + a server-issued nonce to resist replay/phishing.
    const message = new TextEncoder().encode(
      `${window.location.host} wants you to sign in with your Solana account:\n` +
        `${publicKey.toBase58()}\n\nNonce: ${serverNonce}`,
    );

    const signature = await signMessage(message); // Uint8Array (64-byte Ed25519)

    // Client-side sanity check only — the server re-verifies.
    if (!ed25519.verify(signature, message, publicKey.toBytes())) {
      throw new Error('Invalid signature');
    }

    await fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        publicKey: publicKey.toBase58(),
        message: bs58.encode(message),
        signature: bs58.encode(signature),
        nonce: serverNonce,
      }),
    });
  }

  return <button onClick={() => authenticate('<fetch-from-server>')} disabled={!publicKey}>Sign in</button>;
}
```

### Server

Verify with `tweetnacl` (or `@noble/curves`) and enforce the same nonce/domain policy:

```ts
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { consumeNonce } from '@/lib/siws-store';

export async function POST(req: Request) {
  const { publicKey, message, signature, nonce } = await req.json();

  const ok = nacl.sign.detached.verify(
    bs58.decode(message),
    bs58.decode(signature),
    bs58.decode(publicKey),
  );
  if (!ok) return new Response('Invalid signature', { status: 401 });

  // Same freshness policy as SIWS: nonce must be issued + unused, message must bind your host.
  const decoded = new TextDecoder().decode(bs58.decode(message));
  if (!decoded.includes(nonce) || !consumeNonce(nonce)) {
    return new Response('Bad nonce', { status: 401 });
  }
  // ...issue session
  return Response.json({ ok: true });
}
```

`@solana/wallet-standard-util` also exports `verifyMessageSignature({ message, signedMessage,
signature, publicKey })` if you prefer its helper over raw `tweetnacl`.

---

## SIWS vs `signMessage`: which to use

| Need | Use | Why |
|---|---|---|
| New app, want phishing protection + one prompt | **SIWS (`signIn`)** | Wallet builds a domain-bound message; wallet renders a structured consent screen. |
| Must support a wallet that lacks `solana:signIn` | **`signMessage`** | Universal message-signing fallback; you format the message. |
| One-click reconnect + auth on page load | **SIWS via `autoConnect` predicate** | Merges reconnect + auth into a single prompt for returning users. |
| You already ship EIP-4361-style SIWE on other chains | **SIWS** | Same ABNF model; symmetric client/server verification. |

Regardless of choice: **verification is server-side, and freshness policy is yours.**

---

## Platform support & feature detection

- Phantom shipped `signIn` in **extension v23.11** (all extension platforms); mobile followed.
  Solflare, Backpack, and other Wallet Standard wallets implement it too.
- **Always feature-detect** — `if (!signIn)` on the hook, or `'signIn' in adapter` in the
  predicate — and fall back to `connect` + `signMessage`.
- On the **modern / Kit** path, `@solana/react@7.0.0` exposes `useSignIn(uiWalletAccount)` and
  `@wallet-ui/react@4.2.0` exposes `useWalletUiAuth()`; the server verification (`verifySignIn`
  + your policy) is identical. See [docs/modern-stack.md](modern-stack.md).

---

## Guidelines

**DO**
- Let the **server build and store the input** (domain, nonce, timestamps); verify the output
  against the exact issued input.
- Feature-detect `signIn` (and `signMessage`) before calling.
- Encode `Uint8Array` fields as arrays over the wire and re-wrap them server-side.
- Enforce **nonce (issued + single-use), domain == host, and timestamp window** on the server.
- Treat client-side `verifySignIn` as a UX pre-check only.

**DON'T**
- Trust any client-side verification as authentication.
- Reuse a nonce, or accept a nonce you did not issue.
- Put `\n` in `statement` (breaks the ABNF layout).
- Reconstruct the signed message yourself and compare bytes — parse `output.signedMessage` via
  `verifySignIn` instead.
- Retry automatically on user rejection (`4001`).

---

## Common Errors (SIWS-specific)

### Error: `signIn is not a function`
**Cause:** the selected wallet does not implement `solana:signIn`, so `useWallet().signIn` is
`undefined`.
**Solution:** feature-detect (`if (!signIn) …`) and fall back to `signMessage` auth.

### Error: `verifySignIn` returns `false` for a signature the wallet clearly produced
**Cause:** the `Uint8Array` fields (`signedMessage`, `signature`, `account.publicKey`) were
JSON-serialized to `{"0":..}` objects in transit and never re-wrapped as `Uint8Array`.
**Solution:** `Array.from(...)` on the client, `new Uint8Array(...)` on the server before calling
`verifySignIn` (see the verify route above).

### Error: sign-in succeeds but users can replay a captured request
**Cause:** relying on `verifySignIn` alone — it validates cryptography, not freshness.
**Solution:** enforce single-use nonces (delete on consume), domain == host, and the
`issuedAt`/`expirationTime` window server-side.

### Error: Phantom rejects a valid-looking sign-in
**Cause:** `issuedAt` is outside Phantom's **±10 minute** tolerance (clock skew or a stale
cached input).
**Solution:** set `issuedAt` server-side at mint time, keep `expirationTime` short (~10 min),
and re-issue the input if the user waits.

Broader wallet error catalog: [docs/troubleshooting.md](troubleshooting.md).

---

## References

- Sign In With Solana (Phantom) spec — input/output fields, ABNF, `verifySignIn` internals,
  `autoSignIn` pattern, `issuedAt` ±10 min: https://github.com/phantom/sign-in-with-solana
  and https://phantom.com/learn/developers/sign-in-with-solana
- `@solana/wallet-standard-features` (`solana:signIn`, `SolanaSignInInput`/`Output`):
  https://github.com/anza-xyz/wallet-standard
- `@solana/wallet-standard-util` (`verifySignIn`, `createSignInMessage`, `verifyMessageSignature`):
  https://www.npmjs.com/package/@solana/wallet-standard-util
- Wallet Adapter starter `SignIn.tsx` / `SignMessage.tsx`:
  https://github.com/anza-xyz/wallet-adapter/tree/master/packages/starter/example/src/components
- EIP-4361 (Sign-In With Ethereum), the model SIWS follows: https://eips.ethereum.org/EIPS/eip-4361

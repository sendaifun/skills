/**
 * verify-siws.ts — Sign In With Solana (SIWS) SERVER, the authoritative half.
 *
 * Two responsibilities:
 *   • GET  /api/siws/challenge  → build a SolanaSignInInput (domain, nonce, issuedAt,
 *                                 expirationTime) and remember the nonce server-side.
 *   • POST /api/siws/verify     → verify the wallet's SolanaSignInOutput and, ONLY if
 *                                 all policy checks pass, issue a session cookie.
 *
 * ── WHY "verifySignIn is not enough" ──────────────────────────────────────────────
 * `verifySignIn(input, output)` proves two things and nothing more:
 *   (1) `output.signedMessage` is exactly the SIWS message derived from `input`
 *       (+ the account), and (2) `output.signature` is a valid Ed25519 signature of
 *       that message by `output.account.publicKey`.
 * It knows NOTHING about your app: it will happily return `true` for a REPLAYED,
 * EXPIRED, or WRONG-DOMAIN message as long as the input you hand it matches. So you
 * MUST additionally enforce, yourself:
 *   • the nonce is one YOU issued and is still unused        (replay protection)
 *   • the domain equals YOUR host                            (anti-phishing)
 *   • issuedAt / expirationTime / notBefore are in-window    (freshness)
 * And critically: derive the trusted `input` from YOUR OWN store (keyed by the nonce
 * inside the signed message) — never from the client-echoed `input`, which an attacker
 * can tamper with (e.g. swap in a domain that matches a signature captured elsewhere).
 *
 * Runtime: Next.js App Router route handlers (Node runtime) / Node 20+.
 * Install (pinned):
 *   npm i @solana/wallet-standard-features@1.4.0 @solana/wallet-standard-util@1.1.3
 *
 * In a real app split these into app/api/siws/challenge/route.ts (GET) and
 * app/api/siws/verify/route.ts (POST). Client counterpart: examples/siws-signin.tsx.
 */

import { randomBytes, createHmac } from 'node:crypto';
import type {
  SolanaSignInInput,
  SolanaSignInOutput,
} from '@solana/wallet-standard-features';
import { parseSignInMessage, verifySignIn } from '@solana/wallet-standard-util';

// ── Config (source these from env in production) ────────────────────────────────────
const APP_DOMAIN = process.env.SIWS_DOMAIN ?? 'localhost:3000';
const APP_URI = process.env.SIWS_URI ?? `http://${APP_DOMAIN}`;
const APP_CHAIN = 'solana:devnet'; // one of solana:mainnet | solana:devnet | solana:testnet
const SESSION_SECRET = process.env.SESSION_SECRET ?? 'dev-only-insecure-secret-change-me';
const NONCE_TTL_MS = 5 * 60_000; // challenge lifetime: 5 minutes
const ISSUED_AT_SKEW_MS = 10 * 60_000; // ±10 min clock-skew tolerance (matches Phantom)

// ── Challenge store ─────────────────────────────────────────────────────────────────
// nonce -> the exact input we issued. PRODUCTION: replace this Map with Redis/Postgres.
// A per-process Map does NOT survive restarts and is NOT shared across serverless
// instances — replay protection would silently break at scale.
type Challenge = { input: SolanaSignInInput; expiresAt: number };
const challenges = new Map<string, Challenge>();

// ---------------------------------------------------------------------------
// GET /api/siws/challenge  — build + persist a one-time SolanaSignInInput
// ---------------------------------------------------------------------------
function buildSignInInput(): SolanaSignInInput {
  const now = Date.now();
  // Nonce: alphanumeric, > 8 chars (SIWS requires >= 8). 16 random bytes -> 32 hex.
  const nonce = randomBytes(16).toString('hex');

  const input: SolanaSignInInput = {
    domain: APP_DOMAIN,
    uri: APP_URI,
    version: '1',
    chainId: APP_CHAIN,
    statement:
      'Sign in to Example App. This request will not trigger a transaction or cost any fees.',
    nonce,
    issuedAt: new Date(now).toISOString(),
    expirationTime: new Date(now + NONCE_TTL_MS).toISOString(),
  };

  challenges.set(nonce, { input, expiresAt: now + NONCE_TTL_MS });
  return input;
}

export async function GET(): Promise<Response> {
  return Response.json(buildSignInInput());
}

// ---------------------------------------------------------------------------
// POST /api/siws/verify  — verify + enforce policy + issue session
// ---------------------------------------------------------------------------
type WireOutput = {
  account: { address: string; publicKey: number[] };
  signature: number[];
  signedMessage: number[];
  signatureType?: 'ed25519';
};

type VerifyBody = {
  method?: 'siws' | 'signMessage';
  input?: SolanaSignInInput; // UNTRUSTED: ignored on purpose — see file header
  output: WireOutput;
};

/** Rebuild a SolanaSignInOutput from JSON. verifySignIn only needs account
 *  publicKey/address + signature + signedMessage; chains/features are filled to
 *  satisfy the WalletAccount type. */
function toOutput(wire: WireOutput): SolanaSignInOutput {
  return {
    account: {
      address: wire.account.address,
      publicKey: new Uint8Array(wire.account.publicKey),
      chains: [],
      features: [],
    },
    signature: new Uint8Array(wire.signature),
    signedMessage: new Uint8Array(wire.signedMessage),
    signatureType: wire.signatureType ?? 'ed25519',
  } as SolanaSignInOutput;
}

export async function POST(req: Request): Promise<Response> {
  let body: VerifyBody;
  try {
    body = (await req.json()) as VerifyBody;
  } catch {
    return fail('Malformed JSON body', 400);
  }
  if (!body?.output) return fail('Missing output', 400);

  const output = toOutput(body.output);

  // 1) Parse the message the wallet ACTUALLY signed and pull its nonce. We use this
  //    to look up the authoritative challenge from OUR store — we do not trust
  //    body.input. parseSignInMessage guarantees `domain` and `address` are present.
  const parsed = parseSignInMessage(output.signedMessage);
  if (!parsed?.nonce) return fail('Could not parse the sign-in message', 400);

  const challenge = challenges.get(parsed.nonce);
  if (!challenge) return fail('Unknown, expired, or already-used nonce', 401); // replay/expiry
  if (Date.now() > challenge.expiresAt) {
    challenges.delete(parsed.nonce);
    return fail('Challenge expired', 401);
  }
  const trustedInput = challenge.input; // authoritative: exactly what WE issued

  // 2) Cryptographic verification against the TRUSTED input (see caveat in header).
  if (!verifySignIn(trustedInput, output)) {
    return fail('Signature verification failed', 401);
  }

  // 3) Application policy — the checks verifySignIn does NOT perform.
  if (parsed.domain !== APP_DOMAIN) return fail('Domain mismatch', 401); // anti-phishing
  if (parsed.nonce !== trustedInput.nonce) return fail('Nonce mismatch', 401);

  const issuedAtMs = parsed.issuedAt ? Date.parse(parsed.issuedAt) : NaN;
  if (!Number.isFinite(issuedAtMs)) return fail('Missing or invalid issuedAt', 401);
  if (Math.abs(Date.now() - issuedAtMs) > ISSUED_AT_SKEW_MS) {
    return fail('issuedAt outside the allowed window', 401);
  }
  if (parsed.expirationTime && Date.now() > Date.parse(parsed.expirationTime)) {
    return fail('Sign-in message expired', 401);
  }
  if (parsed.notBefore && Date.now() < Date.parse(parsed.notBefore)) {
    return fail('Sign-in message not yet valid', 401);
  }

  // 4) Replay protection: burn the nonce so this exact message can never be reused.
  challenges.delete(parsed.nonce);

  // 5) Bind the session to the address from the VERIFIED signed message (not to any
  //    client-supplied field).
  const address = parsed.address;
  const cookie = issueSession(address);

  return new Response(JSON.stringify({ ok: true, address }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'set-cookie': cookie },
  });
}

// ── helpers ─────────────────────────────────────────────────────────────────────────
function fail(error: string, status: number): Response {
  return new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Minimal HMAC-signed session cookie (payload.signature). PRODUCTION: prefer a vetted
 * library — iron-session, jose/JWT, or next-auth — set SESSION_SECRET from env, and
 * serve over HTTPS so `Secure` is honored.
 */
function issueSession(address: string): string {
  const payload = Buffer.from(
    JSON.stringify({ sub: address, iat: Date.now() }),
  ).toString('base64url');
  const sig = createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  const token = `${payload}.${sig}`;
  const maxAge = 60 * 60 * 24; // 1 day
  return `siws_session=${token}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${maxAge}`;
}

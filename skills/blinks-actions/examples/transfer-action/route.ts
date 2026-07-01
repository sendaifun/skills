/**
 * examples/transfer-action/route.ts
 * -----------------------------------------------------------------------------
 * Canonical Solana Action: transfer native SOL.
 *
 * A Next.js App Router Route Handler that exports GET + OPTIONS + POST. This is
 * the complete, spec-correct reference for a parameterized transaction Action.
 *
 * PLACEMENT: copy this to `app/api/actions/transfer/route.ts`. That path matches
 * the companion `examples/actions.json`, which maps the pretty URL `/donate` →
 * `/api/actions/transfer` and self-maps `/api/actions/**`.
 *
 * FLOW (all requests made by the Blink client against this server):
 *   1. OPTIONS  → CORS preflight (MANDATORY — a missing OPTIONS is the #1
 *                 "Blink won't load" cause; clients preflight before every GET).
 *   2. GET      → ActionGetResponse metadata: icon/title/description + a set of
 *                 preset buttons AND a parameterized custom-amount input.
 *   3. POST     → validate the account, build a v0 VersionedTransaction with a
 *                 fresh blockhash, and return it base64-encoded via
 *                 createPostResponse.
 *
 * This example builds a **v0 VersionedTransaction** (the modern default). For a
 * legacy `Transaction` variant see SKILL.md; createPostResponse detects and
 * serializes either.
 *
 * Install:  npm i @solana/actions @solana/web3.js@^1
 * -----------------------------------------------------------------------------
 */

import {
  ActionError,
  ActionGetResponse,
  ActionPostRequest,
  ActionPostResponse,
  createActionHeaders,
  createPostResponse,
} from "@solana/actions";
import {
  clusterApiUrl,
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

// ── Config ───────────────────────────────────────────────────────────────────

/** Default recipient if the request omits a `?to=` query param. */
const DEFAULT_SOL_ADDRESS = new PublicKey(
  "3h4AtoLTh3bWwaLhdtgQtcC3a3Tokvbg9GXkATub6Jh8", // example treasury — replace with yours
);
/** Default amount if the request omits `?amount=`. */
const DEFAULT_SOL_AMOUNT = 1.0;

// The absolute pathname this route lives at. Used to build same-origin action
// hrefs in the GET response. Keep it in sync with actions.json.
const ACTION_PATH = "/api/actions/transfer";

/**
 * CORS + version-negotiation headers for every response on this route.
 * createActionHeaders() returns ACTIONS_CORS_HEADERS plus, because we pass
 * chainId + actionVersion, the X-Blockchain-Ids and X-Action-Version headers —
 * without them the Dialect client warns "Blink compatibility metadata is not set."
 * Switch chainId to "mainnet" and set SOLANA_RPC when going live.
 */
const headers = createActionHeaders({ chainId: "devnet", actionVersion: "2.4" });

// ── GET: metadata (icon, title, buttons, parameterized input) ─────────────────

export const GET = async (req: Request) => {
  try {
    const requestUrl = new URL(req.url);
    const { toPubkey } = validatedQueryParams(requestUrl);

    // Same-origin base href carrying the recipient. The `&amount=...` (fixed) or
    // `&amount={amount}` (input slot) is appended per button below.
    const baseHref = new URL(
      `${ACTION_PATH}?to=${toPubkey.toBase58()}`,
      requestUrl.origin,
    ).toString();

    const payload: ActionGetResponse = {
      type: "action",
      // icon MUST be an absolute HTTPS URL to an SVG, PNG, or WebP image.
      icon: new URL("/solana_devs.jpg", requestUrl.origin).toString(),
      title: "Transfer Native SOL",
      description: "Send SOL to another Solana wallet in one click.",
      // `label` is ignored because links.actions is present (below), but is
      // still required by the type and used as a fallback by some clients.
      label: "Transfer SOL",
      links: {
        actions: [
          // Fixed-amount buttons: no parameters, amount baked into the href.
          { type: "transaction", label: "Send 0.1 SOL", href: `${baseHref}&amount=0.1` },
          { type: "transaction", label: "Send 1 SOL", href: `${baseHref}&amount=1` },
          { type: "transaction", label: "Send 5 SOL", href: `${baseHref}&amount=5` },
          // Custom amount: the {amount} slot is filled from the parameter named
          // "amount". Client validation (min) is advisory — POST re-validates.
          {
            type: "transaction",
            label: "Send SOL", // button text for the custom-amount input
            href: `${baseHref}&amount={amount}`,
            parameters: [
              {
                type: "number",
                name: "amount",
                label: "Enter a SOL amount",
                required: true,
                min: 0.001,
              },
            ],
          },
        ],
      },
    };

    return Response.json(payload, { headers });
  } catch (err) {
    return Response.json(toActionError(err), { status: 400, headers });
  }
};

// ── OPTIONS: CORS preflight (MANDATORY) ───────────────────────────────────────
// Must exist or Blink clients fail preflight and never render the Action.
export const OPTIONS = async () => new Response(null, { headers });

// ── POST: build + return the signable transaction ─────────────────────────────

export const POST = async (req: Request) => {
  try {
    const requestUrl = new URL(req.url);
    const { amount, toPubkey } = validatedQueryParams(requestUrl);

    // The client sends { account: "<base58 pubkey>", data?: {...} }.
    const body: ActionPostRequest = await req.json();

    let account: PublicKey;
    try {
      account = new PublicKey(body.account);
    } catch {
      throw 'Invalid "account" provided';
    }

    const connection = new Connection(
      process.env.SOLANA_RPC || clusterApiUrl("devnet"),
    );

    // Guard: don't strand the recipient below rent-exemption with a dust send.
    const minimumBalance = await connection.getMinimumBalanceForRentExemption(0);
    if (amount * LAMPORTS_PER_SOL < minimumBalance) {
      throw `account may not be rent exempt: ${toPubkey.toBase58()}`;
    }

    const transferIx = SystemProgram.transfer({
      fromPubkey: account,
      toPubkey,
      lamports: Math.round(amount * LAMPORTS_PER_SOL),
    });

    // Fetch a fresh blockhash per POST — never cache built transactions.
    // For an UNSIGNED tx the wallet re-sets feePayer + recentBlockhash anyway,
    // but we set them so the message compiles cleanly.
    const { blockhash } = await connection.getLatestBlockhash();

    // Build a v0 VersionedTransaction (the modern default).
    const message = new TransactionMessage({
      payerKey: account, // the request account pays the fee
      recentBlockhash: blockhash,
      instructions: [transferIx],
    }).compileToV0Message();

    const transaction = new VersionedTransaction(message);

    // createPostResponse serializes + base64-encodes the tx (versioned txs
    // serialize without requiring signatures). It requires ≥1 instruction, else
    // it throws CreatePostResponseError.
    const payload: ActionPostResponse = await createPostResponse({
      fields: {
        type: "transaction", // discriminated-union tag — set it for 2.x correctness
        transaction,
        message: `Send ${amount} SOL to ${toPubkey.toBase58()}`,
      },
      // signers: [extraKeypair],    // extra Signers if the tx needs them
      // actionIdentity: identityKp, // optional attribution memo (see docs/security.md)
    });

    return Response.json(payload, { headers });
  } catch (err) {
    return Response.json(toActionError(err), { status: 400, headers });
  }
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Parse + validate `?to=` (recipient) and `?amount=` from the URL. */
function validatedQueryParams(requestUrl: URL) {
  let toPubkey = DEFAULT_SOL_ADDRESS;
  let amount = DEFAULT_SOL_AMOUNT;

  const to = requestUrl.searchParams.get("to");
  if (to) {
    try {
      toPubkey = new PublicKey(to);
    } catch {
      throw 'Invalid input query parameter: "to"';
    }
  }

  const rawAmount = requestUrl.searchParams.get("amount");
  if (rawAmount) {
    amount = parseFloat(rawAmount);
    if (!Number.isFinite(amount) || amount <= 0) throw "amount is too small";
  }

  return { amount, toPubkey };
}

/** Normalize a thrown value into the spec ActionError shape. */
function toActionError(err: unknown): ActionError {
  return { message: typeof err === "string" ? err : "An unknown error occurred" };
}

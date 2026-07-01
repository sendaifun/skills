/**
 * Parameterized Action — typed inputs (a `select` token + a `number` amount).
 *
 * A "tip the creator" Action: the GET response declares a `select` (SOL / USDC / BONK)
 * and a `number` (amount); the POST reads those values back and builds either a native
 * `SystemProgram.transfer` (SOL) or an SPL `transferChecked` (USDC/BONK) to a treasury.
 *
 * Where this file goes (Next.js App Router):
 *   app/api/actions/parameterized-action/route.ts
 *
 * Dependencies (pin explicitly — the Actions stack is stable/frozen, not deprecated):
 *   @solana/actions   1.6.6   (server SDK, web3.js v1 — NO @solana/kit port)
 *   @solana/web3.js   ^1      (current v1: 1.98.4)
 *   @solana/spl-token 0.4.14  (for the SPL transferChecked path)
 *   npm i @solana/actions @solana/web3.js@^1 @solana/spl-token
 *
 * Notes:
 *   - `type: "transaction"` is set on the POST fields AND on the LinkedAction —
 *     the actions-spec@2.x discriminated-union tag.
 *   - Typed-input values arrive spliced into the href `{name}` slots (→ query string).
 *     They ALSO appear in the POST body `data`; either way, RE-VALIDATE server-side —
 *     the client-side `min`/`max`/`pattern`/`required` are advisory only.
 *   - Full parameter-type reference → ../../docs/typed-inputs-and-chaining.md
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
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  clusterApiUrl,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

// TODO: replace with your own treasury / recipient.
const TREASURY = new PublicKey("3h4AtoLTh3bWwaLhdtgQtcC3a3Tokvbg9GXkATub6Jh8");

// Small registry keyed by the `select` option `value`. `mint: null` = native SOL.
// Decimals are hard-coded for these well-known mainnet mints to avoid a getMint()
// round-trip; fetch them dynamically (getMint) if you accept arbitrary tokens.
const TOKENS: Record<string, { label: string; mint: PublicKey | null; decimals: number }> = {
  SOL: { label: "SOL", mint: null, decimals: 9 },
  USDC: { label: "USDC", mint: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"), decimals: 6 },
  BONK: { label: "BONK", mint: new PublicKey("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"), decimals: 5 },
};

// Advertise the spec version + chain so clients don't warn "compatibility metadata not set".
const headers = createActionHeaders({ chainId: "mainnet", actionVersion: "2.4" });

export const GET = async (req: Request) => {
  const { origin } = new URL(req.url);
  const baseHref = "/api/actions/parameterized-action";

  const payload: ActionGetResponse = {
    type: "action",
    icon: new URL("/icon.png", origin).toString(), // absolute HTTPS SVG/PNG/WebP
    title: "Tip the creator",
    description: "Pick a token and an amount, then sign to send it to the treasury.",
    label: "Send tip", // ignored because links.actions is present
    links: {
      actions: [
        {
          type: "transaction",
          label: "Send tip",
          // `{token}` and `{amount}` are spliced into the query string by the client.
          href: `${baseHref}?token={token}&amount={amount}`,
          parameters: [
            {
              type: "select", // selectable input → REQUIRES options[]
              name: "token",
              label: "Token",
              required: true,
              options: [
                { label: "SOL", value: "SOL", selected: true },
                { label: "USDC", value: "USDC" },
                { label: "BONK", value: "BONK" },
              ],
            },
            {
              type: "number",
              name: "amount",
              label: "Amount",
              required: true,
              min: 0.000001, // advisory — enforced again in POST below
            },
          ],
        },
      ],
    },
  };

  return Response.json(payload, { headers });
};

// MANDATORY: without OPTIONS the CORS preflight fails and the Blink never renders.
export const OPTIONS = async () => new Response(null, { headers });

export const POST = async (req: Request) => {
  try {
    const url = new URL(req.url);

    // Read the typed inputs from the query string (where the href slots put them).
    // Alternatively they are in the POST body `data` (body.data.token / body.data.amount).
    const symbol = (url.searchParams.get("token") ?? "").toUpperCase();
    const token = TOKENS[symbol];
    if (!token) throw `Unsupported token "${symbol}"`;

    const amount = Number(url.searchParams.get("amount"));
    if (!Number.isFinite(amount) || amount <= 0) throw "Invalid amount";

    const body: ActionPostRequest = await req.json();
    let account: PublicKey;
    try {
      account = new PublicKey(body.account);
    } catch {
      throw 'Invalid "account" provided';
    }

    const connection = new Connection(process.env.SOLANA_RPC || clusterApiUrl("mainnet-beta"));
    const transaction = new Transaction();

    if (token.mint === null) {
      // Native SOL transfer.
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: account,
          toPubkey: TREASURY,
          lamports: Math.round(amount * LAMPORTS_PER_SOL),
        }),
      );
    } else {
      // SPL token — ALWAYS transferChecked (carries mint + decimals; never plain transfer).
      const source = getAssociatedTokenAddressSync(token.mint, account, false, TOKEN_PROGRAM_ID);
      const destination = getAssociatedTokenAddressSync(token.mint, TREASURY, false, TOKEN_PROGRAM_ID);
      // scale the human amount to the mint's base units (bigint avoids float overflow).
      const rawAmount = BigInt(Math.round(amount * 10 ** token.decimals));

      transaction.add(
        // Create the treasury ATA if it doesn't exist yet (idempotent; the signer pays rent).
        createAssociatedTokenAccountIdempotentInstruction(
          account,
          destination,
          TREASURY,
          token.mint,
          TOKEN_PROGRAM_ID,
        ),
        createTransferCheckedInstruction(
          source,
          token.mint,
          destination,
          account,
          rawAmount,
          token.decimals,
          [],
          TOKEN_PROGRAM_ID,
        ),
      );
    }

    // The wallet re-sets both for an unsigned tx, but set them so the tx serializes cleanly.
    transaction.feePayer = account;
    transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    const payload: ActionPostResponse = await createPostResponse({
      fields: {
        type: "transaction", // discriminated-union tag for actions-spec 2.x
        transaction,
        message: `Sending ${amount} ${token.label} to the treasury — thank you!`,
      },
    });

    return Response.json(payload, { headers });
  } catch (err) {
    const actionError: ActionError = { message: typeof err === "string" ? err : "Unknown error" };
    return Response.json(actionError, { status: 400, headers });
  }
};

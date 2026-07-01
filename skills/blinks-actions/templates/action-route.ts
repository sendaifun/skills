/**
 * templates/action-route.ts — drop-in Solana Action route (Next.js App Router).
 *
 * Copy to:  app/api/actions/<your-action>/route.ts
 * Fill in every TODO. Keep all three handlers — OPTIONS is MANDATORY.
 *
 * Dependencies (pin explicitly — stable/frozen, not deprecated):
 *   @solana/actions 1.6.6 (server SDK, web3.js v1 — NO @solana/kit port)
 *   @solana/web3.js ^1    (current v1: 1.98.4)
 *   npm i @solana/actions @solana/web3.js@^1
 *
 * See also: ../examples/parameterized-action/route.ts (typed inputs),
 *           ../examples/chained-action/route.ts (chaining), ../docs/security.md.
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
  PublicKey,
  SystemProgram,
  Transaction,
  clusterApiUrl,
} from "@solana/web3.js";

// TODO: the account that receives funds / the authority your instruction needs.
const TREASURY = new PublicKey("11111111111111111111111111111111"); // TODO: replace

// CORS + X-Action-Version + X-Blockchain-Ids. Passing chainId/actionVersion avoids the
// client's "Blink compatibility metadata is not set" warning.
const headers = createActionHeaders({
  chainId: "mainnet", // TODO: "mainnet" | "devnet" | "testnet"
  actionVersion: "2.4",
});

export const GET = async (req: Request) => {
  const { origin } = new URL(req.url);

  const payload: ActionGetResponse = {
    type: "action",
    icon: new URL("/icon.png", origin).toString(), // TODO: absolute HTTPS SVG/PNG/WebP
    title: "TODO: action title",
    description: "TODO: one-line description of what signing does.",
    label: "TODO: button text", // used when links.actions is omitted (single button)

    // Single-button form: omit `links.actions` — the client POSTs to THIS url using the
    // root `label` above.
    //
    // Multi-button / typed-input form — uncomment and customise:
    // links: {
    //   actions: [
    //     { type: "transaction", label: "0.1 SOL", href: "/api/actions/<your-action>?amount=0.1" },
    //     {
    //       type: "transaction",
    //       label: "Send",
    //       href: "/api/actions/<your-action>?amount={amount}",
    //       parameters: [
    //         { type: "number", name: "amount", label: "Amount", required: true, min: 0.001 },
    //       ],
    //     },
    //   ],
    // },
  };

  return Response.json(payload, { headers });
};

// MANDATORY: without OPTIONS the CORS preflight fails and the Blink never renders.
export const OPTIONS = async () => new Response(null, { headers });

export const POST = async (req: Request) => {
  try {
    const body: ActionPostRequest = await req.json();

    // Validate the signer pubkey the client sent.
    let account: PublicKey;
    try {
      account = new PublicKey(body.account);
    } catch {
      throw 'Invalid "account" provided';
    }

    // TODO: read + RE-VALIDATE any typed inputs. Client pattern/min/max/required is advisory.
    // const url = new URL(req.url);
    // const amount = Number(url.searchParams.get("amount"));
    // if (!Number.isFinite(amount) || amount <= 0) throw "Invalid amount";

    const connection = new Connection(process.env.SOLANA_RPC || clusterApiUrl("devnet"));

    // TODO: build your transaction. It must contain >= 1 instruction.
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: account,
        toPubkey: TREASURY,
        lamports: 1_000_000, // TODO: replace with your real amount / instructions
      }),
    );

    // The wallet re-sets both for an unsigned tx, but set them so the tx serializes cleanly.
    transaction.feePayer = account;
    transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    const payload: ActionPostResponse = await createPostResponse({
      fields: {
        type: "transaction", // discriminated-union tag — required for actions-spec 2.x
        transaction,
        message: "TODO: confirmation message shown to the user",
        // Chain a next step (SAME-ORIGIN) — optional:
        // links: { next: { type: "post", href: "/api/actions/<your-action>/next-action" } },
      },
      // signers: [extraKeypair],          // extra Signers, if the tx needs them
      // actionIdentity: identityKeypair,  // optional attribution memo (see docs/security.md)
    });

    return Response.json(payload, { headers });
  } catch (err) {
    const actionError: ActionError = {
      message: typeof err === "string" ? err : "Unknown error",
    };
    return Response.json(actionError, { status: 400, headers });
  }
};

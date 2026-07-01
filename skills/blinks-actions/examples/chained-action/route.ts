/**
 * Chained Action — step 1 of 2 (build a transaction + point to the next action).
 *
 * A user posts a message on-chain via the SPL Memo program. The POST returns the
 * transaction AND `links.next` → a SAME-ORIGIN callback. After the tx confirms, the
 * client POSTs `{ account, signature }` to that callback, which verifies the tx and
 * renders a terminal "completed" screen.
 *
 * Where this file goes (Next.js App Router):
 *   app/api/actions/chained-action/route.ts
 *   (the callback lives at app/api/actions/chained-action/next-action/route.ts —
 *    see the sibling `next-action-route.ts` in this folder)
 *
 * Dependencies:
 *   @solana/actions 1.6.6 (server SDK, web3.js v1) · @solana/web3.js ^1 (1.98.4)
 *   npm i @solana/actions @solana/web3.js@^1
 *
 * Full chaining walkthrough → ../../docs/typed-inputs-and-chaining.md
 * Mirrors the official solana-developers/solana-actions `chaining-basics` example.
 */
import {
  ActionError,
  ActionGetResponse,
  ActionPostRequest,
  ActionPostResponse,
  MEMO_PROGRAM_ID,
  createActionHeaders,
  createPostResponse,
} from "@solana/actions";
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  clusterApiUrl,
} from "@solana/web3.js";

const headers = createActionHeaders({ chainId: "devnet", actionVersion: "2.4" });

export const GET = async (req: Request) => {
  const { origin } = new URL(req.url);

  const payload: ActionGetResponse = {
    type: "action",
    icon: new URL("/icon.png", origin).toString(),
    title: "On-chain Memo (chained)",
    description:
      "Post a message on-chain. After it confirms, the chain advances to a success " +
      "screen that verifies your transaction server-side.",
    label: "Send Memo",
    links: {
      actions: [
        {
          type: "transaction",
          label: "Send Memo",
          // No `{memo}` slot in the href → the value arrives in the POST body `data`.
          href: "/api/actions/chained-action",
          parameters: [
            {
              type: "textarea",
              name: "memo",
              label: "Message to post on-chain",
              required: true,
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
    const body: ActionPostRequest<{ memo: string }> = await req.json();

    let account: PublicKey;
    try {
      account = new PublicKey(body.account);
    } catch {
      throw 'Invalid "account" provided';
    }

    const memo = body.data?.memo;
    if (!memo || typeof memo !== "string") throw 'Invalid "memo" provided';

    const connection = new Connection(process.env.SOLANA_RPC || clusterApiUrl("devnet"));

    const transaction = new Transaction().add(
      // createPostResponse requires >= 1 NON-memo instruction — include a real one.
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
      new TransactionInstruction({
        programId: new PublicKey(MEMO_PROGRAM_ID), // MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr
        data: Buffer.from(memo, "utf8"),
        keys: [],
      }),
    );

    // The wallet re-sets both for an unsigned tx, but set them so the tx serializes cleanly.
    transaction.feePayer = account;
    transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    const payload: ActionPostResponse = await createPostResponse({
      fields: {
        type: "transaction",
        transaction,
        message: "Post this memo on-chain",
        links: {
          // The chaining hook. `type:"post"` = the client POSTs { account, signature }
          // to this href AFTER the tx confirms, then renders the returned NextAction.
          // The href MUST be SAME-ORIGIN as this route or the client refuses to call it.
          next: {
            type: "post",
            href: "/api/actions/chained-action/next-action",
          },
        },
      },
    });

    return Response.json(payload, { headers });
  } catch (err) {
    const actionError: ActionError = { message: typeof err === "string" ? err : "Unknown error" };
    return Response.json(actionError, { status: 400, headers });
  }
};

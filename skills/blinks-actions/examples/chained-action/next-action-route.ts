/**
 * Chained Action — step 2 of 2: the same-origin "next action" callback.
 *
 * This is the SECURITY-CRITICAL step. It receives { account, signature } after step 1's
 * transaction confirms, VERIFIES on-chain that the transaction actually did the expected
 * thing (via getParsedTransaction), and returns a terminal CompletedAction.
 *
 * Where this file goes (Next.js App Router) — note the `next-action/` SUBDIRECTORY, which
 * is why step 1's `links.next.href` is "/api/actions/chained-action/next-action":
 *   app/api/actions/chained-action/next-action/route.ts
 *
 * Dependencies:
 *   @solana/actions 1.6.6 (server SDK, web3.js v1) · @solana/web3.js ^1 (1.98.4)
 *   npm i @solana/actions @solana/web3.js@^1
 *
 * Threat model → ../../docs/security.md · chaining walkthrough → ../../docs/typed-inputs-and-chaining.md
 */
import {
  ActionError,
  CompletedAction,
  MEMO_PROGRAM_ID,
  NextActionPostRequest,
  createActionHeaders,
} from "@solana/actions";
import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";

const headers = createActionHeaders({ chainId: "devnet", actionVersion: "2.4" });

// Callback-only endpoint: reject GET, but STILL answer OPTIONS for the CORS preflight.
export const GET = async () =>
  Response.json({ message: "Method not supported" } as ActionError, { status: 403, headers });

export const OPTIONS = async () => new Response(null, { headers });

export const POST = async (req: Request) => {
  try {
    const body: NextActionPostRequest = await req.json();

    let account: PublicKey;
    try {
      account = new PublicKey(body.account);
    } catch {
      throw 'Invalid "account" provided';
    }

    const signature = body.signature;
    if (!signature) throw 'Invalid "signature" provided';

    const connection = new Connection(process.env.SOLANA_RPC || clusterApiUrl("devnet"));

    // 1) Confirm the signature landed and is at least `confirmed`.
    const status = await connection.getSignatureStatus(signature, {
      searchTransactionHistory: true,
    });
    const confirmationStatus = status.value?.confirmationStatus;
    if (confirmationStatus !== "confirmed" && confirmationStatus !== "finalized") {
      throw "Unable to confirm the transaction";
    }

    // ─────────────────────────────────────────────────────────────────────────────
    //  !TAKE CAUTION!
    //  This is a PUBLIC POST endpoint. Any client can call it with ANY valid, confirmed
    //  `signature` — including one from a completely unrelated transaction. Confirming
    //  the signature STATUS (above) is therefore NOT ENOUGH: status alone is spoofable,
    //  so an attacker could advance the chain — or trigger downstream logic like
    //  crediting a database / minting a reward — without ever doing what you asked.
    //
    //  You MUST fetch the actual transaction and verify it performed the expected action.
    //  Below we assert (a) the claimed `account` really signed it, and (b) it actually
    //  invoked the SPL Memo program. Harden further in production: match an Action
    //  Identity memo/reference you embedded (docs/security.md), assert exact amounts /
    //  destinations / program IDs, and guard against replay of a previously-used sig.
    // ─────────────────────────────────────────────────────────────────────────────
    const tx = await connection.getParsedTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (!tx) throw "Transaction not found";

    // (a) the claimed account must actually be a signer of this transaction.
    const isSigner = tx.transaction.message.accountKeys.some(
      (key) => key.signer && key.pubkey.equals(account),
    );
    if (!isSigner) throw "Transaction was not signed by the expected account";

    // (b) the transaction must actually contain a Memo-program instruction.
    const invokedMemo = tx.transaction.message.instructions.some(
      (ix) => ix.programId.toBase58() === MEMO_PROGRAM_ID,
    );
    if (!invokedMemo) throw "Transaction did not invoke the Memo program";

    const payload: CompletedAction = {
      type: "completed", // terminal — a CompletedAction cannot chain further (omits `links`)
      title: "Memo posted on-chain!",
      icon: new URL("/icon.png", new URL(req.url).origin).toString(),
      label: "Complete!",
      description: `Verified signature: ${signature}`,
    };

    return Response.json(payload, { headers });
  } catch (err) {
    const actionError: ActionError = { message: typeof err === "string" ? err : "Unknown error" };
    return Response.json(actionError, { status: 400, headers });
  }
};

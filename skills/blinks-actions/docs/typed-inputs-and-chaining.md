# Typed Inputs & Action Chaining — Reference

The long-form reference behind the "Typed inputs" and "Chaining actions" sections of `SKILL.md`. It
covers the 10 `ActionParameterType`s and the exact `ActionParameter` / `ActionParameterSelectable`
shapes, how user input is spliced into a `LinkedAction`'s `href`, and how `links.next` chains one
action into the next — ending with the **load-bearing security rule**: the next-action callback is a
public endpoint, so you must `getParsedTransaction` and verify the transaction actually did what you
expected, not merely that a signature confirmed.

Runnable copies of the chained example live in `examples/chained-action/route.ts` +
`examples/chained-action/next-action-route.ts`. The untrusted-transaction threat model is
`docs/security.md`. All types are from `@solana/actions-spec@2.4.2`, re-exported by
`@solana/actions@1.6.6`.

---

## Part 1 — Typed inputs

Attach a `parameters[]` array to any `LinkedAction`. Each parameter renders as a form field; the
value the user enters is spliced into the matching `{name}` slot in that action's `href`, and the
completed URL is what the client POSTs.

### 1.1 The 10 `ActionParameterType`s

```ts
type GeneralParameterType =
  | "text" | "email" | "url" | "number"
  | "date" | "datetime-local" | "textarea";

type SelectableParameterType = "select" | "radio" | "checkbox";

export type ActionParameterType = GeneralParameterType | SelectableParameterType;
// @default "text" — an unknown/unsupported value falls back to a plain text input.
```

| Type | Renders as | Returns | Notes |
|---|---|---|---|
| `text` | `<input type="text">` | `string` | Default when `type` is omitted or unknown. |
| `email` | `<input type="email">` | `string` | Client-side email shape hint only. |
| `url` | `<input type="url">` | `string` | Client-side URL shape hint only. |
| `number` | `<input type="number">` | `string` | `min`/`max` are **numeric** bounds. |
| `date` | `<input type="date">` | `string` | `min`/`max` are **ISO date strings**. |
| `datetime-local` | `<input type="datetime-local">` | `string` | `min`/`max` are **ISO date strings**. |
| `textarea` | `<textarea>` | `string` | `min`/`max` = **character length**. |
| `select` | dropdown (single) | `string` | Requires `options[]`. |
| `radio` | radio group (single) | `string` | Requires `options[]`. `min`/`max` = `never`. |
| `checkbox` | checkbox group (multi) | **`string[]`** | Requires `options[]`. Returns an **array**. |

HTML types that are **not** supported: `hidden`, `button`, `submit`, `file`, `password`, etc.

### 1.2 `ActionParameter` (non-selectable)

```ts
export interface ActionParameter<T extends ActionParameterType, M = MinMax<T>> {
  /** input field type (defaults to "text") */
  type?: T;
  /** parameter name — matches the {name} slot in the LinkedAction href */
  name: string;
  /** placeholder / field label */
  label?: string;
  /** defaults to false */
  required?: boolean;
  /** regex string for client-side validation (ignored if not a valid regex) */
  pattern?: string;
  /** human-readable caption/error — REQUIRED whenever `pattern` is provided */
  patternDescription?: string;
  /** min bound — meaning depends on `type` (see MinMax) */
  min?: M;
  /** max bound — same rules as min */
  max?: M;
}

// The element type of min/max depends on the input type:
type MinMax<T extends ActionParameterType> =
  T extends "date" | "datetime-local" ? string
  : T extends "radio" | "select" ? never
  : number;
```

**`min`/`max` semantics by type:**

- `number` → **numeric** bounds (`min: 0.1, max: 100`).
- `date` / `datetime-local` → **ISO date strings** (`min: "2026-01-01"`).
- `text` / `email` / `url` / `textarea` → **character length** (`max: 280` = 280 chars).
- `radio` / `select` → `never` (bounds are meaningless; the choice is constrained by `options[]`).

**`pattern` + `patternDescription`:** `pattern` is a regex string for client-side validation;
`patternDescription` is the human-readable caption shown on mismatch and is **required whenever
`pattern` is set** (the type enforces the pairing conceptually — always supply both).

### 1.3 `ActionParameterSelectable` (`select` / `radio` / `checkbox`)

```ts
export interface ActionParameterSelectable<T extends ActionParameterType>
  extends Omit<ActionParameter<T>, "pattern"> {
  options: Array<{
    label: string;       // displayed option label
    value: string;       // value submitted for this option
    selected?: boolean;  // default-selected?
  }>;
}

// The union that LinkedAction.parameters actually uses:
export type TypedActionParameter<T extends ActionParameterType = ActionParameterType> =
  T extends SelectableParameterType
    ? ActionParameterSelectable<T>
    : ActionParameter<T>;
```

All three selectable types **require** an `options[]` array. `select` and `radio` are single-choice;
**`checkbox` is multi-choice and its selected `value`s come back as a `string[]`** in the POST body
`data` (see §1.5). `selected: true` marks a default; note `pattern` is `Omit`ted for selectables.

### 1.4 Parameterized `href` — `{name}` slots

The user's input is spliced into the `LinkedAction.href` wherever `{name}` appears. The slot can sit
in a **query param** or a **subpath**:

```ts
// query param (most common)
{ type: "transaction", label: "Send SOL", href: "/api/actions/transfer?amount={amount}",
  parameters: [{ type: "number", name: "amount", label: "SOL amount", required: true, min: 0.001 }] }

// subpath
{ type: "transaction", label: "Send SOL", href: "/api/actions/transfer/{amount}",
  parameters: [{ type: "number", name: "amount", label: "SOL amount", required: true }] }
```

A full `select` example with defaults:

```ts
parameters: [
  { type: "number", name: "amount", label: "SOL amount", required: true, min: 0.1, max: 100 },
  { type: "textarea", name: "note", label: "Optional note", max: 280 },
  {
    type: "select",
    name: "tier",
    label: "Membership tier",
    required: true,
    options: [
      { label: "Basic", value: "basic", selected: true },
      { label: "Pro",   value: "pro" },
    ],
  },
]
```

Multiple slots compose in one `href`:
`/api/actions/vote?choice={choice}&amount={amount}&note={note}&agree={agree}`.

### 1.5 Reading input server-side — and the security rule

In your `POST`, read values from the **query string** (for `{name}` slots) and/or from the request
body's **`data`** map:

```ts
export const POST = async (req: Request) => {
  const url = new URL(req.url);
  const amount = Number(url.searchParams.get("amount"));           // from {amount} in the href
  const body: ActionPostRequest<{ tier: string; agree: string[] }> = await req.json();

  const tier = body.data?.tier;         // string (select/radio)
  const agree = body.data?.agree ?? []; // string[]  ← checkbox returns an ARRAY
  // ...
};
```

> **Client-side validation is advisory. Enforce every constraint in `POST`.** `pattern`, `min`,
> `max`, and `required` are hints the client *may* apply before POSTing — a hostile or buggy client
> can send anything. Re-validate `account` (construct a `PublicKey` in a `try/catch`), re-check
> numeric ranges, string lengths, and allowed option values on the server before you build the
> transaction. Never trust that a value satisfies its declared constraint.

Lookup tables for every type and operator are in `resources/api-reference.md`.

---

## Part 2 — Action chaining (`links.next`)

Return `links.next` in any `ActionPostResponse` to render a **next action** after the current step
resolves — for multi-step flows, personalized success screens, and (critically) **server-side
verification** of what just happened on-chain.

### 2.1 The chaining types

```ts
export interface ActionResponse {
  type?: PostActionType;             // "transaction" | "message" | "post" | "external-link"
  message?: string;
  links?: { next: NextActionLink };  // the chaining hook
}

export type NextActionLink = PostNextActionLink | InlineNextActionLink;

export interface PostNextActionLink {
  type: "post";
  href: string;   // SAME-ORIGIN callback — receives NextActionPostRequest, returns a NextAction
}
export interface InlineNextActionLink {
  type: "inline";
  action: NextAction; // embedded and rendered immediately — NO callback is made
}

export type NextAction = Action<"action"> | CompletedAction;

/** Terminal state — note it OMITS `links`, so a chain cannot continue past it: */
export type CompletedAction = Omit<Action<"completed">, "links">;

// The body the "post" callback receives:
export interface NextActionPostRequest extends Omit<ActionPostRequest, "type"> {
  account: string;      // base58 pubkey
  signature?: string;   // tx signature (or message signature) from the previous step
  state?: string;       // opaque value relayed back verbatim (round-trip state)
}
```

### 2.2 How the client drives the chain

- After a `type: "transaction"` step **confirms on-chain** (or a `type: "post"` step resolves with
  no signing pop-up), the client follows `links.next`:
  - **`type: "post"`** → the client POSTs `{ account, signature, state? }` (`NextActionPostRequest`)
    to `href` and renders whatever `NextAction` you return.
  - **`type: "inline"`** → the client renders the embedded `action` immediately, with **no**
    callback request.
- Return a `CompletedAction` (`type: "completed"`) to end the chain — it updates the Blink's
  icon/title/description but renders no further buttons (it omits `links`).
- **Absence of `links.next`** ⇒ the client shows its own generic "completed" state after
  confirmation.

### 2.3 Same-origin is a security boundary

> *"If the callback url is not the same origin as the initial POST request, no callback request
> should be made."*

A `post` next-action `href` **must be same-origin** with the initial POST. A cross-origin `href`
makes the client show an error and skip the callback — this prevents a chain from redirecting a
user's confirmed activity off-domain to an attacker. Use a **relative** `href`
(`/api/actions/vote/next`) or a same-origin absolute one.

### 2.4 State round-trip

`state` is echoed back **verbatim** in `NextActionPostRequest.state`, so use it to carry step context
across the callback. Two patterns:

- **Simple step tracking:** put `?step=2` in the callback `href` query string.
- **Trust-verified state:** put a **MAC/JWT signed with a server secret** in `state`. Because it
  round-trips unchanged, the server can verify its own signature on the way back and trust the
  embedded data (user id, step, amount) without a database lookup. This is also how **sign-message**
  chains (spec 2.4) carry anti-replay context — for those, `links.next` is **required** and must be a
  `post` link so the server can verify the returned signature. See `docs/security.md`.

### 2.5 The load-bearing security rule

**The `post` next-action endpoint is public.** Any client can POST to it with **any** valid
`signature`. Confirming the signature *status* is **not enough** — a confirmed signature only proves
*some* transaction landed, not that it was *your* transaction doing *your* action. An attacker can
replay an unrelated confirmed signature to advance the chain or trigger downstream logic (mint a
reward, mark a task done, etc.).

You **must** fetch the transaction with `getParsedTransaction(signature)` and verify it actually
performed the expected action — matching the program IDs, accounts, and amounts you issued, ideally
by matching an **Action Identity memo/reference** you embedded via `createPostResponse` (see
`docs/security.md`).

```ts
// In the next-action POST handler:
const status = await connection.getSignatureStatus(signature);
const confirmed = status.value?.confirmationStatus;
if (confirmed !== "confirmed" && confirmed !== "finalized") throw "Unable to confirm the transaction";

// !TAKE CAUTION! signature status ALONE is spoofable — any confirmed signature would pass here.
// Fetch the actual transaction and assert it did what YOU issued:
const tx = await connection.getParsedTransaction(signature, "confirmed");
// e.g. assert tx.transaction.message contains your program/instruction, the right accounts,
// the right lamport/token amount, and (best) your Action Identity reference. Reject otherwise.
```

### 2.6 Full chained example (two same-origin routes)

The official `chaining-basics` pattern: step 1 builds a memo transaction and points `links.next` at a
**same-origin** callback; step 2 confirms the signature, verifies the transaction, and returns a
`CompletedAction`. This is the deep-dive copy — the runnable files are
`examples/chained-action/route.ts` and `examples/chained-action/next-action-route.ts`.

**Step 1 — `app/api/actions/chaining-basics/route.ts`** (build tx + set `links.next`):

```ts
import {
  ActionError,
  ActionGetResponse,
  ActionPostRequest,
  ActionPostResponse,
  createActionHeaders,
  createPostResponse,
  MEMO_PROGRAM_ID,
} from "@solana/actions";
import {
  clusterApiUrl,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

const headers = createActionHeaders({ chainId: "devnet", actionVersion: "2.4" });

export const GET = async (req: Request) => {
  const payload: ActionGetResponse = {
    type: "action",
    title: "Simple Action Chaining Example",
    icon: new URL("/icon.png", new URL(req.url).origin).toString(),
    description: "Send a memo on-chain, then see a personalized success screen.",
    label: "Send Memo",
    links: {
      actions: [
        {
          type: "transaction",
          href: "/api/actions/chaining-basics",
          label: "Send Memo",
          parameters: [
            {
              type: "textarea",
              name: "memo",
              label: "Send a message on-chain using a Memo",
              patternDescription: "Short message here",
              required: true,
            },
          ],
        },
      ],
    },
  };
  return Response.json(payload, { headers });
};

// MANDATORY CORS preflight.
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

    const memoMessage = body.data?.memo;
    if (!memoMessage) throw 'Invalid "memo" provided';

    const connection = new Connection(process.env.SOLANA_RPC || clusterApiUrl("devnet"));

    // createPostResponse requires >= 1 NON-memo instruction, so pair the memo with a
    // ComputeBudget ix (otherwise Action-Identity injection would throw on a memo-only tx).
    const transaction = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
      new TransactionInstruction({
        programId: new PublicKey(MEMO_PROGRAM_ID),
        data: Buffer.from(memoMessage, "utf8"),
        keys: [], // Memo with no accounts — required so the account-set stays non-signer
      }),
    );
    transaction.feePayer = account; // end user pays; wallet re-sets for an unsigned tx
    transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    const payload: ActionPostResponse = await createPostResponse({
      fields: {
        type: "transaction",
        transaction,
        message: "Post this memo on-chain",
        links: {
          // SAME-ORIGIN callback — a cross-origin href would be skipped with an error.
          next: { type: "post", href: "/api/actions/chaining-basics/next-action" },
        },
      },
    });

    return Response.json(payload, { headers });
  } catch (err) {
    const actionError: ActionError = {
      message: typeof err === "string" ? err : "An unknown error occurred",
    };
    return Response.json(actionError, { status: 400, headers });
  }
};
```

**Step 2 — `app/api/actions/chaining-basics/next-action/route.ts`** (verify + complete):

```ts
import {
  ActionError,
  CompletedAction,
  createActionHeaders,
  NextActionPostRequest,
} from "@solana/actions";
import { clusterApiUrl, Connection, PublicKey } from "@solana/web3.js";

const headers = createActionHeaders({ chainId: "devnet", actionVersion: "2.4" });

// Callback-only endpoint: reject GET, but still answer the OPTIONS preflight.
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

    // 1) Confirm the previous step's signature.
    const status = await connection.getSignatureStatus(signature);
    const confirmed = status.value?.confirmationStatus;
    if (confirmed !== "confirmed" && confirmed !== "finalized") {
      throw "Unable to confirm the transaction";
    }

    // 2) !TAKE CAUTION! This is a PUBLIC endpoint — any client can call it with ANY valid
    //    signature. Signature status alone is spoofable. Fetch the transaction and verify it
    //    actually performed YOUR action before doing anything trust-sensitive.
    const tx = await connection.getParsedTransaction(signature, "confirmed");
    if (!tx) throw "Transaction not found";
    // ...assert tx.transaction.message instructions/accounts/amounts match what you issued,
    //    ideally by matching your Action Identity reference (see docs/security.md)...

    const payload: CompletedAction = {
      type: "completed",
      title: "Chaining was successful!",
      icon: new URL("/icon.png", new URL(req.url).origin).toString(),
      label: "Complete!",
      description: `Signature from the last action: ${signature}`,
    };
    return Response.json(payload, { headers });
  } catch (err) {
    const actionError: ActionError = {
      message: typeof err === "string" ? err : "An unknown error occurred",
    };
    return Response.json(actionError, { status: 400, headers });
  }
};
```

Notes on why this shape is correct:

- **The `ComputeBudget` ix is not optional flavor** — `createPostResponse` (when Action Identity is
  in play) injects its identity/reference keys onto the **first non-memo** instruction and throws on
  a memo-only tx. Pairing the memo with a real instruction keeps the pattern robust.
- **The callback's `GET` returns 403** because a next-action endpoint is not meant to be fetched as
  metadata — but `OPTIONS` still must exist for CORS.
- **`CompletedAction` omits `links`** — it is terminal by type. To chain further instead, return a
  regular `Action<"action">` with its own `links.next`.

## References

- Actions spec — action chaining — https://solana.com/docs/advanced/actions
- Official `chaining-basics` example — https://github.com/solana-developers/solana-actions/tree/main/examples/next-js/src/app/api/actions/chaining-basics
- `@solana/actions-spec` types — https://github.com/solana-developers/solana-actions/blob/main/packages/actions-spec/index.d.ts

**See also:** `docs/actions-spec.md` (GET/POST shapes, `createPostResponse`, headers),
`docs/security.md` (untrusted-tx model, Action Identity memo verification, sign-message anti-replay),
`resources/api-reference.md` (param-type + operator lookup tables),
`examples/chained-action/*` (runnable two-route chain).

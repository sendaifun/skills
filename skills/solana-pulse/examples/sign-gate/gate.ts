// Pre-sign gate for an agent or bot, using Solana Pulse over plain HTTP. No dependencies (Node 18+ fetch).
//
//   const decision = await gate(base64Tx, { token: USDC_MINT, amount: "5", to: RECIPIENT });
//   if (decision.action === "sign") { /* sign and send */ }
//
// "sign": tx_matches said MATCH (when there was a request) and check_tx said OK.
// "ask":  check_tx said REVIEW; show the reasons to a person before signing.
// "stop": MISMATCH or BLOCK; don't sign.

const PULSE = process.env.PULSE_URL ?? "https://solana-pulse-gateway-1021990235790.us-central1.run.app";

export type Expected =
  | { action?: "transfer"; token: string; amount: string; to: string; from?: string }
  | { action: "swap"; sell: string; amount: string; buy: string; from?: string };

export type Decision = { action: "sign" | "ask" | "stop"; reason: string; details: unknown };

async function call(tool: string, body: object): Promise<any> {
  const res = await fetch(`${PULSE}/api/tools/${tool}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 402) {
    // Free calls for this tool are used up today. Pay with x402 or wait for 00:00 UTC.
    throw new Error(`${tool}: payment required (free daily calls used)`);
  }
  if (!res.ok) throw new Error(`${tool}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

export async function gate(tx: string, expected?: Expected): Promise<Decision> {
  if (expected) {
    const match = await call("tx_matches", { tx, expected });
    if (match.verdict !== "MATCH") {
      return { action: "stop", reason: match.summary, details: match.compared };
    }
  }
  const check = await call("check_tx", { tx });
  const problems = (check.checks ?? []).filter((c: any) => c.result === "warn" || c.result === "fail");
  if (check.verdict === "BLOCK") return { action: "stop", reason: check.summary, details: problems };
  if (check.verdict === "REVIEW") {
    return { action: "ask", reason: check.summary, details: { problems, balance_changes: check.balance_changes } };
  }
  return { action: "sign", reason: check.summary, details: check.balance_changes };
}

// Try it: node gate.ts   (uses Pulse's own live example transaction)
if (import.meta.url === `file://${process.argv[1]}`) {
  const example = await (await fetch(`${PULSE}/api/tools/tx_matches/example`)).json();
  const { tx, expected } = example.arguments;
  console.log(await gate(tx, expected));
}

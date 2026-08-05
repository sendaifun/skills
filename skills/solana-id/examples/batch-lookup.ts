/**
 * Solana ID — Batch SOLID Score Lookup
 *
 * Looks up SOLID Scores for multiple wallets sequentially with a configurable
 * delay between requests to respect rate limits. Outputs a summary table
 * sorted by score (highest first).
 *
 * The API does not have a native batch endpoint, so this helper makes
 * individual requests with a small delay between each.
 *
 * Prerequisites:
 *   - Get a free API key at https://portal.solana.id
 *   - Set the SOLANA_ID_API_KEY environment variable
 *
 * Usage:
 *   npx tsx batch-lookup.ts <wallet1> <wallet2> [wallet3...]
 */

const API_BASE = "https://backend.app.solana.id/api";

interface SolidScoreResponse {
  solidUser: {
    solidScore: number;
    badges: string[];
    tierGroup: "tier_1" | "tier_2" | "tier_3" | "tier_4";
    dataPoints: Record<string, number>;
    isSolanaIdUser: boolean;
  } | null;
  status: "up_to_date" | "outdated" | "calculating";
}

async function getSolidScore(walletAddress: string): Promise<SolidScoreResponse> {
  const apiKey = process.env.SOLANA_ID_API_KEY;
  if (!apiKey) {
    throw new Error("Missing SOLANA_ID_API_KEY. Get one at https://portal.solana.id");
  }

  const response = await fetch(
    `${API_BASE}/solid-score/address/${walletAddress}`,
    { headers: { "x-api-key": apiKey } }
  );

  if (response.status === 429) {
    throw new Error(`Rate limit exceeded while fetching ${walletAddress}`);
  }
  if (!response.ok) {
    throw new Error(`API error ${response.status} for ${walletAddress}`);
  }

  return response.json();
}

/**
 * Fetches SOLID Scores for an array of wallets with a delay between requests.
 *
 * @param wallets  Array of Solana wallet addresses (base58)
 * @param delayMs  Milliseconds to wait between requests (default: 150ms)
 * @returns        Map of wallet address to response
 */
async function batchGetScores(
  wallets: string[],
  delayMs: number = 150
): Promise<Map<string, SolidScoreResponse>> {
  const results = new Map<string, SolidScoreResponse>();

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    try {
      const score = await getSolidScore(wallet);
      results.set(wallet, score);
    } catch (err: any) {
      console.error(`  [${i + 1}/${wallets.length}] Failed: ${wallet} — ${err.message}`);
    }

    // Delay between requests (skip after the last one)
    if (i < wallets.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return results;
}

// --- Main ---

async function main() {
  const wallets = process.argv.slice(2);
  if (wallets.length === 0) {
    console.error("Usage: npx tsx batch-lookup.ts <wallet1> <wallet2> [wallet3...]");
    process.exit(1);
  }

  console.log(`Fetching SOLID Scores for ${wallets.length} wallets...\n`);

  const results = await batchGetScores(wallets);

  // Build a sorted summary (highest score first)
  const rows: { wallet: string; score: number; tier: string; badges: number }[] = [];

  for (const [wallet, data] of results) {
    if (data.solidUser) {
      rows.push({
        wallet,
        score: data.solidUser.solidScore,
        tier: data.solidUser.tierGroup,
        badges: data.solidUser.badges.length,
      });
    } else {
      rows.push({ wallet, score: -1, tier: data.status, badges: 0 });
    }
  }

  rows.sort((a, b) => b.score - a.score);

  // Print table
  console.log("Wallet".padEnd(46) + "Score".padEnd(8) + "Tier".padEnd(10) + "Badges");
  console.log("-".repeat(72));

  for (const row of rows) {
    const shortWallet = row.wallet.slice(0, 4) + "..." + row.wallet.slice(-4);
    const scoreStr = row.score >= 0 ? String(row.score) : "n/a";
    console.log(
      shortWallet.padEnd(46) + scoreStr.padEnd(8) + row.tier.padEnd(10) + String(row.badges)
    );
  }

  console.log(`\nTotal: ${results.size} wallets queried`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});

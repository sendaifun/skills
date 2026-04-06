/**
 * Solana ID — Single Wallet SOLID Score Lookup
 *
 * Fetches the SOLID Score, tier, badges, and category breakdown for a single
 * Solana wallet address. Handles the "calculating" status (first-time lookups)
 * with automatic retry.
 *
 * Prerequisites:
 *   - Get a free API key at https://portal.solana.id
 *   - Set the SOLANA_ID_API_KEY environment variable
 *
 * Usage:
 *   npx tsx get-solid-score.ts <walletAddress>
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
    throw new Error(
      "Missing SOLANA_ID_API_KEY. Get one at https://portal.solana.id"
    );
  }

  const url = `${API_BASE}/solid-score/address/${walletAddress}`;
  const response = await fetch(url, {
    headers: { "x-api-key": apiKey },
  });

  if (response.status === 401) throw new Error("Invalid or missing API key");
  if (response.status === 429) throw new Error("Rate limit exceeded");
  if (response.status === 400) throw new Error("Invalid wallet address (must be base58)");
  if (!response.ok) throw new Error(`API error: ${response.status}`);

  return response.json();
}

/**
 * Fetches the SOLID Score with automatic retry when the score is still being
 * calculated for the first time. Retries up to `maxRetries` times with a
 * 30-second delay between attempts.
 */
async function getSolidScoreWithRetry(
  walletAddress: string,
  maxRetries: number = 3
): Promise<SolidScoreResponse> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await getSolidScore(walletAddress);

    if (result.status !== "calculating") {
      return result;
    }

    if (attempt < maxRetries) {
      console.log(`Score is being calculated. Retrying in 30s (attempt ${attempt + 1}/${maxRetries})...`);
      await new Promise((resolve) => setTimeout(resolve, 30_000));
    }
  }

  throw new Error("Score still calculating after max retries. Try again later.");
}

// --- Main ---

async function main() {
  const wallet = process.argv[2];
  if (!wallet) {
    console.error("Usage: npx tsx get-solid-score.ts <walletAddress>");
    process.exit(1);
  }

  console.log(`Looking up SOLID Score for ${wallet}...\n`);

  const { solidUser, status } = await getSolidScoreWithRetry(wallet);

  if (!solidUser) {
    console.log("No score data available.");
    return;
  }

  console.log(`SOLID Score : ${solidUser.solidScore}`);
  console.log(`Tier        : ${solidUser.tierGroup}`);
  console.log(`Badges      : ${solidUser.badges.length > 0 ? solidUser.badges.join(", ") : "none"}`);
  console.log(`Solana ID   : ${solidUser.isSolanaIdUser ? "yes" : "no"}`);
  console.log(`Status      : ${status}`);
  console.log(`\nCategory Breakdown:`);

  for (const [category, score] of Object.entries(solidUser.dataPoints)) {
    console.log(`  ${category.padEnd(20)} ${score}`);
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});

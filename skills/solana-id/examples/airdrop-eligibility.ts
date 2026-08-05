/**
 * Solana ID — Airdrop Eligibility Filter
 *
 * Given a list of Solana wallets, filters them by SOLID Score tier and/or
 * badge ownership. Useful for building airdrop allow-lists, gating access,
 * or segmenting users by on-chain reputation.
 *
 * Prerequisites:
 *   - Get a free API key at https://portal.solana.id
 *   - Set the SOLANA_ID_API_KEY environment variable
 *
 * Usage:
 *   npx tsx airdrop-eligibility.ts
 *
 * Edit the `WALLETS` and filter criteria below to match your use case.
 */

const API_BASE = "https://backend.app.solana.id/api";

// ---------- Configuration ----------

/** Wallets to evaluate. Replace with your own list. */
const WALLETS: string[] = [
  "So11111111111111111111111111111111111111112",
  // Add more wallet addresses here
];

/** Minimum tier required (1 = highest activity, 4 = lowest). Set to null to skip. */
const MIN_TIER: number | null = 2; // Tier 1 or 2

/** Minimum SOLID Score required. Set to null to skip. */
const MIN_SCORE: number | null = 300;

/** Required badges — wallet must have ALL of these. Set to [] to skip. */
const REQUIRED_BADGES: string[] = [];
// Examples: ["DEFI_MAXI"], ["WHALE", "NFT_COLLECTOR"]

// ---------- Types ----------

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

// ---------- Helpers ----------

function tierToNumber(tier: string): number {
  const map: Record<string, number> = {
    tier_1: 1,
    tier_2: 2,
    tier_3: 3,
    tier_4: 4,
  };
  return map[tier] ?? 99;
}

async function getSolidScore(wallet: string): Promise<SolidScoreResponse> {
  const apiKey = process.env.SOLANA_ID_API_KEY;
  if (!apiKey) {
    throw new Error("Missing SOLANA_ID_API_KEY. Get one at https://portal.solana.id");
  }

  const response = await fetch(`${API_BASE}/solid-score/address/${wallet}`, {
    headers: { "x-api-key": apiKey },
  });

  if (!response.ok) {
    throw new Error(`API error ${response.status} for ${wallet}`);
  }
  return response.json();
}

function isEligible(user: SolidScoreResponse["solidUser"]): boolean {
  if (!user) return false;

  // Check minimum tier
  if (MIN_TIER !== null && tierToNumber(user.tierGroup) > MIN_TIER) {
    return false;
  }

  // Check minimum score
  if (MIN_SCORE !== null && user.solidScore < MIN_SCORE) {
    return false;
  }

  // Check required badges
  if (REQUIRED_BADGES.length > 0) {
    const hasBadges = REQUIRED_BADGES.every((badge) =>
      user.badges.includes(badge)
    );
    if (!hasBadges) return false;
  }

  return true;
}

// ---------- Main ----------

async function main() {
  console.log("Airdrop Eligibility Filter");
  console.log("=".repeat(40));
  console.log(`Criteria:`);
  if (MIN_TIER !== null) console.log(`  Min tier   : ${MIN_TIER} (tier_1 = best)`);
  if (MIN_SCORE !== null) console.log(`  Min score  : ${MIN_SCORE}`);
  if (REQUIRED_BADGES.length > 0) console.log(`  Badges     : ${REQUIRED_BADGES.join(", ")}`);
  console.log(`  Wallets    : ${WALLETS.length}\n`);

  const eligible: string[] = [];
  const ineligible: string[] = [];

  for (let i = 0; i < WALLETS.length; i++) {
    const wallet = WALLETS[i];
    try {
      const { solidUser, status } = await getSolidScore(wallet);

      if (status === "calculating") {
        console.log(`  [${i + 1}] ${wallet} — score calculating, skipping`);
        ineligible.push(wallet);
        continue;
      }

      if (isEligible(solidUser)) {
        console.log(`  [${i + 1}] ${wallet} — ELIGIBLE (score: ${solidUser!.solidScore}, ${solidUser!.tierGroup})`);
        eligible.push(wallet);
      } else {
        const reason = solidUser
          ? `score: ${solidUser.solidScore}, ${solidUser.tierGroup}`
          : "no data";
        console.log(`  [${i + 1}] ${wallet} — ineligible (${reason})`);
        ineligible.push(wallet);
      }
    } catch (err: any) {
      console.error(`  [${i + 1}] ${wallet} — error: ${err.message}`);
      ineligible.push(wallet);
    }

    // Small delay between requests
    if (i < WALLETS.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  console.log(`\n${"=".repeat(40)}`);
  console.log(`Eligible   : ${eligible.length}`);
  console.log(`Ineligible : ${ineligible.length}`);

  if (eligible.length > 0) {
    console.log(`\nEligible wallets:`);
    for (const w of eligible) {
      console.log(`  ${w}`);
    }
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});

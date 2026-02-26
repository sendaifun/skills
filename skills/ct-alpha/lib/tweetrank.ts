import type { Tweet } from "./api";
import { isSuspiciousAuthor } from "./filters";

/**
 * TweetRank: PageRank-inspired scoring for crypto Twitter.
 *
 * CT is adversarial: paid shills look clean, engagement is bottable,
 * coordinated raids inflate "trending". TweetRank solves this by:
 *
 * 1. AuthorCred: Score authors by watchlist membership, follower quality,
 *    verification, account age, and bot-pattern detection.
 * 2. EngagementQuality: Weight bookmarks (unfakeable) and quotes (high effort)
 *    over likes and retweets (easily botted).
 * 3. RecencyBoost: Newer information matters more.
 * 4. Raid Detection: Flag tickers that are mostly mentioned by low-cred accounts.
 *
 * All data comes from the API response for free (user.fields expansion) -
 * zero extra API calls needed.
 */

export interface RankedTweet extends Tweet {
  tweetRank: number;
  authorCred: number;
  engagementQuality: number;
  sourceLabel: "WATCHLIST" | "HIGH-CRED" | "UNKNOWN" | "SUSPICIOUS";
}

export interface RaidSignal {
  ticker: string;
  totalAuthors: number;
  lowCredAuthors: number;
  raidScore: number; // 0-1, higher = more likely coordinated
  uniqueCredAuthors: number;
  flagged: boolean;
}

// --- Author Credibility (0-10) ---

export function computeAuthorCred(
  author: Tweet["author"],
  watchlistSet: Set<string>
): number {
  let cred = 0;

  // Watchlist bonus: our "seed nodes" - highest trust signal
  if (watchlistSet.has(author.username.toLowerCase())) {
    cred += 5.0;
  }

  // Follower quality: high ratio = organic audience
  const following = Math.max(author.following_count, 1);
  const ratio = author.followers_count / following;
  cred += Math.min(ratio, 5); // Cap at 5

  // Verified bonus
  if (author.verified) {
    cred += 1.0;
  }

  // Account age: older = more credible
  if (author.created_at) {
    const ageMs = Date.now() - new Date(author.created_at).getTime();
    const ageYears = ageMs / (365.25 * 24 * 60 * 60 * 1000);
    cred += Math.min(Math.log2(ageYears + 1), 2); // Cap at 2
  }

  // Bot/spam penalty
  if (isSuspiciousAuthor(author)) {
    cred -= 3.0;
  }

  return Math.max(0, Math.min(10, cred));
}

// --- Engagement Quality (manipulation-resistant) ---

export function computeEngagementQuality(metrics: Tweet["metrics"]): number {
  // Bookmarks: private, no social incentive to bot → highest weight
  // Quotes: high effort (requires commentary) → high weight
  // Likes: medium signal, somewhat bottable
  // Retweets: easiest to bot → lowest weight
  return (
    Math.log(1 + metrics.bookmarks) * 3.0 +
    Math.log(1 + metrics.quotes) * 2.5 +
    Math.log(1 + metrics.likes) * 1.5 +
    Math.log(1 + metrics.retweets) * 1.0
  );
}

// --- Recency Boost ---

function recencyBoost(createdAt: string): number {
  const hoursAgo = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60);
  return 1 / (1 + hoursAgo / 24);
}

// --- Source Label ---

function sourceLabel(cred: number, isWatchlist: boolean): RankedTweet["sourceLabel"] {
  if (isWatchlist) return "WATCHLIST";
  if (cred >= 5) return "HIGH-CRED";
  if (cred <= 2) return "SUSPICIOUS";
  return "UNKNOWN";
}

// --- TweetRank ---

export function computeTweetRank(
  tweet: Tweet,
  watchlistSet: Set<string>
): RankedTweet {
  const authorCred = computeAuthorCred(tweet.author, watchlistSet);
  const engagementQuality = computeEngagementQuality(tweet.metrics);
  const recency = recencyBoost(tweet.created_at);
  const isWatchlist = watchlistSet.has(tweet.author.username.toLowerCase());

  const tweetRank = authorCred * engagementQuality * recency;

  return {
    ...tweet,
    tweetRank,
    authorCred,
    engagementQuality,
    sourceLabel: sourceLabel(authorCred, isWatchlist),
  };
}

// --- Rank a batch of tweets ---

export function rankTweets(tweets: Tweet[], watchlistSet: Set<string>): RankedTweet[] {
  return tweets
    .map((t) => computeTweetRank(t, watchlistSet))
    .sort((a, b) => b.tweetRank - a.tweetRank);
}

// --- Raid Detection ---

export function detectRaids(
  tickerMentions: Map<string, Tweet[]>,
  watchlistSet: Set<string>
): RaidSignal[] {
  const signals: RaidSignal[] = [];

  for (const [ticker, tweets] of tickerMentions) {
    const authors = new Map<string, number>(); // username -> cred
    for (const t of tweets) {
      if (!authors.has(t.author.username)) {
        authors.set(t.author.username, computeAuthorCred(t.author, watchlistSet));
      }
    }

    const totalAuthors = authors.size;
    if (totalAuthors < 3) continue; // Not enough data

    let lowCredCount = 0;
    let credAuthors = 0;
    for (const [, cred] of authors) {
      if (cred < 3) lowCredCount++;
      if (cred >= 5) credAuthors++;
    }

    const raidScore = lowCredCount / totalAuthors;
    signals.push({
      ticker,
      totalAuthors,
      lowCredAuthors: lowCredCount,
      raidScore,
      uniqueCredAuthors: credAuthors,
      flagged: raidScore > 0.7, // >70% low-cred authors = likely raid
    });
  }

  return signals.sort((a, b) => b.raidScore - a.raidScore);
}

// --- Trending score (credibility-weighted) ---

export function computeTrendingScore(
  tweets: Tweet[],
  watchlistSet: Set<string>
): number {
  let score = 0;
  const credAuthors = new Set<string>();

  for (const t of tweets) {
    const cred = computeAuthorCred(t.author, watchlistSet);
    const eq = computeEngagementQuality(t.metrics);
    score += cred * Math.log(1 + eq);

    if (cred >= 5) credAuthors.add(t.author.username);
  }

  // Bonus for unique credible authors
  score += credAuthors.size * 10;

  return score;
}

// --- Confidence level for result sets ---

export function computeConfidence(
  rankedTweets: RankedTweet[]
): "HIGH" | "MED" | "LOW" {
  if (rankedTweets.length === 0) return "LOW";

  const watchlistCount = rankedTweets.filter(t => t.sourceLabel === "WATCHLIST").length;
  const highCredCount = rankedTweets.filter(t => t.sourceLabel === "HIGH-CRED").length;
  const total = rankedTweets.length;

  const credRatio = (watchlistCount + highCredCount) / total;
  if (watchlistCount >= 2 && credRatio >= 0.3) return "HIGH";
  if (credRatio >= 0.15) return "MED";
  return "LOW";
}

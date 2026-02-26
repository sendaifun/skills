export interface EngagementFilter {
  minLikes?: number;
  minRetweets?: number;
  minBookmarks?: number;
  minImpressions?: number;
}

export interface TweetMetrics {
  likes: number;
  retweets: number;
  replies: number;
  quotes: number;
  impressions: number;
  bookmarks: number;
}

// Crypto-specific noise filter operators appended to every query
const NOISE_OPERATORS = [
  "-is:retweet",
  '-"airdrop"',
  '-"giveaway"',
  '-"whitelist"',
  '-"follow and RT"',
  '-"follow & RT"',
  '-"free mint"',
  '-"dm to claim"',
];

const QUICK_EXTRA = ["-is:reply"];

export function buildNoiseFilter(quick: boolean = false): string {
  const ops = [...NOISE_OPERATORS];
  if (quick) ops.push(...QUICK_EXTRA);
  return ops.join(" ");
}

export function applyEngagementFilter<T extends { metrics: TweetMetrics }>(
  tweets: T[],
  filter: EngagementFilter
): T[] {
  return tweets.filter((t) => {
    if (filter.minLikes && t.metrics.likes < filter.minLikes) return false;
    if (filter.minRetweets && t.metrics.retweets < filter.minRetweets) return false;
    if (filter.minBookmarks && t.metrics.bookmarks < filter.minBookmarks) return false;
    if (filter.minImpressions && t.metrics.impressions < filter.minImpressions) return false;
    return true;
  });
}

export function buildTimeRange(since: string): { start_time: string; end_time?: string } {
  const now = new Date();
  const match = since.match(/^(\d+)(h|d)$/);
  if (!match) throw new Error(`Invalid time range: ${since}. Use format like "24h" or "7d"`);

  const val = parseInt(match[1]);
  const unit = match[2];
  const ms = unit === "h" ? val * 60 * 60 * 1000 : val * 24 * 60 * 60 * 1000;
  const start = new Date(now.getTime() - ms);

  return {
    start_time: start.toISOString(),
  };
}

// Check if a query already contains a noise filter operator
export function hasOperator(query: string, op: string): boolean {
  return query.toLowerCase().includes(op.toLowerCase());
}

// Append noise filters only if not already present
export function appendNoiseFilters(query: string, quick: boolean = false): string {
  const noise = buildNoiseFilter(quick);
  const parts = noise.split(" ");
  const toAdd = parts.filter(p => !hasOperator(query, p.replace(/^-/, "").replace(/"/g, "")));
  if (toAdd.length === 0) return query;
  return `${query} ${toAdd.join(" ")}`;
}

// Suspicious author patterns for bot detection heuristic
export function isSuspiciousAuthor(user: {
  username: string;
  followers_count: number;
  following_count: number;
  created_at: string;
  tweet_count?: number;
}): boolean {
  // Username patterns: random hex, lots of numbers at end
  const username = user.username.toLowerCase();
  if (/[a-f0-9]{8,}$/i.test(username)) return true;
  if (/\d{6,}$/.test(username)) return true;

  // Following >> followers with low absolute followers
  if (user.followers_count < 50 && user.following_count > 1000) return true;

  // Very new account with high activity
  const ageMs = Date.now() - new Date(user.created_at).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays < 30 && user.followers_count < 10) return true;

  return false;
}

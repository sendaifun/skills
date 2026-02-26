import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const COST_FILE = join(import.meta.dir, "..", "data", "cost-tracking.json");
const COST_PER_TWEET = 0.005; // $0.005 per tweet read via xAI

interface CostRecord {
  date: string; // YYYY-MM-DD
  total_tweets_read: number;
  total_cost_usd: number;
  requests: { timestamp: number; tweets: number; cost: number; query?: string }[];
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function load(): CostRecord {
  try {
    if (existsSync(COST_FILE)) {
      const data: CostRecord = JSON.parse(readFileSync(COST_FILE, "utf-8"));
      if (data.date === today()) return data;
    }
  } catch {}
  return { date: today(), total_tweets_read: 0, total_cost_usd: 0, requests: [] };
}

function save(record: CostRecord): void {
  writeFileSync(COST_FILE, JSON.stringify(record, null, 2), "utf-8");
}

export function estimateCost(pages: number, tweetsPerPage: number = 100): string {
  const tweets = pages * tweetsPerPage;
  const cost = tweets * COST_PER_TWEET;
  return `~${tweets} tweets × $${COST_PER_TWEET} = ~$${cost.toFixed(2)}`;
}

export function recordUsage(tweetCount: number, query?: string): void {
  const record = load();
  const cost = tweetCount * COST_PER_TWEET;
  record.total_tweets_read += tweetCount;
  record.total_cost_usd += cost;
  record.requests.push({
    timestamp: Date.now(),
    tweets: tweetCount,
    cost,
    query,
  });
  save(record);
}

export function getSummary(): string {
  const record = load();
  const lines = [
    `📊 Cost Tracking (${record.date})`,
    `   Tweets read: ${record.total_tweets_read.toLocaleString()}`,
    `   Estimated cost: $${record.total_cost_usd.toFixed(2)}`,
    `   API calls: ${record.requests.length}`,
  ];
  if (record.requests.length > 0) {
    const last = record.requests[record.requests.length - 1];
    lines.push(`   Last request: ${last.tweets} tweets (~$${last.cost.toFixed(2)})${last.query ? ` for "${last.query}"` : ""}`);
  }
  return lines.join("\n");
}

export function reset(): void {
  save({ date: today(), total_tweets_read: 0, total_cost_usd: 0, requests: [] });
}

export function formatCostLine(tweetCount: number, cached: boolean): string {
  if (cached) return `⚡ [CACHED] 0 credits used`;
  const cost = tweetCount * COST_PER_TWEET;
  return `📊 ${tweetCount} tweets read · ~$${cost.toFixed(2)}`;
}

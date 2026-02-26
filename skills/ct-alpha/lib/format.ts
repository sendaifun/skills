import type { RankedTweet, RaidSignal } from "./tweetrank";
import { computeConfidence } from "./tweetrank";
import type { AggregatedMention, ContractAddress, CryptoUrl } from "./extract";
import { formatCostLine } from "./cost";

/**
 * Output formatting with trust labels.
 *
 * Every output avoids false authority. People treat tables + summaries
 * as "signal" - in crypto that's dangerous. Every result includes:
 * - Source quality label (WATCHLIST / HIGH-CRED / UNKNOWN / SUSPICIOUS)
 * - Confidence level (HIGH / MED / LOW)
 * - Verification status
 * - "What could be wrong?" risk bullet
 */

// --- Time formatting ---

function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + "...";
}

// --- Risk bullet generation ---

function riskBullet(tweet: RankedTweet): string {
  const risks: string[] = [];

  if (tweet.sourceLabel === "SUSPICIOUS") {
    risks.push("author has suspicious patterns (possible bot/shill)");
  }
  if (tweet.sourceLabel === "UNKNOWN" && tweet.metrics.likes > 100 && tweet.metrics.bookmarks < 5) {
    risks.push("high likes but very low bookmarks — engagement may be spoofed");
  }
  if (tweet.author.followers_count < 100 && tweet.metrics.retweets > 50) {
    risks.push("low-follower account with high retweets — could be botted engagement");
  }
  if (tweet.metrics.impressions > 0 && tweet.metrics.likes / tweet.metrics.impressions > 0.3) {
    risks.push("unusually high like-to-impression ratio");
  }

  if (risks.length === 0) return "";
  return `⚠️ ${risks.join("; ")}`;
}

// --- Format a single ranked tweet ---

function formatTweet(tweet: RankedTweet, index: number): string {
  const label = `[${tweet.sourceLabel}]`;
  const articleTag = tweet.is_article ? " 📝 ARTICLE" : "";
  const rank = `TR:${tweet.tweetRank.toFixed(1)}`;
  const cred = `Cred:${tweet.authorCred.toFixed(1)}`;

  const engagement = [
    `♥${tweet.metrics.likes}`,
    `🔁${tweet.metrics.retweets}`,
    `💬${tweet.metrics.replies}`,
    `🔖${tweet.metrics.bookmarks}`,
  ].join(" ");

  const risk = riskBullet(tweet);
  const maxText = tweet.is_article ? 500 : 280;
  const lines = [
    `**${index + 1}.** ${label}${articleTag} @${tweet.username} · ${timeAgo(tweet.created_at)} · ${rank} · ${cred}`,
    `   ${truncate(tweet.text.replace(/\n/g, " "), maxText)}`,
    `   ${engagement} · 👁${tweet.metrics.impressions.toLocaleString()} views`,
    `   ${tweet.tweet_url}`,
  ];

  if (risk) lines.push(`   ${risk}`);

  return lines.join("\n");
}

// --- Format search results ---

export function formatSearchResults(
  tweets: RankedTweet[],
  meta: {
    query: string;
    rawCount: number;
    cached: boolean;
    since?: string;
  }
): string {
  const confidence = computeConfidence(tweets);
  const costLine = formatCostLine(meta.rawCount, meta.cached);

  const header = [
    `## CT Alpha Search: "${meta.query}"`,
    `**Confidence: ${confidence}** · ${tweets.length} results · ${meta.since || "24h"} window`,
    costLine,
    "",
  ];

  if (tweets.length === 0) {
    return [...header, "No results found. Try broadening the query or time window."].join("\n");
  }

  const tweetLines = tweets.slice(0, 20).map((t, i) => formatTweet(t, i));

  return [...header, ...tweetLines].join("\n\n");
}

// --- Format trending tokens ---

export function formatTrending(
  mentions: AggregatedMention[],
  raidSignals: RaidSignal[],
  meta: { window: string; cached: boolean; rawCount: number }
): string {
  const costLine = formatCostLine(meta.rawCount, meta.cached);
  const raidMap = new Map(raidSignals.map(r => [r.ticker, r]));

  const header = [
    `## CT Alpha Trending (${meta.window})`,
    costLine,
    "",
    "| # | Ticker | Mentions | Authors | Sources | Risk |",
    "|---|--------|----------|---------|---------|------|",
  ];

  const rows = mentions.slice(0, 30).map((m, i) => {
    const raid = raidMap.get(m.ticker);
    const riskFlag = raid?.flagged
      ? `⚠️ RAID (${(raid.raidScore * 100).toFixed(0)}% low-cred)`
      : m.uniqueAuthors < 3
        ? "⚠️ Few authors"
        : "✅";

    const sourceTypes = m.sources.map(s => `${s.type}(${s.count})`).join(", ");

    return `| ${i + 1} | **${m.ticker}** | ${m.count} | ${m.uniqueAuthors} | ${sourceTypes} | ${riskFlag} |`;
  });

  return [...header, ...rows].join("\n");
}

// --- Format contract addresses ---

export function formatContractAddresses(addresses: ContractAddress[]): string {
  if (addresses.length === 0) return "";

  const header = [
    "",
    "### Extracted Contract Addresses (⚠️ ALL UNVERIFIED)",
    "| Chain | Address | Confidence | Context |",
    "|-------|---------|------------|---------|",
  ];

  const rows = addresses.map((a) => {
    const shortAddr = `${a.address.slice(0, 8)}...${a.address.slice(-6)}`;
    return `| ${a.chain} | \`${shortAddr}\` | ${a.confidence} | ${truncate(a.context, 60)} |`;
  });

  const footer = [
    "",
    "> ⚠️ Contract addresses are UNVERIFIED. Always verify on-chain via explorer or rug-check tool before interacting.",
  ];

  return [...header, ...rows, ...footer].join("\n");
}

// --- Format crypto URLs ---

export function formatCryptoUrls(urls: CryptoUrl[]): string {
  if (urls.length === 0) return "";

  const lines = [
    "",
    "### Crypto Links Found",
  ];

  for (const u of urls) {
    const tokenPart = u.tokenId ? ` → \`${u.tokenId.slice(0, 12)}...\`` : "";
    lines.push(`- **${u.source}**${tokenPart}: ${u.url}`);
  }

  return lines.join("\n");
}

// --- Format watchlist results ---

export function formatWatchlist(
  categorized: Map<string, RankedTweet[]>,
  meta: { since: string; cached: boolean; rawCount: number }
): string {
  const costLine = formatCostLine(meta.rawCount, meta.cached);

  const header = [
    `## CT Alpha Watchlist (${meta.since})`,
    costLine,
    "",
  ];

  const sections: string[] = [];
  for (const [category, tweets] of categorized) {
    if (tweets.length === 0) continue;
    const section = [
      `### ${category} (${tweets.length} tweets)`,
      ...tweets.slice(0, 5).map((t, i) => formatTweet(t, i)),
    ];
    sections.push(section.join("\n\n"));
  }

  if (sections.length === 0) {
    return [...header, "No recent activity from watchlist accounts."].join("\n");
  }

  return [...header, ...sections].join("\n\n---\n\n");
}

// --- Format thread ---

export function formatThread(
  tweets: RankedTweet[],
  partial: boolean,
  cached: boolean
): string {
  const header = [
    `## Thread (${tweets.length} tweets)`,
    partial ? "⚠️ **PARTIAL THREAD (recent window only)** — older replies may be missing" : "",
    cached ? "⚡ [CACHED]" : "",
    "",
  ].filter(Boolean);

  const tweetLines = tweets.map((t, i) => formatTweet(t, i));
  return [...header, ...tweetLines].join("\n\n");
}


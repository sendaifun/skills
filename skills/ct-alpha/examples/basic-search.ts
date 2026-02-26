#!/usr/bin/env bun

/**
 * CT Alpha — Basic Search Example
 *
 * Demonstrates how to search CT for token alpha,
 * extract tickers, and display TweetRank-scored results.
 *
 * Usage:
 *   source ~/.config/env/global.env
 *   bun run examples/basic-search.ts
 */

import { searchRecent } from "../lib/api";
import { rankTweets } from "../lib/tweetrank";
import { aggregateMentions } from "../lib/extract";
import { appendNoiseFilters, applyEngagementFilter } from "../lib/filters";
import { formatSearchResults } from "../lib/format";

async function main() {
  // 1. Build a search query with noise filters
  const rawQuery = '"$SOL" OR "solana" alpha';
  const query = appendNoiseFilters(rawQuery, true) + " lang:en";

  console.log(`Searching CT: ${rawQuery}\n`);

  // 2. Execute quick search (20 tweets, ~$0.10)
  const result = await searchRecent(query, {
    sort: "relevancy",
    since: "24h",
    maxPages: 1,
    maxResults: 20,
  });

  // 3. Filter by engagement (min 3 likes)
  const filtered = applyEngagementFilter(result.tweets, { minLikes: 3 });

  // 4. Rank with TweetRank (empty watchlist for this example)
  const watchlist = new Set<string>();
  const ranked = rankTweets(filtered, watchlist);

  // 5. Display formatted results
  console.log(formatSearchResults(ranked, {
    query: rawQuery,
    rawCount: result.rawCount,
    cached: result.cached,
    since: "24h",
  }));

  // 6. Extract tickers from results
  const mentions = aggregateMentions(result.tweets);
  if (mentions.length > 0) {
    console.log("\n### Extracted Tickers");
    for (const m of mentions.slice(0, 10)) {
      const sourceTypes = m.sources.map(s => s.type).join(", ");
      console.log(`- ${m.ticker} (${m.count} mentions, ${m.uniqueAuthors} authors) via ${sourceTypes}`);
    }
  }
}

main().catch(console.error);

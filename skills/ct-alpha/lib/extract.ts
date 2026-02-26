import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { Tweet } from "./api";

/**
 * Multi-signal token extraction.
 *
 * Cashtag-only detection misses how Solana tokens actually spread on CT.
 * Many use plain names ("goat", "pengu", "wen"), contract addresses,
 * pump.fun links, or DEX links. This module extracts signals from:
 *
 * 1. Cashtags ($TICKER)
 * 2. Name-phrases (known token names + crypto context co-occurrence)
 * 3. Crypto URLs (pump.fun, dexscreener, birdeye, jup, raydium, solscan, etherscan)
 * 4. Contract addresses (with context-window scoring to reduce false positives)
 */

// --- Types ---

export interface TickerMention {
  ticker: string;
  source: "cashtag" | "name-phrase" | "url" | "contract-address";
  confidence: "high" | "medium" | "low";
  raw?: string; // Original matched text
}

export interface CryptoUrl {
  source: string; // Domain (pump.fun, dexscreener.com, etc.)
  url: string;
  tokenId?: string; // Extracted token/mint/pair identifier
  chain?: string;
}

export interface ContractAddress {
  address: string;
  chain: "solana" | "ethereum" | "unknown";
  confidence: "high" | "medium" | "low";
  context: string; // Surrounding text that triggered the match
  verified: false; // Always UNVERIFIED until tool-checked
}

export interface AggregatedMention {
  ticker: string;
  count: number;
  sources: { type: TickerMention["source"]; count: number }[];
  tweets: string[]; // tweet IDs
  uniqueAuthors: number;
  raidFlag?: boolean;
}

// --- Known non-crypto tickers to filter ---

const NON_CRYPTO_TICKERS = new Set([
  "USD", "EUR", "GBP", "JPY", "CNY", "AUD", "CAD", "CHF", "INR", "KRW",
  "SPX", "SPY", "QQQ", "DJI", "AAPL", "MSFT", "GOOGL", "AMZN", "TSLA",
  "META", "NVDA", "AMD", "INTC", "IBM", "ORCL", "CRM", "NFLX", "DIS",
  "NYSE", "NASDAQ", "CEO", "CFO", "CTO", "ICO", "IPO", "ETF", "SEC",
  "USA", "GDP", "CPI", "FED", "IMF", "API", "SDK", "NFT", "AI", "ML",
  "THE", "AND", "FOR", "NOT", "ALL", "HAS", "HAD", "BUT", "HIS", "HER",
  "NEW", "OLD", "BIG", "TOP", "LOW", "MAX", "MIN", "END",
]);

// --- Known token name mappings ---

let knownTokensCache: Record<string, string> | null = null;

function loadKnownTokens(): Record<string, string> {
  if (knownTokensCache) return knownTokensCache;

  const fp = join(import.meta.dir, "..", "data", "known-tokens.json");
  try {
    if (existsSync(fp)) {
      knownTokensCache = JSON.parse(readFileSync(fp, "utf-8"));
      return knownTokensCache!;
    }
  } catch {}

  knownTokensCache = {};
  return knownTokensCache;
}

// --- Crypto context words (must co-occur with name-phrases) ---

const CRYPTO_CONTEXT = new Set([
  "buy", "sell", "long", "short", "yield", "apy", "apr", "tvl", "mint",
  "stake", "staking", "unstake", "swap", "lp", "pool", "farm", "farming",
  "vault", "dex", "defi", "token", "coin", "airdrop", "listing",
  "pump", "dump", "moon", "rug", "alpha", "bullish", "bearish",
  "entry", "exit", "position", "leverage", "perp", "futures", "spot",
  "mcap", "market cap", "volume", "liquidity", "ca", "contract",
  "solana", "sol", "ethereum", "eth", "bitcoin", "btc", "chain",
  "bridge", "reward", "epoch", "validator", "strategy", "protocol",
]);

// --- Crypto URL domains and their extraction patterns ---

const CRYPTO_URL_PATTERNS: { domain: string; extractToken: (url: string) => string | undefined }[] = [
  {
    domain: "pump.fun",
    extractToken: (url) => {
      // pump.fun/coin/<mint> or pump.fun/<mint>
      const match = url.match(/pump\.fun\/(?:coin\/)?([1-9A-HJ-NP-Za-km-z]{32,44})/);
      return match?.[1];
    },
  },
  {
    domain: "dexscreener.com",
    extractToken: (url) => {
      // dexscreener.com/solana/<pair>
      const match = url.match(/dexscreener\.com\/(\w+)\/([a-zA-Z0-9]+)/);
      return match?.[2];
    },
  },
  {
    domain: "birdeye.so",
    extractToken: (url) => {
      // birdeye.so/token/<mint>
      const match = url.match(/birdeye\.so\/token\/([1-9A-HJ-NP-Za-km-z]{32,44})/);
      return match?.[1];
    },
  },
  {
    domain: "jup.ag",
    extractToken: (url) => {
      // jup.ag/swap/SOL-<token>
      const match = url.match(/jup\.ag\/swap\/\w+-(\w+)/);
      return match?.[1];
    },
  },
  {
    domain: "raydium.io",
    extractToken: (url) => {
      // raydium.io/swap/?inputMint=...&outputMint=<mint>
      const match = url.match(/outputMint=([1-9A-HJ-NP-Za-km-z]{32,44})/);
      return match?.[1];
    },
  },
  {
    domain: "solscan.io",
    extractToken: (url) => {
      // solscan.io/token/<mint>
      const match = url.match(/solscan\.io\/token\/([1-9A-HJ-NP-Za-km-z]{32,44})/);
      return match?.[1];
    },
  },
  {
    domain: "etherscan.io",
    extractToken: (url) => {
      // etherscan.io/token/0x...
      const match = url.match(/etherscan\.io\/token\/(0x[a-fA-F0-9]{40})/);
      return match?.[1];
    },
  },
];

// --- 1. Cashtag Extraction ---

export function extractTickers(text: string): TickerMention[] {
  const regex = /\$([A-Z]{2,10})\b/g;
  const results: TickerMention[] = [];
  const seen = new Set<string>();
  let match;

  while ((match = regex.exec(text)) !== null) {
    const ticker = match[1];
    if (!NON_CRYPTO_TICKERS.has(ticker) && !seen.has(ticker)) {
      seen.add(ticker);
      results.push({ ticker, source: "cashtag", confidence: "high", raw: match[0] });
    }
  }

  return results;
}

// --- 2. Name-Phrase Detection ---

export function extractNamePhrases(text: string): TickerMention[] {
  const knownTokens = loadKnownTokens();
  const results: TickerMention[] = [];
  const seen = new Set<string>();
  const lowerText = text.toLowerCase();

  // Check if text has any crypto context
  const words = lowerText.split(/\s+/);
  const hasContext = words.some((w) => CRYPTO_CONTEXT.has(w));

  for (const [name, ticker] of Object.entries(knownTokens)) {
    if (seen.has(ticker)) continue;

    const nameLower = name.toLowerCase();
    // Word boundary match to avoid partial matches
    const nameRegex = new RegExp(`\\b${escapeRegex(nameLower)}\\b`, "i");
    if (nameRegex.test(lowerText)) {
      seen.add(ticker);
      results.push({
        ticker,
        source: "name-phrase",
        confidence: hasContext ? "high" : "medium",
        raw: name,
      });
    }
  }

  return results;
}

// --- 3. Crypto URL Extraction ---

export function extractCryptoUrls(urls: string[]): CryptoUrl[] {
  const results: CryptoUrl[] = [];

  for (const url of urls) {
    for (const pattern of CRYPTO_URL_PATTERNS) {
      if (url.includes(pattern.domain)) {
        const tokenId = pattern.extractToken(url);
        const chain = pattern.domain.includes("etherscan") ? "ethereum" : "solana";
        results.push({
          source: pattern.domain,
          url,
          tokenId,
          chain,
        });
        break; // One match per URL
      }
    }
  }

  return results;
}

// --- 4. Contract Address Extraction (with context-window scoring) ---

// Context keywords that indicate a nearby base58 string is a contract address
const CA_CONTEXT_WORDS = /\b(ca|contract|mint|address|token|pump|dex|pair|buy)\b/i;

// Patterns to exclude: tx signatures (87-88 chars), known non-mint patterns
const TX_SIG_PREFIX = /\b(tx|sig|signature|transaction|hash)[\s:]+/i;

export function extractContractAddresses(text: string): ContractAddress[] {
  const results: ContractAddress[] = [];
  const seen = new Set<string>();

  // Solana addresses: base58 32-44 chars
  const solRegex = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
  let match;

  while ((match = solRegex.exec(text)) !== null) {
    const addr = match[0];
    if (seen.has(addr)) continue;

    // Exclude tx signatures (87-88 chars)
    if (addr.length >= 80) continue;

    // Context window: 50 chars before and after
    const start = Math.max(0, match.index - 50);
    const end = Math.min(text.length, match.index + addr.length + 50);
    const context = text.slice(start, end);

    // Check for tx/signature prefix → skip
    const before = text.slice(start, match.index);
    if (TX_SIG_PREFIX.test(before)) continue;

    // Context-window scoring: must have nearby CA-related keywords
    const hasContext = CA_CONTEXT_WORDS.test(context);
    const confidence = hasContext ? "high" : "low";

    // Only include high/medium confidence (context present)
    if (hasContext) {
      seen.add(addr);
      results.push({
        address: addr,
        chain: "solana",
        confidence,
        context: context.trim(),
        verified: false,
      });
    }
  }

  // ETH addresses: 0x + 40 hex chars
  const ethRegex = /0x[a-fA-F0-9]{40}/g;
  while ((match = ethRegex.exec(text)) !== null) {
    const addr = match[0];
    if (seen.has(addr)) continue;

    const start = Math.max(0, match.index - 50);
    const end = Math.min(text.length, match.index + addr.length + 50);
    const context = text.slice(start, end);

    seen.add(addr);
    results.push({
      address: addr,
      chain: "ethereum",
      confidence: "medium", // 0x prefix is a strong enough signal
      context: context.trim(),
      verified: false,
    });
  }

  return results;
}

// --- Aggregate all signals from a set of tweets ---

export function aggregateMentions(tweets: Tweet[]): AggregatedMention[] {
  const tickerMap = new Map<string, {
    count: number;
    sources: Map<TickerMention["source"], number>;
    tweetIds: Set<string>;
    authors: Set<string>;
  }>();

  function addMention(ticker: string, source: TickerMention["source"], tweetId: string, author: string) {
    const entry = tickerMap.get(ticker) || {
      count: 0,
      sources: new Map(),
      tweetIds: new Set(),
      authors: new Set(),
    };
    entry.count++;
    entry.sources.set(source, (entry.sources.get(source) || 0) + 1);
    entry.tweetIds.add(tweetId);
    entry.authors.add(author);
    tickerMap.set(ticker, entry);
  }

  for (const tweet of tweets) {
    // Cashtags
    for (const m of extractTickers(tweet.text)) {
      addMention(m.ticker, "cashtag", tweet.id, tweet.author.username);
    }

    // Name-phrases
    for (const m of extractNamePhrases(tweet.text)) {
      addMention(m.ticker, "name-phrase", tweet.id, tweet.author.username);
    }

    // Crypto URLs
    for (const u of extractCryptoUrls(tweet.urls)) {
      if (u.tokenId) {
        addMention(u.tokenId, "url", tweet.id, tweet.author.username);
      }
    }

    // Contract addresses → add as their own entries
    for (const ca of extractContractAddresses(tweet.text)) {
      addMention(ca.address, "contract-address", tweet.id, tweet.author.username);
    }
  }

  // Convert to sorted array
  const results: AggregatedMention[] = [];
  for (const [ticker, data] of tickerMap) {
    const sources: AggregatedMention["sources"] = [];
    for (const [type, count] of data.sources) {
      sources.push({ type, count });
    }
    results.push({
      ticker,
      count: data.count,
      sources: sources.sort((a, b) => b.count - a.count),
      tweets: Array.from(data.tweetIds),
      uniqueAuthors: data.authors.size,
    });
  }

  return results.sort((a, b) => b.count - a.count);
}

// --- All signals from a single tweet ---

export function extractAllSignals(tweet: Tweet): {
  tickers: TickerMention[];
  urls: CryptoUrl[];
  addresses: ContractAddress[];
} {
  return {
    tickers: [...extractTickers(tweet.text), ...extractNamePhrases(tweet.text)],
    urls: extractCryptoUrls(tweet.urls),
    addresses: extractContractAddresses(tweet.text),
  };
}

// --- Helpers ---

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

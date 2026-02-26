import { readFileSync, writeFileSync, readdirSync, unlinkSync, mkdirSync, existsSync } from "fs";
import { createHash } from "crypto";
import { join } from "path";

const CACHE_DIR = join(import.meta.dir, "..", "data", "cache");

export interface CacheEntry<T = any> {
  key: string;
  created_at: number;
  ttl_ms: number;
  expires_at: number;
  data: T;
  meta?: Record<string, any>;
}

export const TTL = {
  QUICK: 60 * 60 * 1000,        // 1 hour
  FULL: 15 * 60 * 1000,         // 15 minutes
  WATCHLIST: 4 * 60 * 60 * 1000, // 4 hours
  PROFILE: 24 * 60 * 60 * 1000,  // 24 hours
  THREAD: 2 * 60 * 60 * 1000,    // 2 hours
  TRENDING: 60 * 60 * 1000,      // 1 hour (baseline comparisons)
} as const;

function ensureCacheDir(): void {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
}

export function cacheKey(endpoint: string, params: Record<string, any> = {}): string {
  const sorted = JSON.stringify(params, Object.keys(params).sort());
  const raw = `${endpoint}:${sorted}`;
  return createHash("md5").update(raw).digest("hex").slice(0, 16);
}

function filePath(key: string): string {
  return join(CACHE_DIR, `${key}.json`);
}

export function get<T = any>(key: string): T | null {
  ensureCacheDir();
  const fp = filePath(key);
  try {
    const raw = readFileSync(fp, "utf-8");
    const entry: CacheEntry<T> = JSON.parse(raw);
    if (Date.now() > entry.expires_at) {
      try { unlinkSync(fp); } catch {}
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

export function set<T = any>(key: string, data: T, ttlMs: number, meta?: Record<string, any>): void {
  ensureCacheDir();
  const now = Date.now();
  const entry: CacheEntry<T> = {
    key,
    created_at: now,
    ttl_ms: ttlMs,
    expires_at: now + ttlMs,
    data,
    meta,
  };
  writeFileSync(filePath(key), JSON.stringify(entry), "utf-8");
}

export function has(key: string): boolean {
  return get(key) !== null;
}

export function prune(): number {
  ensureCacheDir();
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000; // 24h hard limit
  let pruned = 0;

  try {
    const files = readdirSync(CACHE_DIR).filter(f => f.endsWith(".json"));
    for (const file of files) {
      const fp = join(CACHE_DIR, file);
      try {
        const raw = readFileSync(fp, "utf-8");
        const entry: CacheEntry = JSON.parse(raw);
        if (now > entry.expires_at || now - entry.created_at > maxAge) {
          unlinkSync(fp);
          pruned++;
        }
      } catch {
        // Corrupted cache file, remove it
        try { unlinkSync(fp); pruned++; } catch {}
      }
    }
  } catch {}

  return pruned;
}

export function clear(): number {
  ensureCacheDir();
  let cleared = 0;
  try {
    const files = readdirSync(CACHE_DIR).filter(f => f.endsWith(".json"));
    for (const file of files) {
      try { unlinkSync(join(CACHE_DIR, file)); cleared++; } catch {}
    }
  } catch {}
  return cleared;
}

export function stats(): { entries: number; totalSizeKb: number } {
  ensureCacheDir();
  try {
    const files = readdirSync(CACHE_DIR).filter(f => f.endsWith(".json"));
    let totalSize = 0;
    for (const file of files) {
      try {
        const raw = readFileSync(join(CACHE_DIR, file), "utf-8");
        totalSize += raw.length;
      } catch {}
    }
    return { entries: files.length, totalSizeKb: Math.round(totalSize / 1024) };
  } catch {
    return { entries: 0, totalSizeKb: 0 };
  }
}

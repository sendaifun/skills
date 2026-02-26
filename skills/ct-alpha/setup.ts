#!/usr/bin/env bun

/**
 * CT Alpha Setup Script
 *
 * Checks environment, configures API token, and seeds the watchlist
 * with user's favorite accounts.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const DATA_DIR = join(import.meta.dir, "data");
const CACHE_DIR = join(DATA_DIR, "cache");
const WATCHLIST_PATH = join(DATA_DIR, "watchlist.json");
const DEFAULT_WATCHLIST_PATH = join(DATA_DIR, "watchlist.default.json");
const ENV_DIR = `${process.env.HOME}/.config/env`;
const ENV_FILE = `${ENV_DIR}/global.env`;

function log(msg: string) { console.log(`  ${msg}`); }
function ok(msg: string) { console.log(`  ✅ ${msg}`); }
function warn(msg: string) { console.log(`  ⚠️  ${msg}`); }
function fail(msg: string) { console.log(`  ❌ ${msg}`); }

async function prompt(question: string): Promise<string> {
  process.stdout.write(`  ${question} `);
  const buf = Buffer.alloc(1024);
  const fd = require("fs").openSync("/dev/stdin", "r");
  const bytesRead = require("fs").readSync(fd, buf, 0, 1024, null);
  require("fs").closeSync(fd);
  return buf.toString("utf-8", 0, bytesRead).trim();
}

async function main() {
  console.log("\n🔍 CT Alpha Setup\n");

  // 1. Check Bun
  log("Checking Bun...");
  ok(`Bun ${Bun.version} detected`);

  // 2. Check / configure X_BEARER_TOKEN
  log("Checking X API credentials...");
  let hasToken = false;

  if (process.env.X_BEARER_TOKEN) {
    ok("X_BEARER_TOKEN found in environment");
    hasToken = true;
  } else if (existsSync(ENV_FILE)) {
    const content = readFileSync(ENV_FILE, "utf-8");
    if (content.includes("X_BEARER_TOKEN")) {
      ok(`X_BEARER_TOKEN found in ${ENV_FILE}`);
      hasToken = true;
    }
  }

  if (!hasToken) {
    warn("X_BEARER_TOKEN not found.");
    log("You need an X API Bearer Token from https://developer.x.com");
    log("");
    const token = await prompt("Enter your X_BEARER_TOKEN (or press Enter to skip):");

    if (token) {
      if (!existsSync(ENV_DIR)) {
        mkdirSync(ENV_DIR, { recursive: true });
      }

      let envContent = "";
      if (existsSync(ENV_FILE)) {
        envContent = readFileSync(ENV_FILE, "utf-8");
      }

      if (!envContent.includes("X_BEARER_TOKEN")) {
        envContent += `\nexport X_BEARER_TOKEN="${token}"\n`;
        writeFileSync(ENV_FILE, envContent);
        ok(`Token saved to ${ENV_FILE}`);
      }
    } else {
      warn("Skipped. Set X_BEARER_TOKEN before using ct-search.");
    }
  }

  // 3. Create cache directory
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
    ok("Created cache directory");
  } else {
    ok("Cache directory exists");
  }

  // 4. Setup watchlist
  log("Setting up watchlist...");

  let watchlist: any;
  if (existsSync(WATCHLIST_PATH)) {
    watchlist = JSON.parse(readFileSync(WATCHLIST_PATH, "utf-8"));
    ok("Existing watchlist.json found");
  } else if (existsSync(DEFAULT_WATCHLIST_PATH)) {
    watchlist = JSON.parse(readFileSync(DEFAULT_WATCHLIST_PATH, "utf-8"));
    log("Starting from default watchlist");
  } else {
    fail("No watchlist template found");
    return;
  }

  // Ask for 3 favorite accounts
  log("");
  log("Add 3 CT accounts you follow most (these seed your personalized feed).");
  log("Enter X usernames without @, or press Enter to skip.\n");

  const favorites: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const username = await prompt(`Account ${i}/3:`);
    if (username) {
      favorites.push(username.replace("@", "").toLowerCase());
    }
  }

  if (favorites.length > 0) {
    if (!watchlist.categories) watchlist.categories = {};
    if (!watchlist.categories.favorites) {
      watchlist.categories.favorites = {
        description: "Your personal favorite accounts",
        accounts: [],
      };
    }
    watchlist.categories.favorites.accounts = [
      ...new Set([...watchlist.categories.favorites.accounts, ...favorites]),
    ];
    ok(`Added ${favorites.length} account(s) to favorites`);
  }

  writeFileSync(WATCHLIST_PATH, JSON.stringify(watchlist, null, 2));
  ok(`Watchlist saved to ${WATCHLIST_PATH}`);

  // 5. Summary
  console.log("\n✨ Setup complete!\n");
  console.log("  Usage:");
  console.log('    bun run ct-search.ts search "$SOL alpha" --quick');
  console.log("    bun run ct-search.ts trending --window 6h");
  console.log("    bun run ct-search.ts watchlist --since 24h");
  console.log("");
  console.log("  Or use /ct-alpha in Claude Code\n");
}

main().catch((err) => {
  fail(err.message);
  process.exit(1);
});

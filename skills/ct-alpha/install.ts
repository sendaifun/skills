#!/usr/bin/env bun

/**
 * CT Alpha — Full installer
 *
 * Handles everything a new user needs:
 *   1. X API token configuration
 *   2. Cache directory creation
 *   3. Watchlist seeding (3 favorite accounts)
 *   4. Skill file installation to ~/.claude/skills/
 *   5. Verification test (optional live API check)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from "fs";
import { join } from "path";

const CT_ALPHA_DIR = import.meta.dir;
const DATA_DIR = join(CT_ALPHA_DIR, "data");
const CACHE_DIR = join(DATA_DIR, "cache");
const WATCHLIST_PATH = join(DATA_DIR, "watchlist.json");
const DEFAULT_WATCHLIST_PATH = join(DATA_DIR, "watchlist.default.json");
const SKILL_SOURCE = join(CT_ALPHA_DIR, "SKILL.md");
const ENV_DIR = `${process.env.HOME}/.config/env`;
const ENV_FILE = `${ENV_DIR}/global.env`;
const SKILLS_DIR = `${process.env.HOME}/.claude/skills`;
const SKILL_DEST_DIR = `${SKILLS_DIR}/ct-alpha`;
const SKILL_DEST = `${SKILL_DEST_DIR}/SKILL.md`;

function log(msg: string) { console.log(`  ${msg}`); }
function ok(msg: string) { console.log(`  ✅ ${msg}`); }
function warn(msg: string) { console.log(`  ⚠️  ${msg}`); }
function fail(msg: string) { console.log(`  ❌ ${msg}`); }

function prompt(question: string): string {
  process.stdout.write(`  ${question} `);
  const buf = Buffer.alloc(4096);
  const fd = require("fs").openSync("/dev/stdin", "r");
  const bytesRead = require("fs").readSync(fd, buf, 0, 4096, null);
  require("fs").closeSync(fd);
  return buf.toString("utf-8", 0, bytesRead).trim();
}

function promptYN(question: string, defaultYes = true): boolean {
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  const answer = prompt(`${question} ${hint}`).toLowerCase();
  if (answer === "") return defaultYes;
  return answer.startsWith("y");
}

async function main() {
  console.log("");
  console.log("  🔍 CT Alpha Setup");
  console.log("  ─────────────────");
  console.log("");

  // ── Step 1: Bun check ──
  ok(`Bun ${Bun.version}`);

  // ── Step 2: X API Token ──
  log("Checking X API credentials...");
  let hasToken = false;
  let tokenValue = "";

  if (process.env.X_BEARER_TOKEN) {
    ok("X_BEARER_TOKEN found in environment");
    hasToken = true;
    tokenValue = process.env.X_BEARER_TOKEN;
  } else if (existsSync(ENV_FILE)) {
    const content = readFileSync(ENV_FILE, "utf-8");
    const match = content.match(/X_BEARER_TOKEN=["']?([^"'\n]+)/);
    if (match) {
      ok(`X_BEARER_TOKEN found in ${ENV_FILE}`);
      hasToken = true;
      tokenValue = match[1];
    }
  }

  if (!hasToken) {
    console.log("");
    log("You need an X API Bearer Token (pay-per-use via xAI).");
    log("Get one at: https://developer.x.com");
    log("Cost: ~$0.005 per tweet read (~$0.10 per search)");
    console.log("");
    const token = prompt("Enter your X_BEARER_TOKEN (or Enter to skip):");

    if (token) {
      tokenValue = token;
      if (!existsSync(ENV_DIR)) {
        mkdirSync(ENV_DIR, { recursive: true });
      }
      let envContent = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf-8") : "";
      if (!envContent.includes("X_BEARER_TOKEN")) {
        envContent += `\nexport X_BEARER_TOKEN="${token}"\n`;
        writeFileSync(ENV_FILE, envContent);
        ok(`Token saved to ${ENV_FILE}`);
      }
      hasToken = true;
    } else {
      warn("Skipped. You'll need to set X_BEARER_TOKEN before using ct-alpha.");
    }
  }

  // ── Step 3: Cache directory ──
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
  ok("Cache directory ready");

  // ── Step 4: Watchlist ──
  console.log("");
  log("Setting up watchlist...");

  let watchlist: any;
  if (existsSync(WATCHLIST_PATH)) {
    watchlist = JSON.parse(readFileSync(WATCHLIST_PATH, "utf-8"));
    ok("Existing watchlist.json found");
  } else if (existsSync(DEFAULT_WATCHLIST_PATH)) {
    watchlist = JSON.parse(readFileSync(DEFAULT_WATCHLIST_PATH, "utf-8"));
    log("Starting from default watchlist template");
  } else {
    watchlist = { categories: {} };
    warn("No watchlist template found, creating empty one");
  }

  console.log("");
  log("Add up to 3 CT accounts you trust most (seeds your personalized feed).");
  log("Enter X usernames without @, or Enter to skip.");
  console.log("");

  const favorites: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const username = prompt(`Account ${i}/3:`);
    if (username) {
      favorites.push(username.replace("@", "").toLowerCase());
    } else if (i === 1) {
      log("Skipping watchlist personalization.");
      break;
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
    const existing = new Set(watchlist.categories.favorites.accounts.map((a: any) =>
      (typeof a === "string" ? a : a.username)?.toLowerCase()
    ));
    for (const f of favorites) {
      if (!existing.has(f)) {
        watchlist.categories.favorites.accounts.push(f);
      }
    }
    ok(`Added ${favorites.length} account(s) to favorites`);
  }

  writeFileSync(WATCHLIST_PATH, JSON.stringify(watchlist, null, 2));
  ok("Watchlist saved");

  // ── Step 5: Install skill file ──
  console.log("");
  log("Installing Claude Code skill...");

  if (!existsSync(SKILL_DEST_DIR)) {
    mkdirSync(SKILL_DEST_DIR, { recursive: true });
  }

  if (existsSync(SKILL_SOURCE)) {
    copyFileSync(SKILL_SOURCE, SKILL_DEST);
    ok(`Skill installed to ${SKILL_DEST_DIR}/`);
  } else {
    warn("ct-alpha.skill not found in repo. Skill auto-routing won't work.");
    log("You can still use the CLI directly: bun run ~/ct-alpha/ct-search.ts");
  }

  // ── Step 6: Verification ──
  console.log("");
  if (hasToken && promptYN("Run a quick test search to verify everything works?")) {
    log("Running: search \"crypto\" --limit 5 ...");
    try {
      const proc = Bun.spawn(
        ["bun", "run", join(CT_ALPHA_DIR, "ct-search.ts"), "search", "crypto", "--limit", "10", "--min-likes", "0"],
        {
          env: { ...process.env, X_BEARER_TOKEN: tokenValue },
          stdout: "pipe",
          stderr: "pipe",
        }
      );
      const output = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      if (exitCode === 0 && output.includes("CT Alpha Search")) {
        ok("Test search succeeded!");
        // Show first 3 lines of results
        const lines = output.split("\n").filter(Boolean);
        for (const line of lines.slice(0, 4)) {
          log(`  ${line}`);
        }
      } else {
        const stderr = await new Response(proc.stderr).text();
        warn("Test search failed:");
        log(stderr.slice(0, 200));
      }
    } catch (err: any) {
      warn(`Test failed: ${err.message}`);
    }
  }

  // ── Done ──
  console.log("");
  console.log("  ─────────────────────────────────────");
  console.log("  ✨ CT Alpha is ready!");
  console.log("");
  console.log("  Usage in Claude Code:");
  console.log("    \"what's CT saying about Pendle?\"");
  console.log("    \"trending tokens on Solana\"");
  console.log("    \"find yield strategies for JTO\"");
  console.log("");
  console.log("  Direct CLI:");
  console.log("    source ~/.config/env/global.env");
  console.log('    bun run ~/ct-alpha/ct-search.ts search "$SOL alpha" --quick');
  console.log("    bun run ~/ct-alpha/ct-search.ts trending --solana-only");
  console.log("    bun run ~/ct-alpha/ct-search.ts cost");
  console.log("");
  console.log("  Cost: ~$0.10 per search (20 tweets × $0.005)");
  console.log("  ─────────────────────────────────────");
  console.log("");
}

main().catch((err) => {
  fail(err.message);
  process.exit(1);
});

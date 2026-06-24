#!/usr/bin/env node
/**
 * Read-only Solana RPC and chain-state probe.
 *
 * Usage:
 *   node scripts/rpc_readiness_probe.mjs launch-config.json [--timeout-ms 8000]
 *
 * Config shape:
 *   {
 *     "cluster": "mainnet-beta",
 *     "rpcEndpoints": ["https://api.mainnet-beta.solana.com"],
 *     "programs": ["..."],
 *     "mints": ["..."]
 *   }
 *
 * The script uses raw JSON-RPC only. It never signs or submits transactions.
 */

import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

const args = process.argv.slice(2);
const configPath = readPositionalArg(args);
const timeoutMs = readNumberArg(args, "--timeout-ms", 8000);

if (args.includes("--help") || args.includes("-h")) {
  printUsage();
  process.exit(0);
}

if (!configPath) {
  printUsage();
  process.exit(2);
}

const config = JSON.parse(await readFile(configPath, "utf8"));
const endpoints = config.rpcEndpoints ?? config.rpc_endpoints ?? [];
const programs = config.programs ?? [];
const mints = config.mints ?? [];

const result = {
  cluster: config.cluster ?? config.target_cluster ?? "unknown",
  rpc: [],
  programs: [],
  mints: [],
  next_step:
    "Use this read-only evidence in the launch-readiness report; network failures are non-blocking evidence, not proof that the app is broken.",
};

for (const endpoint of endpoints) {
  const started = performance.now();
  const probe = {
    endpoint: redactUrl(endpoint),
    ok: false,
    latencyMs: null,
    slot: null,
    latestBlockhash: null,
    error: null,
  };
  try {
    const [slot, blockhash] = await Promise.all([
      rpc(endpoint, "getSlot", [{ commitment: "confirmed" }], timeoutMs),
      rpc(endpoint, "getLatestBlockhash", [{ commitment: "confirmed" }], timeoutMs),
    ]);
    probe.ok = true;
    probe.latencyMs = Math.round(performance.now() - started);
    probe.slot = slot;
    probe.latestBlockhash = blockhash?.value?.blockhash ?? null;
  } catch (error) {
    probe.error = error instanceof Error ? error.message : String(error);
  }
  result.rpc.push(probe);
}

const accountEndpoint = result.rpc.some((probe) => probe.ok) ? endpoints[result.rpc.findIndex((probe) => probe.ok)] : null;
if (!accountEndpoint && (programs.length > 0 || mints.length > 0)) {
  result.next_step =
    "All RPC endpoint probes failed, so account probes were skipped. Record this as unknown/non-blocking evidence and retry with a reachable read-only endpoint.";
}

for (const address of programs) {
  result.programs.push(await readAccount(accountEndpoint, address, "program"));
}

for (const address of mints) {
  result.mints.push(await readAccount(accountEndpoint, address, "mint"));
}

console.log(JSON.stringify(result, null, 2));

async function readAccount(endpoint, address, type) {
  const item = {
    address,
    type,
    exists: false,
    executable: null,
    owner: null,
    lamports: null,
    dataLength: null,
    error: null,
  };
  if (!endpoint) {
    item.error = "missing rpc endpoint";
    return item;
  }
  try {
    const response = await rpc(
      endpoint,
      "getAccountInfo",
      [address, { commitment: "confirmed", encoding: "base64" }],
      timeoutMs,
    );
    const value = response?.value;
    if (!value) {
      return item;
    }
    item.exists = true;
    item.executable = value.executable;
    item.owner = value.owner;
    item.lamports = value.lamports;
    item.dataLength = Array.isArray(value.data) && typeof value.data[0] === "string" ? value.data[0].length : null;
  } catch (error) {
    item.error = error instanceof Error ? error.message : String(error);
  }
  return item;
}

async function rpc(endpoint, method, params = [], timeout = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`timeout after ${timeout}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const payload = await response.json();
  if (payload.error) {
    throw new Error(payload.error.message ?? JSON.stringify(payload.error));
  }
  return payload.result;
}

function readNumberArg(args, name, fallback) {
  const index = args.indexOf(name);
  if (index === -1 || index + 1 >= args.length) {
    return fallback;
  }
  const value = Number(args[index + 1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readPositionalArg(args) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--timeout-ms") {
      index += 1;
      continue;
    }
    if (!arg.startsWith("--")) {
      return arg;
    }
  }
  return null;
}

function printUsage() {
  console.error("Usage: node scripts/rpc_readiness_probe.mjs launch-config.json [--timeout-ms 8000]");
}

function redactUrl(url) {
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
      parsed.searchParams.set(key, "<redacted>");
    }
    if (parsed.username || parsed.password) {
      parsed.username = "<redacted>";
      parsed.password = "<redacted>";
    }
    return parsed.toString();
  } catch {
    return "<invalid-url>";
  }
}

#!/usr/bin/env python3
"""Offline Solana transaction-pattern scanner.

This script looks for transaction reliability patterns in source files. It does
not execute code, call RPC, sign, or submit transactions.
"""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable


SKIP_DIRS = {".git", ".next", ".turbo", "node_modules", "target", "dist", "build", "coverage"}
CODE_EXTS = {".ts", ".tsx", ".js", ".jsx", ".rs"}


@dataclass
class PatternResult:
    name: str
    status: str
    severity: str
    evidence: list[str]
    recommendation: str


PATTERNS = [
    (
        "latest blockhash",
        re.compile(r"getLatestBlockhash|recentBlockhash|blockhash", re.I),
        "missing",
        "warning",
        "Fetch a fresh blockhash close to signing time.",
    ),
    (
        "last valid block height",
        re.compile(r"lastValidBlockHeight", re.I),
        "missing",
        "warning",
        "Track lastValidBlockHeight and surface expired transaction recovery.",
    ),
    (
        "simulation",
        re.compile(r"simulateTransaction|simulate", re.I),
        "missing",
        "warning",
        "Simulate critical transactions or document why simulation is not used.",
    ),
    (
        "priority fee",
        re.compile(r"setComputeUnitPrice|microLamports|priority fee|priorityFee", re.I),
        "missing",
        "warning",
        "Use or intentionally omit priority fees based on expected launch congestion.",
    ),
    (
        "compute budget",
        re.compile(r"ComputeBudgetProgram|setComputeUnitLimit|compute unit", re.I),
        "missing",
        "warning",
        "Set compute limits for complex transactions or document expected units.",
    ),
    (
        "versioned transaction",
        re.compile(r"VersionedTransaction|TransactionMessage|compileToV0Message", re.I),
        "missing",
        "nice-to-have",
        "Use versioned transactions when account lists or wallet compatibility require it.",
    ),
    (
        "address lookup table",
        re.compile(r"AddressLookupTable|lookupTable|lookup table", re.I),
        "missing",
        "nice-to-have",
        "Use ALTs when account lists exceed legacy transaction limits.",
    ),
    (
        "explicit retry config",
        re.compile(r"maxRetries|retry|backoff", re.I),
        "missing",
        "warning",
        "Document retry behavior and avoid duplicate submissions.",
    ),
    (
        "preflight commitment",
        re.compile(r"preflightCommitment", re.I),
        "missing",
        "warning",
        "Set preflight commitment intentionally for launch-critical flows.",
    ),
    (
        "skip preflight",
        re.compile(r"skipPreflight\s*[:=]\s*true", re.I),
        "present-risk",
        "blocker",
        "Disable skipPreflight or document the safety reason and compensating checks.",
    ),
    (
        "partial signing",
        re.compile(r"partialSign|signAllTransactions", re.I),
        "present-signal",
        "info",
        "Verify signature ordering and no existing signatures are dropped.",
    ),
]


def iter_code(root: Path, max_bytes: int) -> Iterable[Path]:
    for path in root.rglob("*"):
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if path.is_file() and path.suffix.lower() in CODE_EXTS and path.stat().st_size <= max_bytes:
            yield path


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return path.read_text(encoding="utf-8", errors="ignore")


def collect_matches(root: Path, files: list[Path], regex: re.Pattern[str]) -> list[str]:
    evidence: list[str] = []
    for path in files:
        for idx, line in enumerate(read_text(path).splitlines(), start=1):
            if regex.search(line):
                evidence.append(f"{path.relative_to(root)}:{idx}: {line.strip()[:180]}")
                if len(evidence) >= 5:
                    return evidence
    return evidence


def scan(root: Path, max_bytes: int = 512_000) -> dict:
    files = list(iter_code(root, max_bytes))
    results: list[PatternResult] = []

    for name, regex, mode, severity, recommendation in PATTERNS:
        evidence = collect_matches(root, files, regex)
        if mode == "missing":
            status = "present" if evidence else "missing"
            result_severity = "info" if evidence else severity
        elif mode == "present-risk":
            status = "present-risk" if evidence else "not-found"
            result_severity = severity if evidence else "info"
        else:
            status = "present-signal" if evidence else "not-found"
            result_severity = severity
        results.append(PatternResult(name, status, result_severity, evidence, recommendation))

    return {
        "root": str(root),
        "summary": {
            "files_scanned": len(files),
            "risk_count": sum(1 for item in results if item.severity in {"blocker", "warning"} and item.status in {"missing", "present-risk"}),
        },
        "patterns": [asdict(item) for item in results],
        "next_step": "Use missing and present-risk patterns as manual review prompts; do not treat this as proof of transaction correctness.",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Scan Solana transaction source patterns without executing code.")
    parser.add_argument("path", nargs="?", default=".", help="Repository path to scan")
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON output")
    parser.add_argument("--max-bytes", type=int, default=512_000, help="Maximum bytes per scanned code file")
    args = parser.parse_args()

    root = Path(args.path).resolve()
    if not root.exists():
        raise SystemExit(f"Path does not exist: {root}")
    print(json.dumps(scan(root, args.max_bytes), indent=2 if args.pretty else None, sort_keys=True))


if __name__ == "__main__":
    main()

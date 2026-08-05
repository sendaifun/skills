#!/usr/bin/env python3
"""Solana launch-readiness repository scanner.

The scanner produces review signals, not final severity. It never signs
transactions, never calls Solana RPC, and applies best-effort redaction to
secret-like evidence.
"""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable


SKIP_DIRS = {
    ".git",
    ".next",
    ".turbo",
    ".vercel",
    "node_modules",
    "target",
    "dist",
    "build",
    "coverage",
}

PRIVATE_ENV_FILES = {
    ".env",
    ".env.local",
    ".env.production",
    ".env.development",
    ".env.test",
}

LOCK_FILES = {
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
}

TEXT_EXTS = {
    ".example",
    ".json",
    ".toml",
    ".yaml",
    ".yml",
    ".md",
    ".txt",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".rs",
    ".py",
    ".sh",
}

SECRET_ASSIGNMENT_RE = re.compile(
    r"\b([A-Z0-9_]*(?:PRIVATE_KEY|SECRET_KEY|SECRET|SEED_PHRASE|MNEMONIC|RPC_KEY|API_KEY|PROJECT_KEY|ACCESS_TOKEN|AUTH_TOKEN|TOKEN|PASSWORD|DSN)[A-Z0-9_]*)"
    r"\s*[:=]\s*(\[[^\]\n]{8,}\]|['\"][^'\"]{4,}['\"]|[^'\"\n#,} ]{4,})",
    re.I,
)

MNEMONIC_ASSIGNMENT_RE = re.compile(
    r"\b([A-Z0-9_]*(?:SEED_PHRASE|MNEMONIC)[A-Z0-9_]*)\s*[:=]\s*(['\"])([^'\"]{20,})\2",
    re.I,
)

BEARER_RE = re.compile(r"\b(Bearer)\s+[A-Za-z0-9._~+/=-]{12,}", re.I)

URL_RE = re.compile(r"https://[^\s'\"),]+", re.I)

SENSITIVE_URL_KEYS = {
    "api-key",
    "apikey",
    "api_key",
    "key",
    "token",
    "access_token",
    "auth",
    "secret",
    "signature",
}

PROVIDER_HOST_RE = re.compile(r"(helius|quicknode|quiknode|triton|alchemy|ankr)", re.I)

RPC_ENDPOINT_RE = re.compile(
    r"https://[^\s'\"),]*(?:api\.mainnet-beta\.solana\.com|api\.devnet\.solana\.com|api\.testnet\.solana\.com|helius|quicknode|triton)[^\s'\"),]*",
    re.I,
)


@dataclass
class Finding:
    kind: str
    severity: str
    area: str
    title: str
    file: str
    line: int
    evidence: str
    recommendation: str


def is_text_candidate(path: Path, include_private_env: bool) -> bool:
    if path.name in LOCK_FILES:
        return False
    if path.name in PRIVATE_ENV_FILES:
        return include_private_env
    if path.name in {".env.example", "env.example"}:
        return True
    return path.suffix.lower() in TEXT_EXTS


def iter_files(root: Path, include_private_env: bool, max_files: int, max_bytes: int) -> tuple[list[Path], list[dict]]:
    files: list[Path] = []
    skipped: list[dict] = []

    for path in root.rglob("*"):
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if not path.is_file():
            continue
        if not is_text_candidate(path, include_private_env):
            continue
        if path.stat().st_size > max_bytes:
            skipped.append({"file": str(path.relative_to(root)), "reason": "file too large"})
            continue
        if len(files) >= max_files:
            skipped.append({"file": str(path.relative_to(root)), "reason": "max file limit reached"})
            continue
        files.append(path)

    return files, skipped


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return path.read_text(encoding="utf-8", errors="ignore")


def sanitize_evidence(line: str) -> str:
    sanitized = line.strip()
    sanitized = URL_RE.sub(redact_url, sanitized)
    sanitized = BEARER_RE.sub(r"\1 <redacted>", sanitized)
    sanitized = MNEMONIC_ASSIGNMENT_RE.sub(lambda m: f"{m.group(1)}=<redacted>", sanitized)
    sanitized = SECRET_ASSIGNMENT_RE.sub(lambda m: f"{m.group(1)}=<redacted>", sanitized)
    return sanitized[:260]


def redact_url(match: re.Match[str]) -> str:
    value = match.group(0)
    try:
        from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

        parsed = urlsplit(value)
        query = urlencode(
            [
                (key, "<redacted>" if key.lower() in SENSITIVE_URL_KEYS else val)
                for key, val in parse_qsl(parsed.query, keep_blank_values=True)
            ]
        )
        netloc = parsed.netloc
        if "@" in netloc:
            credentials, host = netloc.rsplit("@", 1)
            if credentials:
                netloc = f"<redacted>@{host}"

        path = parsed.path
        if PROVIDER_HOST_RE.search(parsed.netloc) or RPC_ENDPOINT_RE.search(value):
            path_parts = path.split("/")
            redacted_parts = []
            for part in path_parts:
                if len(part) >= 12 and re.fullmatch(r"[A-Za-z0-9._~+=-]+", part):
                    redacted_parts.append("<redacted>")
                else:
                    redacted_parts.append(part)
            path = "/".join(redacted_parts)
        return urlunsplit((parsed.scheme, netloc, path, query, parsed.fragment))
    except Exception:
        return "https://<redacted-url>"


def add_finding(
    findings: list[Finding],
    root: Path,
    kind: str,
    severity: str,
    area: str,
    title: str,
    path: Path | None,
    line: int,
    evidence: str,
    recommendation: str,
) -> None:
    rel = "." if path is None else str(path.relative_to(root))
    findings.append(
        Finding(
            kind=kind,
            severity=severity,
            area=area,
            title=title,
            file=rel,
            line=line,
            evidence=sanitize_evidence(evidence),
            recommendation=recommendation,
        )
    )


def has_file(rel_files: set[str], *names: str) -> bool:
    lower = {name.lower() for name in rel_files}
    return any(name.lower() in lower for name in names)


def scan_clusters(root: Path, files: list[Path], findings: list[Finding]) -> dict[str, list[dict]]:
    clusters: dict[str, list[dict]] = {"mainnet-beta": [], "devnet": [], "testnet": [], "localnet": []}
    for path in files:
        for idx, line in enumerate(read_text(path).splitlines(), start=1):
            lowered = line.lower()
            if "mainnet-beta" in lowered or re.search(r"\bmainnet\b", lowered):
                clusters["mainnet-beta"].append({"file": str(path.relative_to(root)), "line": idx})
            for name in ["devnet", "testnet", "localnet"]:
                if re.search(rf"\b{name}\b", lowered):
                    clusters[name].append({"file": str(path.relative_to(root)), "line": idx})

    if clusters["mainnet-beta"] and clusters["devnet"]:
        add_finding(
            findings,
            root,
            "risk",
            "blocker",
            "Network/RPC",
            "Mixed mainnet-beta and devnet references",
            None,
            0,
            "mainnet-beta and devnet both appear across launch docs/config.",
            "Make the launch target single-source-of-truth and fail closed when production env vars are missing.",
        )
    return clusters


def scan_file_patterns(root: Path, files: list[Path], findings: list[Finding]) -> None:
    line_patterns = [
        (
            "risk",
            "blocker",
            "Secrets",
            "Possible committed private key or seed phrase",
            SECRET_ASSIGNMENT_RE,
            "Remove secrets from git history, rotate the credential, and use secret storage.",
        ),
        (
            "risk",
            "warning",
            "Network/RPC",
            "Direct RPC endpoint reference",
            RPC_ENDPOINT_RE,
            "Keep RPC endpoints configurable; document timeout, retry, fallback, and key exposure behavior.",
        ),
        (
            "risk",
            "blocker",
            "Transactions",
            "skipPreflight enabled",
            re.compile(r"skipPreflight\s*[:=]\s*true", re.I),
            "Disable skipPreflight or document the exact simulation/rollback reason before public launch.",
        ),
        (
            "signal",
            "info",
            "Wallet UX",
            "Wallet signing flow found",
            re.compile(r"signTransaction|signAllTransactions|signMessage|wallet\.adapter|WalletAdapter", re.I),
            "Verify rejected-signature, disconnected-wallet, and wrong-network recovery paths.",
        ),
        (
            "signal",
            "info",
            "Transactions",
            "Transaction send or confirmation flow found",
            re.compile(r"sendRawTransaction|sendAndConfirm|sendTransaction|confirmTransaction", re.I),
            "Inspect expiration, retry, duplicate submission, and user-facing error handling.",
        ),
        (
            "signal",
            "info",
            "Observability/Ops",
            "Monitoring or analytics reference found",
            re.compile(r"sentry|posthog|datadog|grafana|prometheus|analytics|telemetry", re.I),
            "Confirm events include privacy-safe transaction failure and support triage context.",
        ),
    ]

    for path in files:
        text = read_text(path)
        for idx, line in enumerate(text.splitlines(), start=1):
            for kind, severity, area, title, regex, recommendation in line_patterns:
                if regex.search(line):
                    add_finding(findings, root, kind, severity, area, title, path, idx, line, recommendation)

        if path.suffix.lower() in {".ts", ".tsx", ".js", ".jsx"}:
            inspect_code_file(root, path, text, findings)


def inspect_code_file(root: Path, path: Path, text: str, findings: list[Finding]) -> None:
    if "setPending(true)" in text and "catch" in text:
        catch_blocks = re.findall(r"catch\s*\([^)]*\)\s*\{(?P<body>.*?)\n\s*\}", text, flags=re.S)
        if catch_blocks and not any("setPending(false)" in block for block in catch_blocks):
            add_finding(
                findings,
                root,
                "risk",
                "blocker",
                "Wallet UX",
                "Rejected signatures can leave checkout pending",
                path,
                line_for(text, "catch"),
                "catch block does not reset pending state after wallet/RPC failure.",
                "Reset pending state, show actionable copy, and allow retry/cancel after rejection or RPC failure.",
            )

    if re.search(r"confirmTransaction\s*\(\s*signature\s*,\s*['\"]confirmed['\"]", text):
        add_finding(
            findings,
            root,
            "risk",
            "warning",
            "Transactions",
            "Legacy confirmation call lacks blockhash expiry context",
            path,
            line_for(text, "confirmTransaction"),
            "confirmTransaction(signature, \"confirmed\")",
            "Use latest blockhash plus lastValidBlockHeight, handle expiry, and show retry guidance.",
        )

    if "sendRawTransaction" in text and "maxRetries" not in text:
        add_finding(
            findings,
            root,
            "risk",
            "warning",
            "Transactions",
            "sendRawTransaction has no visible maxRetries setting",
            path,
            line_for(text, "sendRawTransaction"),
            "sendRawTransaction call without maxRetries in the same file.",
            "Set intentional retry behavior and document the user-facing pending/failed state.",
        )


def line_for(text: str, needle: str) -> int:
    for idx, line in enumerate(text.splitlines(), start=1):
        if needle in line:
            return idx
    return 0


def scan_repo_level(root: Path, files: list[Path], rel_files: set[str], findings: list[Finding]) -> None:
    if not any(Path(name).name.lower().startswith("readme") for name in rel_files):
        add_finding(
            findings,
            root,
            "risk",
            "warning",
            "Docs/DX",
            "Repository has no README",
            None,
            0,
            "No README-like file was found.",
            "Add setup, target network, addresses, and launch instructions.",
        )

    if ".env.example" not in rel_files and "env.example" not in rel_files:
        add_finding(
            findings,
            root,
            "risk",
            "warning",
            "Network/RPC",
            "Missing environment example",
            None,
            0,
            "No .env.example or env.example file was found.",
            "Add a sanitized env example with required Solana RPC and network variables.",
        )

    if "package.json" in rel_files:
        package = json.loads((root / "package.json").read_text(encoding="utf-8"))
        scripts = package.get("scripts", {})
        for script in ["build", "test", "lint"]:
            if script not in scripts:
                add_finding(
                    findings,
                    root,
                    "risk",
                    "warning",
                    "Release Control",
                    f"package.json missing {script} script",
                    root / "package.json",
                    0,
                    f"scripts.{script} is not defined.",
                    f"Add an npm {script} script or document the equivalent release gate.",
                )
    else:
        add_finding(
            findings,
            root,
            "risk",
            "warning",
            "Release Control",
            "Missing package.json",
            None,
            0,
            "No package.json found for frontend/app release checks.",
            "Document the framework, build command, and release validation commands.",
        )

    if not any(name.startswith(".github/workflows/") for name in rel_files):
        add_finding(
            findings,
            root,
            "risk",
            "warning",
            "Release Control",
            "No CI workflow found",
            None,
            0,
            "No .github/workflows file found.",
            "Add CI or document the release gate used before public launch.",
        )
    else:
        add_finding(
            findings,
            root,
            "strength",
            "info",
            "Release Control",
            "CI workflow found",
            None,
            0,
            "A .github/workflows file exists.",
            "Confirm it runs the same checks required for launch approval.",
        )

    if any("launch-config" in name for name in rel_files):
        add_finding(
            findings,
            root,
            "signal",
            "info",
            "Ops",
            "Launch config artifact found",
            None,
            0,
            "A launch-config file exists.",
            "Verify owners, rollback/pause commands, target cluster, addresses, and RPC providers are complete.",
        )

    scan_missing_explorer_and_authority(root, files, findings)


def scan_missing_explorer_and_authority(root: Path, files: list[Path], findings: list[Finding]) -> None:
    for path in files:
        if path.suffix.lower() not in {".md", ".yaml", ".yml"}:
            continue
        text = read_text(path)
        for idx, line in enumerate(text.splitlines(), start=1):
            lowered = line.lower()
            if "explorer" in lowered and "todo" in lowered:
                add_finding(
                    findings,
                    root,
                    "risk",
                    "warning",
                    "Addresses/Metadata",
                    "Explorer link is missing or marked TODO",
                    path,
                    idx,
                    line,
                    "Add correct explorer links for every public program, mint, market, and config address.",
                )
            if path.suffix.lower() == ".md" and "| todo" in lowered:
                add_finding(
                    findings,
                    root,
                    "risk",
                    "warning",
                    "Addresses/Metadata",
                    "Explorer link is missing or marked TODO",
                    path,
                    idx,
                    line,
                    "Add correct explorer links for every public program, mint, market, and config address.",
                )
            if "authority" in lowered and "todo" in lowered:
                add_finding(
                    findings,
                    root,
                    "risk",
                    "warning",
                    "Addresses/Metadata",
                    "Authority status is not disclosed",
                    path,
                    idx,
                    line,
                    "Disclose upgrade, freeze, mint, or governance authority status when relevant.",
                )
            if ("pause_command" in lowered or "rollback_command" in lowered) and "todo" in lowered:
                add_finding(
                    findings,
                    root,
                    "risk",
                    "warning",
                    "Ops",
                    "Pause or rollback command is missing",
                    path,
                    idx,
                    line,
                    "Document the exact pause/rollback owner and command before launch day.",
                )


def build_counts(findings: list[Finding], key: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for finding in findings:
        value = getattr(finding, key)
        counts[value] = counts.get(value, 0) + 1
    return counts


def scan(root: Path, include_private_env: bool = False, max_files: int = 500, max_bytes: int = 512_000) -> dict:
    findings: list[Finding] = []
    files, skipped = iter_files(root, include_private_env, max_files, max_bytes)
    rel_files = {str(p.relative_to(root)) for p in files}

    scan_repo_level(root, files, rel_files, findings)
    scan_file_patterns(root, files, findings)
    clusters = scan_clusters(root, files, findings)

    findings.sort(key=lambda item: ({"risk": 0, "signal": 1, "strength": 2}.get(item.kind, 3), item.file, item.line, item.title))

    return {
        "root": str(root),
        "summary": {
            "files_scanned": len(files),
            "files_skipped": skipped,
            "finding_counts": build_counts(findings, "kind"),
            "severity_counts": build_counts(findings, "severity"),
            "clusters_seen": {name: refs for name, refs in clusters.items() if refs},
            "private_env_scanned": include_private_env,
        },
        "risks": [asdict(f) for f in findings if f.kind == "risk"],
        "signals": [asdict(f) for f in findings if f.kind == "signal"],
        "strengths": [asdict(f) for f in findings if f.kind == "strength"],
        "next_step": "Use these as evidence signals for the full launch-readiness report; manually verify impact before assigning final go/no-go severity.",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Safely scan a Solana app repo for launch-readiness signals.")
    parser.add_argument("path", nargs="?", default=".", help="Repository path to scan")
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON output")
    parser.add_argument("--include-private-env", action="store_true", help="Also scan .env/.env.local/.env.production with secret redaction")
    parser.add_argument("--max-files", type=int, default=500, help="Maximum text files to scan")
    parser.add_argument("--max-bytes", type=int, default=512_000, help="Maximum bytes per scanned file")
    parser.add_argument("--output", help="Write JSON output to this file instead of stdout")
    args = parser.parse_args()

    root = Path(args.path).resolve()
    if not root.exists():
        raise SystemExit(f"Path does not exist: {root}")

    result = scan(root, args.include_private_env, args.max_files, args.max_bytes)
    payload = json.dumps(result, indent=2 if args.pretty else None, sort_keys=True)
    if args.output:
        Path(args.output).write_text(payload + "\n", encoding="utf-8")
    else:
        print(payload)


if __name__ == "__main__":
    main()

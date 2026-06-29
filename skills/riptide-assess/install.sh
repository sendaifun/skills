#!/usr/bin/env bash
# riptide-assess — Riptide CLI bootstrap.
#
# Installs the Riptide CLI if `riptide` is not already on your PATH, then
# verifies it. Idempotent: safe to re-run.
#
# Riptide runs deterministic guided simulations of Solana programs. `riptide
# sim generate` scaffolds a project-owned Rust crate that builds against the
# vendored runtime, so there is no separate engine binary to manage — but you
# do need the build toolchain below.
#
# Prerequisites the installer expects (Linux; macOS may work, untested):
#   - rustup / cargo + rustc
#   - node >= 20 and npm
#   - the Solana SBF toolchain (cargo-build-sbf, via the Anza/Solana install)
# Riptide is NOT published to npm — do not `npm i riptide`.

set -euo pipefail

if command -v riptide >/dev/null 2>&1; then
  echo "riptide already installed: $(riptide --version 2>/dev/null || echo '(version check failed)')"
  exit 0
fi

echo "riptide not found on PATH — installing via the public installer..."
echo "(needs cargo + node + the Solana SBF toolchain; Riptide is not on npm)"
curl -fsSL https://riptide.run/install | sh

# The installer drops a launcher into \$HOME/.local/bin.
if ! command -v riptide >/dev/null 2>&1; then
  case ":${PATH}:" in
    *":${HOME}/.local/bin:"*) : ;;
    *)
      echo ""
      echo "riptide installed, but \$HOME/.local/bin is not on your PATH. Add it:"
      echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
      echo "then re-open your shell (or 'source' your shell rc) and re-run this script."
      exit 1
      ;;
  esac
fi

echo ""
riptide --version
echo "riptide is ready. Next: riptide doctor"

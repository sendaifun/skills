#!/usr/bin/env bash
# Upload file or text to DROYD agent storage
# Usage: droyd-files-write.sh <filepath> <content_or_@file>
# For text: droyd-files-write.sh "scripts/hello.py" "print('hello')"
# For file: droyd-files-write.sh "scripts/local.py" "@./local-script.py"

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/droyd.sh"

FILEPATH="${1:-}"
CONTENT="${2:-}"

if [[ -z "$FILEPATH" || -z "$CONTENT" ]]; then
  echo "Usage: droyd-files-write.sh <filepath> <content_or_@file>" >&2
  echo "  Text:  droyd-files-write.sh \"scripts/hello.py\" \"print('hello')\"" >&2
  echo "  File:  droyd-files-write.sh \"scripts/local.py\" \"@./local-script.py\"" >&2
  exit 1
fi

# Uses multipart/form-data (not droyd_request)
if [[ "$CONTENT" == @* ]]; then
  # File upload - strip @ prefix
  LOCAL_FILE="${CONTENT:1}"
  if [[ ! -f "$LOCAL_FILE" ]]; then
    echo "Error: File not found: $LOCAL_FILE" >&2
    exit 1
  fi
  curl -s -X POST "${DROYD_API_URL}/api/v1/files/write" \
    -H "x-droyd-api-key: $DROYD_API_KEY" \
    -F "file=@$LOCAL_FILE" \
    -F "filepath=$FILEPATH"
else
  # Text content
  curl -s -X POST "${DROYD_API_URL}/api/v1/files/write" \
    -H "x-droyd-api-key: $DROYD_API_KEY" \
    -F "content=$CONTENT" \
    -F "filepath=$FILEPATH"
fi

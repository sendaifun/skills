#!/bin/bash
set -euo pipefail

SKILL_DIR="skills"
OUTPUT_DIR=".opencode"
OUTPUT_FILE="$OUTPUT_DIR/instructions.md"

if [ $# -eq 0 ]; then
  echo "Usage: $0 <skill-name> [skill-name...]"
  echo ""
  echo "Available skills:"
  ls "$SKILL_DIR" | grep -v example-skill | sort
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

if [ -f "$OUTPUT_FILE" ]; then
  echo "Appending to existing $OUTPUT_FILE"
else
  echo "Creating $OUTPUT_FILE"
fi

added=0

for skill in "$@"; do
  skill_file="$SKILL_DIR/$skill/SKILL.md"

  if [ ! -f "$skill_file" ]; then
    echo "Error: Skill '$skill' not found at $skill_file"
    continue
  fi

  first_line=$(sed '1,/^---$/d' "$skill_file" | grep -m1 '.')
  if [ -f "$OUTPUT_FILE" ] && grep -qF "$first_line" "$OUTPUT_FILE" 2>/dev/null; then
    echo "Skipped: '$skill' already present in $OUTPUT_FILE"
    continue
  fi

  if [ $added -gt 0 ] || [ -s "$OUTPUT_FILE" 2>/dev/null ]; then
    echo "" >> "$OUTPUT_FILE"
    echo "---" >> "$OUTPUT_FILE"
    echo "" >> "$OUTPUT_FILE"
  fi

  sed '1{/^---$/!q;};1,/^---$/d' "$skill_file" >> "$OUTPUT_FILE"
  echo "Added: $skill"
  added=$((added + 1))
done

echo ""
echo "Done. $added skill(s) written to $OUTPUT_FILE"

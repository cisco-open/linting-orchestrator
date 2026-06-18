#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────────────────
# generate-openapi.sh — Export the auto-generated OpenAPI specification
#
# Usage:
#   bash scripts/generate-openapi.sh              # default: exports/openapi.json
#   bash scripts/generate-openapi.sh <outfile>    # custom output path
#
# Prerequisites:
#   - Spectify server must be running (npm start / npm run dev)
#   - Server must be reachable at http://localhost:${PORT:-3003}
#
# The script fetches the live spec from /docs/openapi.json, upgrades the
# openapi version field to 3.1.0, pretty-prints it, and writes it to the
# exports/ directory (or a custom path).
# ────────────────────────────────────────────────────────────────────────────
set -euo pipefail

PORT="${PORT:-3003}"
BASE_URL="http://localhost:${PORT}"
ENDPOINT="${BASE_URL}/docs/openapi.json"
DEFAULT_OUTPUT="exports/openapi.json"
OUTPUT="${1:-$DEFAULT_OUTPUT}"

# Ensure output directory exists
mkdir -p "$(dirname "$OUTPUT")"

# Check that the server is reachable
if ! curl -sf "${BASE_URL}/health" > /dev/null 2>&1; then
  echo "❌ Spectify server is not running at ${BASE_URL}"
  echo ""
  echo "   Start it first:"
  echo "     npm start          # standalone mode"
  echo "     npm run dev        # development mode (auto-reload)"
  echo ""
  exit 1
fi

# Fetch the spec and upgrade to OpenAPI 3.1.0
echo "📥 Fetching OpenAPI spec from ${ENDPOINT} ..."

curl -sf "$ENDPOINT" \
  | node -e "
    process.stdin.resume();
    let data = '';
    process.stdin.on('data', chunk => data += chunk);
    process.stdin.on('end', () => {
      const spec = JSON.parse(data);
      spec.openapi = '3.1.0';
      process.stdout.write(JSON.stringify(spec, null, 2) + '\n');
    });
  " > "$OUTPUT"

# Verify output
SIZE=$(wc -c < "$OUTPUT")
PATHS=$(node -e "const s=require('./${OUTPUT}'); console.log(Object.keys(s.paths).length)")
SCHEMAS=$(node -e "const s=require('./${OUTPUT}'); console.log(Object.keys(s.components.schemas).length)")

echo "✅ ${OUTPUT} generated (${SIZE} bytes, ${PATHS} paths, ${SCHEMAS} schemas)"

#!/bin/bash

# MCP + Spectify Companion Mode Launcher
# Simplified script for starting Spectify alongside MCP OpenAPI Analyzer

set -e

# Configuration
SPECTIFY_PORT="${SPECTIFY_PORT:-3004}"
MCP_DOCUMENTS_PATH="${MCP_DOCUMENTS_PATH:-../mcp-openapi-analysis/datastore/documents}"

echo "🚀 Starting Spectify in companion mode..."
echo "   Port: $SPECTIFY_PORT"
echo "   Document Store: $MCP_DOCUMENTS_PATH"
echo ""

# Check if spectifyd is available
if ! command -v spectifyd &> /dev/null; then
  echo "❌ Error: spectifyd not found"
  echo ""
  echo "Install it with:"
  echo "  cd /path/to/spectify && npm link"
  exit 1
fi

# Start Spectify in background
spectifyd \
  --mode companion \
  --port "$SPECTIFY_PORT" \
  --document-store "$MCP_DOCUMENTS_PATH" \
  > /tmp/spectify-companion.log 2>&1 &

SPECTIFY_PID=$!
echo "✅ Spectify started (PID: $SPECTIFY_PID)"
echo "   Logs: /tmp/spectify-companion.log"
echo ""

# Wait for health check
echo "Waiting for Spectify to be ready..."
for i in {1..30}; do
  if curl -s "http://localhost:$SPECTIFY_PORT/health" > /dev/null 2>&1; then
    echo "✅ Spectify ready after ${i}s"
    echo ""
    break
  fi
  if [ $i -eq 30 ]; then
    echo "⚠️  Timeout waiting for Spectify"
    echo "   Check logs: tail -f /tmp/spectify-companion.log"
    exit 1
  fi
  sleep 1
done

# Now start MCP
echo "🚀 Starting MCP OpenAPI Analyzer..."
cd ../mcp-openapi-analysis
npm start

# Cleanup on exit
trap "kill $SPECTIFY_PID 2>/dev/null" EXIT

#!/bin/bash
# Test Report Service Integration with Spectify
#
# Usage: ./test-report-integration.sh

set -e

echo "🧪 Testing Report Service Integration"
echo "======================================"
echo ""

# Check if Report Service is running
echo "1️⃣  Checking Report Service..."
if curl -s http://localhost:3010/health > /dev/null 2>&1; then
  echo "   ✅ Report Service is running on port 3010"
else
  echo "   ❌ Report Service not running on port 3010"
  echo "   Please start the Report Service first"
  exit 1
fi

# Get API key from environment or prompt
if [ -z "$REPORT_SERVICE_API_KEY" ]; then
  echo ""
  echo "❓ Enter Report Service API key (or press Enter to skip):"
  read -r API_KEY
  if [ -z "$API_KEY" ]; then
    echo "   ⚠️  No API key provided - continuing without Report Service"
    export REPORT_SERVICE_ENABLED=false
  else
    export REPORT_SERVICE_API_KEY="$API_KEY"
    export REPORT_SERVICE_ENABLED=true
  fi
else
  echo "   ✅ Using API key from environment"
  export REPORT_SERVICE_ENABLED=true
fi

echo ""
echo "2️⃣  Starting Spectify with Report Service integration..."
echo "   REPORT_SERVICE_ENABLED=$REPORT_SERVICE_ENABLED"
echo "   REPORT_SERVICE_URL=http://localhost:3010"
echo ""

# Start Spectify in background
export REPORT_SERVICE_URL=http://localhost:3010
export PORT=3003

# Kill any existing Spectify instance
pkill -f "node.*spectify" 2>/dev/null || true
sleep 1

# Start server in background
node build/index.js &
SERVER_PID=$!

echo "   🚀 Spectify started (PID: $SERVER_PID)"

# Wait for server to start
echo ""
echo "3️⃣  Waiting for server to start..."
for i in {1..10}; do
  if curl -s http://localhost:3003/health > /dev/null 2>&1; then
    echo "   ✅ Spectify is ready!"
    break
  fi
  sleep 1
  echo -n "."
done
echo ""

# Check health endpoint for Report Service status
echo ""
echo "4️⃣  Checking health endpoint..."
HEALTH=$(curl -s http://localhost:3003/health)
echo "$HEALTH" | jq '{status, version, reportService}' 2>/dev/null || echo "$HEALTH"

echo ""
echo "5️⃣  Finding a test document..."
DOCUMENT_ID=$(ls uploads/documents/*.json 2>/dev/null | head -1 | xargs basename .json || echo "")

if [ -z "$DOCUMENT_ID" ]; then
  echo "   ⚠️  No documents found in uploads/documents/"
  echo "   Please upload a document first or use custom-uploads/"
  
  # Check custom-uploads
  DOCUMENT_ID=$(ls custom-uploads/documents/*.json 2>/dev/null | head -1 | xargs basename .json || echo "")
  if [ -n "$DOCUMENT_ID" ]; then
    echo "   ✅ Found document in custom-uploads: $DOCUMENT_ID"
    export DOCUMENT_STORE_DIR=./custom-uploads
  fi
fi

if [ -z "$DOCUMENT_ID" ]; then
  echo ""
  echo "❌ No test documents available. Please upload a document first."
  echo ""
  echo "To cleanup:"
  echo "  kill $SERVER_PID"
  exit 1
fi

echo "   ✅ Using document: $DOCUMENT_ID"

echo ""
echo "6️⃣  Submitting lint job..."
JOB_RESPONSE=$(curl -s -X POST http://localhost:3003/lint \
  -H "Content-Type: application/json" \
  -d "{\"documentId\": \"$DOCUMENT_ID\", \"rulesetName\": \"pubhub\"}")

JOB_ID=$(echo "$JOB_RESPONSE" | jq -r '.jobId' 2>/dev/null || echo "")

if [ -z "$JOB_ID" ] || [ "$JOB_ID" = "null" ]; then
  echo "   ❌ Failed to submit job"
  echo "   Response: $JOB_RESPONSE"
  echo ""
  echo "To cleanup:"
  echo "  kill $SERVER_PID"
  exit 1
fi

echo "   ✅ Job submitted: $JOB_ID"

echo ""
echo "7️⃣  Waiting for job completion..."
for i in {1..30}; do
  STATUS=$(curl -s http://localhost:3003/lint/$JOB_ID | jq -r '.status' 2>/dev/null || echo "unknown")
  
  if [ "$STATUS" = "completed" ] || [ "$STATUS" = "completed_with_errors" ] || [ "$STATUS" = "failed" ] || [ "$STATUS" = "timeout" ]; then
    echo "   ✅ Job completed with status: $STATUS"
    break
  fi
  
  echo -n "."
  sleep 1
done
echo ""

# Get job results
echo ""
echo "8️⃣  Checking job results..."
curl -s http://localhost:3003/lint/$JOB_ID | jq '{jobId, status, summary}' || echo "Failed to get results"

# Check Report Service for the job
if [ "$REPORT_SERVICE_ENABLED" = "true" ]; then
  echo ""
  echo "9️⃣  Checking Report Service for job notification..."
  sleep 2  # Give client time to send notification
  
  # Try to get job from Report Service (if it has an API for that)
  REPORT_JOBS=$(curl -s "http://localhost:3010/api/jobs?documentId=$DOCUMENT_ID&limit=1" \
    -H "Authorization: Bearer $REPORT_SERVICE_API_KEY" 2>/dev/null || echo "{}")
  
  echo "$REPORT_JOBS" | jq '.' 2>/dev/null || echo "Report Service response: $REPORT_JOBS"
  
  # Check pending notifications
  echo ""
  echo "🔍 Checking pending notifications directory..."
  if [ -d "./pending-reports" ]; then
    PENDING_COUNT=$(ls -1 ./pending-reports/*.json 2>/dev/null | wc -l)
    echo "   Pending notifications: $PENDING_COUNT"
    if [ "$PENDING_COUNT" -gt 0 ]; then
      echo "   ⚠️  Some notifications are pending (Report Service may be unreachable)"
    else
      echo "   ✅ No pending notifications (all sent successfully)"
    fi
  else
    echo "   ℹ️  No pending-reports directory"
  fi
fi

echo ""
echo "✅ Test complete!"
echo ""
echo "To stop the server:"
echo "  kill $SERVER_PID"
echo ""
echo "Spectify logs (Ctrl+C to stop):"
echo "  tail -f /tmp/spectify-test.log"

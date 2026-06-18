#!/bin/bash
# Test script for mock server

echo "🧪 Testing Mock OpenAPI Lint Orchestrator"
echo ""

BASE_URL="http://localhost:3003"

# Test 1: Health check
echo "1️⃣ Testing health endpoint..."
curl -s "$BASE_URL/health" | jq -r '.status'
echo ""

# Test 2: List rulesets
echo "2️⃣ Testing rulesets endpoint..."
curl -s "$BASE_URL/rulesets" | jq -r '.rulesets[0].name'
echo ""

# Test 3: Submit lint job
echo "3️⃣ Submitting lint job..."
JOB_RESPONSE=$(curl -s -X POST "$BASE_URL/lint" \
  -H "Content-Type: application/json" \
  -d '{"documentId": "test-doc", "rulesetName": "pubhub"}')

JOB_ID=$(echo "$JOB_RESPONSE" | jq -r '.jobId')
echo "Job ID: $JOB_ID"
echo "Status: $(echo "$JOB_RESPONSE" | jq -r '.status')"
echo ""

# Test 4: Get job status
echo "4️⃣ Checking job status..."
sleep 1
curl -s "$BASE_URL/lint/$JOB_ID" | jq -r '.status'
echo ""

# Test 5: Get job results (wait for completion)
echo "5️⃣ Waiting for job completion..."
sleep 3
RESULTS=$(curl -s "$BASE_URL/lint/$JOB_ID/results")
echo "Final status: $(echo "$RESULTS" | jq -r '.status')"
echo "Total issues: $(echo "$RESULTS" | jq -r '.summary.totalIssues')"
echo "Errors: $(echo "$RESULTS" | jq -r '.summary.errorCount')"
echo "Warnings: $(echo "$RESULTS" | jq -r '.summary.warningCount')"
echo ""

echo "✅ All tests completed!"

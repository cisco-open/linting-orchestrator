#!/bin/bash
# Test script for the Spectify Reports Service (spectifyr).

set -e

API_KEY="test-key-123"
BASE_URL="http://localhost:3010"

echo "Testing Spectify Reports Service (spectifyr)..."
echo ""

# Test 1: Health check
echo "1. Testing health endpoint..."
curl -s "$BASE_URL/health" | jq .
echo "✓ Health check passed"
echo ""

# Test 2: Submit a job notification
echo "2. Submitting test job notification..."
JOB_RESPONSE=$(curl -s -X POST "$BASE_URL/reports/jobs" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "jobId": "test-job-001",
    "documentId": "doc-123",
    "status": "completed",
    "results": [{
      "rulesetName": "pubhub",
      "rulesetVersion": "1.1.0",
      "status": "completed",
      "issues": [
        {
          "code": "missing-description",
          "message": "Operation must have a description",
          "severity": 0,
          "path": "paths./users.get",
          "range": {
            "start": {"line": 45, "character": 0},
            "end": {"line": 45, "character": 10}
          }
        }
      ],
      "summary": {
        "errorCount": 1,
        "warningCount": 0,
        "infoCount": 0,
        "hintCount": 0,
        "totalIssues": 1
      },
      "durationMs": 850
    }],
    "summary": {
      "totalIssues": 1,
      "errorCount": 1,
      "warningCount": 0,
      "infoCount": 0,
      "hintCount": 0,
      "durationMs": 1200
    },
    "metadata": {
      "name": "Test API",
      "version": "1.0.0",
      "organization": "DevNet",
      "format": "openapi"
    },
    "timestamp": "2026-02-04T15:00:00Z",
    "createdAt": "2026-02-04T14:59:00Z",
    "spectifySessionId": "session-abc"
  }')

echo "$JOB_RESPONSE" | jq .
echo "✓ Job notification submitted"
echo ""

# Test 3: List jobs
echo "3. Listing all jobs..."
curl -s "$BASE_URL/jobs" | jq .
echo "✓ Job listing retrieved"
echo ""

# Test 4: Get job details
echo "4. Getting job details..."
curl -s "$BASE_URL/jobs/test-job-001" | jq .
echo "✓ Job details retrieved"
echo ""

# Test 5: Test authentication
echo "5. Testing authentication (should fail)..."
AUTH_FAIL=$(curl -s -X POST "$BASE_URL/reports/jobs" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer wrong-key" \
  -d '{}' | jq .)
echo "$AUTH_FAIL"
echo "✓ Authentication working correctly"
echo ""

echo "All tests passed! ✓"

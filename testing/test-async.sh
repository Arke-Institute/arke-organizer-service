#!/bin/bash
# Test the async DO endpoints of the organizer service
# Note: Callbacks won't work without orchestrator, but we can verify DO processing

set -e

BASE_URL="${ORGANIZER_URL:-http://localhost:8787}"
BATCH_ID="test-batch-$(date +%s)"
CHUNK_ID="chunk-001"

echo "============================================"
echo "Organizer Service Async DO Pattern Tests"
echo "Base URL: $BASE_URL"
echo "Batch ID: $BATCH_ID"
echo "============================================"
echo ""

# Test /process endpoint with strategize operation
echo "1. Test /process with strategize operation"
echo "-------------------------------------------"

STRATEGIZE_PROCESS_PAYLOAD=$(cat <<EOF
{
  "batch_id": "$BATCH_ID",
  "chunk_id": "${CHUNK_ID}-strategize",
  "r2_prefix": "staging/test-batch/",
  "operation": "strategize",
  "strategize": {
    "directory_path": "/test/large-collection",
    "files": [
      {
        "name": "letter-001.txt",
        "type": "text",
        "content": "Dear Alice, Writing from camp..."
      },
      {
        "name": "letter-002.txt",
        "type": "text",
        "content": "Dear Father, The journey was long..."
      },
      {
        "name": "invoice-001.txt",
        "type": "text",
        "content": "INVOICE #123 - Supplies..."
      }
    ],
    "total_file_count": 100,
    "chunk_count": 2
  }
}
EOF
)

echo "Dispatching strategize request..."
RESULT=$(echo "$STRATEGIZE_PROCESS_PAYLOAD" | curl -s -X POST "$BASE_URL/process" \
  -H "Content-Type: application/json" \
  -d @-)

echo "$RESULT" | jq '.'
echo ""

# Check status
echo "Checking DO status..."
sleep 2

STATUS=$(curl -s "$BASE_URL/status/$BATCH_ID/${CHUNK_ID}-strategize")
echo "$STATUS" | jq '.'
echo ""

# Poll until done or timeout
echo "Polling for completion (max 60 seconds)..."
for i in {1..30}; do
  STATUS=$(curl -s "$BASE_URL/status/$BATCH_ID/${CHUNK_ID}-strategize")
  PHASE=$(echo "$STATUS" | jq -r '.phase // "unknown"')
  echo "  Attempt $i: Phase = $PHASE"

  if [ "$PHASE" == "DONE" ] || [ "$PHASE" == "ERROR" ] || [ "$PHASE" == "CALLBACK" ]; then
    echo ""
    echo "Final Status:"
    echo "$STATUS" | jq '.'
    break
  fi

  sleep 2
done

echo ""
echo "============================================"
echo "2. Test /process with organize operation"
echo "============================================"
echo ""

# Use a fake PI and tip for testing
# In real usage, these would come from the orchestrator

ORGANIZE_PROCESS_PAYLOAD=$(cat <<EOF
{
  "batch_id": "$BATCH_ID",
  "chunk_id": "${CHUNK_ID}-organize",
  "r2_prefix": "staging/test-batch/",
  "operation": "organize",
  "pis": [
    {
      "pi": "01TESTPI00000000000000001",
      "current_tip": "bafybeifaketip000000000000001",
      "directory_path": "/test/documents",
      "files": [
        {
          "name": "letter-1895-june.txt",
          "type": "text",
          "content": "Company B Seventh Regiment\nNew York, June 26, 1895.\n\nDear Alice,\n\nI thought I would drop you a line before my candle goes out..."
        },
        {
          "name": "letter-1895-july.txt",
          "type": "text",
          "content": "Company B Seventh Regiment\nNew York, July 15, 1895.\n\nDear Alice,\n\nCamp life continues to be strenuous..."
        },
        {
          "name": "invoice-supplies.txt",
          "type": "text",
          "content": "INVOICE #4521\nDate: June 30, 1895\n\n10x Uniform buttons - $2.00\n5x Leather belts - $7.50..."
        },
        {
          "name": "invoice-provisions.txt",
          "type": "text",
          "content": "INVOICE #4589\nDate: July 10, 1895\n\n50 lbs hardtack - $5.00\n20 lbs salt pork - $8.00..."
        }
      ],
      "parent_components": {
        "letter-1895-june.txt": "bafkreifakecomp1",
        "letter-1895-july.txt": "bafkreifakecomp2",
        "invoice-supplies.txt": "bafkreifakecomp3",
        "invoice-provisions.txt": "bafkreifakecomp4"
      }
    }
  ]
}
EOF
)

echo "Dispatching organize request..."
echo "(Note: This will fail at PUBLISHING phase since PIs are fake)"
RESULT=$(echo "$ORGANIZE_PROCESS_PAYLOAD" | curl -s -X POST "$BASE_URL/process" \
  -H "Content-Type: application/json" \
  -d @-)

echo "$RESULT" | jq '.'
echo ""

# Check status
echo "Checking DO status..."
sleep 2

STATUS=$(curl -s "$BASE_URL/status/$BATCH_ID/${CHUNK_ID}-organize")
echo "$STATUS" | jq '.'
echo ""

# Poll until done or timeout
echo "Polling for completion (max 60 seconds)..."
for i in {1..30}; do
  STATUS=$(curl -s "$BASE_URL/status/$BATCH_ID/${CHUNK_ID}-organize")
  PHASE=$(echo "$STATUS" | jq -r '.phase // "unknown"')
  echo "  Attempt $i: Phase = $PHASE"

  if [ "$PHASE" == "DONE" ] || [ "$PHASE" == "ERROR" ] || [ "$PHASE" == "CALLBACK" ] || [ "$PHASE" == "PUBLISHING" ]; then
    echo ""
    echo "Final Status:"
    echo "$STATUS" | jq '.'
    break
  fi

  sleep 2
done

echo ""
echo "============================================"
echo "Async Tests Complete"
echo "============================================"
echo ""
echo "Note: The organize test will show ERROR or incomplete status"
echo "because the fake PIs can't be resolved. In production, with"
echo "real PIs and service bindings, this would complete successfully."

#!/bin/bash
# Full integration test for organizer service with real IPFS operations
# Creates a test entity, reorganizes it, and verifies the structure

set -e

IPFS_API="https://api.arke.institute"
ORGANIZER_API="https://organizer.arke.institute"
BATCH_ID="integration-test-$(date +%s)"
CHUNK_ID="chunk-001"

echo "============================================"
echo "Full Integration Test - Organizer Service"
echo "============================================"
echo "IPFS API: $IPFS_API"
echo "Organizer API: $ORGANIZER_API"
echo "Batch ID: $BATCH_ID"
echo ""

# Step 1: Create test files and upload to IPFS
echo "Step 1: Creating and uploading test files to IPFS"
echo "---------------------------------------------------"

# Create temp files
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

cat > "$TEMP_DIR/letter-1895-june.txt" << 'EOF'
Company B Seventh Regiment
National Guard S.N.Y.
New York, June 26, 1895.

Dear Alice,

I thought I would drop you a line before my candle goes out and "Taps" sounded. We have to work so hard during the day that even the freight owls are very glad to turn in. We are up at 4:30 and our first drill is at 5 and the last one at 8 so the day is pretty well filled.

Your loving brother,
John
EOF

cat > "$TEMP_DIR/letter-1895-july.txt" << 'EOF'
Company B Seventh Regiment
National Guard S.N.Y.
New York, July 15, 1895.

Dear Alice,

Camp life continues to be strenuous but rewarding. The men are in good spirits despite the heat. We had a parade yesterday that went splendidly. The Colonel was most pleased with our performance.

Your brother,
John
EOF

cat > "$TEMP_DIR/invoice-supplies-1895.txt" << 'EOF'
INVOICE #4521
Date: June 30, 1895

To: Company B, Seventh Regiment
From: Smith & Sons Military Suppliers

10x Uniform buttons - $2.00
5x Leather belts - $7.50
20x Brass buckles - $4.00

Total: $13.50

Payment due: July 30, 1895
EOF

cat > "$TEMP_DIR/invoice-provisions-1895.txt" << 'EOF'
INVOICE #4589
Date: July 10, 1895

To: Company B, Seventh Regiment
From: Johnson Provisions Co.

50 lbs hardtack - $5.00
20 lbs salt pork - $8.00
100 lbs beans - $6.00
50 lbs coffee - $15.00

Total: $34.00

Payment due: August 10, 1895
EOF

cat > "$TEMP_DIR/roster-1895.txt" << 'EOF'
COMPANY B ROSTER
Seventh Regiment, National Guard of New York
June 1895

Captain: William H. Robertson
First Lieutenant: Charles E. Smith
Second Lieutenant: John P. Davis

Sergeants:
- Michael O'Brien
- Thomas Kelly
- James Murphy

Corporals:
- Patrick Ryan
- Daniel Sullivan
- William Brown

Privates: 45 men enlisted
EOF

# Upload files to IPFS one by one
echo "Uploading files to IPFS..."

echo "  Uploading letter-1895-june.txt..."
CID_LETTER_JUNE=$(curl -s -X POST "$IPFS_API/upload" -F "file=@$TEMP_DIR/letter-1895-june.txt" | jq -r '.[0].cid')
echo "    CID: $CID_LETTER_JUNE"

echo "  Uploading letter-1895-july.txt..."
CID_LETTER_JULY=$(curl -s -X POST "$IPFS_API/upload" -F "file=@$TEMP_DIR/letter-1895-july.txt" | jq -r '.[0].cid')
echo "    CID: $CID_LETTER_JULY"

echo "  Uploading invoice-supplies-1895.txt..."
CID_INVOICE_SUPPLIES=$(curl -s -X POST "$IPFS_API/upload" -F "file=@$TEMP_DIR/invoice-supplies-1895.txt" | jq -r '.[0].cid')
echo "    CID: $CID_INVOICE_SUPPLIES"

echo "  Uploading invoice-provisions-1895.txt..."
CID_INVOICE_PROVISIONS=$(curl -s -X POST "$IPFS_API/upload" -F "file=@$TEMP_DIR/invoice-provisions-1895.txt" | jq -r '.[0].cid')
echo "    CID: $CID_INVOICE_PROVISIONS"

echo "  Uploading roster-1895.txt..."
CID_ROSTER=$(curl -s -X POST "$IPFS_API/upload" -F "file=@$TEMP_DIR/roster-1895.txt" | jq -r '.[0].cid')
echo "    CID: $CID_ROSTER"

echo ""
echo "All files uploaded successfully!"
echo ""

# Step 2: Create parent entity with all files
echo "Step 2: Creating parent entity with files"
echo "------------------------------------------"

CREATE_ENTITY_PAYLOAD=$(cat << EOF
{
  "type": "PI",
  "components": {
    "letter-1895-june.txt": "$CID_LETTER_JUNE",
    "letter-1895-july.txt": "$CID_LETTER_JULY",
    "invoice-supplies-1895.txt": "$CID_INVOICE_SUPPLIES",
    "invoice-provisions-1895.txt": "$CID_INVOICE_PROVISIONS",
    "roster-1895.txt": "$CID_ROSTER"
  },
  "children_pi": [],
  "note": "Test entity for organizer integration test"
}
EOF
)

echo "Creating entity..."
CREATE_RESULT=$(echo "$CREATE_ENTITY_PAYLOAD" | curl -s -X POST "$IPFS_API/entities" \
  -H "Content-Type: application/json" \
  -d @-)

echo "$CREATE_RESULT" | jq '.'

PARENT_PI=$(echo "$CREATE_RESULT" | jq -r '.pi')
PARENT_TIP=$(echo "$CREATE_RESULT" | jq -r '.tip')
PARENT_VER=$(echo "$CREATE_RESULT" | jq -r '.ver')

echo ""
echo "Created parent entity:"
echo "  PI:  $PARENT_PI"
echo "  TIP: $PARENT_TIP"
echo "  VER: $PARENT_VER"
echo ""

# Step 3: Dispatch organize request to DO
echo "Step 3: Dispatching organize request to DO"
echo "-------------------------------------------"

PROCESS_PAYLOAD=$(cat << EOF
{
  "batch_id": "$BATCH_ID",
  "chunk_id": "$CHUNK_ID",
  "r2_prefix": "staging/test/",
  "operation": "organize",
  "pis": [
    {
      "pi": "$PARENT_PI",
      "current_tip": "$PARENT_TIP",
      "directory_path": "/test/company-b-documents",
      "files": [
        {
          "name": "letter-1895-june.txt",
          "type": "text",
          "content": "Company B Seventh Regiment\nNational Guard S.N.Y.\nNew York, June 26, 1895.\n\nDear Alice,\n\nI thought I would drop you a line before my candle goes out and \"Taps\" sounded. We have to work so hard during the day that even the freight owls are very glad to turn in. We are up at 4:30 and our first drill is at 5 and the last one at 8 so the day is pretty well filled.\n\nYour loving brother,\nJohn"
        },
        {
          "name": "letter-1895-july.txt",
          "type": "text",
          "content": "Company B Seventh Regiment\nNational Guard S.N.Y.\nNew York, July 15, 1895.\n\nDear Alice,\n\nCamp life continues to be strenuous but rewarding. The men are in good spirits despite the heat. We had a parade yesterday that went splendidly. The Colonel was most pleased with our performance.\n\nYour brother,\nJohn"
        },
        {
          "name": "invoice-supplies-1895.txt",
          "type": "text",
          "content": "INVOICE #4521\nDate: June 30, 1895\n\nTo: Company B, Seventh Regiment\nFrom: Smith & Sons Military Suppliers\n\n10x Uniform buttons - $2.00\n5x Leather belts - $7.50\n20x Brass buckles - $4.00\n\nTotal: $13.50\n\nPayment due: July 30, 1895"
        },
        {
          "name": "invoice-provisions-1895.txt",
          "type": "text",
          "content": "INVOICE #4589\nDate: July 10, 1895\n\nTo: Company B, Seventh Regiment\nFrom: Johnson Provisions Co.\n\n50 lbs hardtack - $5.00\n20 lbs salt pork - $8.00\n100 lbs beans - $6.00\n50 lbs coffee - $15.00\n\nTotal: $34.00\n\nPayment due: August 10, 1895"
        },
        {
          "name": "roster-1895.txt",
          "type": "text",
          "content": "COMPANY B ROSTER\nSeventh Regiment, National Guard of New York\nJune 1895\n\nCaptain: William H. Robertson\nFirst Lieutenant: Charles E. Smith\nSecond Lieutenant: John P. Davis\n\nSergeants:\n- Michael O'Brien\n- Thomas Kelly\n- James Murphy\n\nCorporals:\n- Patrick Ryan\n- Daniel Sullivan\n- William Brown\n\nPrivates: 45 men enlisted"
        }
      ],
      "parent_components": {
        "letter-1895-june.txt": "$CID_LETTER_JUNE",
        "letter-1895-july.txt": "$CID_LETTER_JULY",
        "invoice-supplies-1895.txt": "$CID_INVOICE_SUPPLIES",
        "invoice-provisions-1895.txt": "$CID_INVOICE_PROVISIONS",
        "roster-1895.txt": "$CID_ROSTER"
      }
    }
  ]
}
EOF
)

echo "Dispatching organize request..."
DISPATCH_RESULT=$(echo "$PROCESS_PAYLOAD" | curl -s -X POST "$ORGANIZER_API/process" \
  -H "Content-Type: application/json" \
  -d @-)

echo "$DISPATCH_RESULT" | jq '.'
echo ""

# Step 4: Poll for completion
echo "Step 4: Polling for completion"
echo "-------------------------------"

MAX_ATTEMPTS=60
ATTEMPT=0

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
  ATTEMPT=$((ATTEMPT + 1))

  STATUS=$(curl -s "$ORGANIZER_API/status/$BATCH_ID/$CHUNK_ID")
  PHASE=$(echo "$STATUS" | jq -r '.phase // "unknown"')

  echo "  Attempt $ATTEMPT/$MAX_ATTEMPTS: Phase = $PHASE"

  if [ "$PHASE" == "DONE" ]; then
    echo ""
    echo "✅ Processing complete!"
    echo ""
    echo "Final Status:"
    echo "$STATUS" | jq '.'
    break
  elif [ "$PHASE" == "ERROR" ]; then
    echo ""
    echo "❌ Processing failed!"
    echo ""
    echo "Error Status:"
    echo "$STATUS" | jq '.'
    exit 1
  fi

  sleep 2
done

if [ $ATTEMPT -ge $MAX_ATTEMPTS ]; then
  echo ""
  echo "⚠️ Timeout waiting for completion"
  echo "Last status:"
  curl -s "$ORGANIZER_API/status/$BATCH_ID/$CHUNK_ID" | jq '.'
fi

echo ""

# Step 5: Verify entity structure
echo "Step 5: Verifying entity structure"
echo "-----------------------------------"

echo "Fetching updated parent entity..."
PARENT_ENTITY=$(curl -s "$IPFS_API/entities/$PARENT_PI")
echo ""
echo "Parent Entity (after reorganization):"
echo "$PARENT_ENTITY" | jq '.'

# Get children
CHILDREN=$(echo "$PARENT_ENTITY" | jq -r '.children_pi[]?' 2>/dev/null)

if [ -n "$CHILDREN" ]; then
  echo ""
  echo "Child entities created:"
  for CHILD_PI in $CHILDREN; do
    echo ""
    echo "--- Child: $CHILD_PI ---"
    curl -s "$IPFS_API/entities/$CHILD_PI" | jq '{
      pi: .pi,
      ver: .ver,
      note: .note,
      parent_pi: .parent_pi,
      components: (.components | keys),
      children_count: (.children_pi | length)
    }'
  done
else
  echo ""
  echo "No children created (check if groups were formed)"
fi

echo ""
echo "============================================"
echo "Integration Test Complete"
echo "============================================"
echo ""
echo "Summary:"
echo "  Parent PI: $PARENT_PI"
echo "  Original files: 5"
echo "  Children created: $(echo "$PARENT_ENTITY" | jq '.children_pi | length')"
echo "  Parent components remaining: $(echo "$PARENT_ENTITY" | jq '.components | keys | length')"
echo ""

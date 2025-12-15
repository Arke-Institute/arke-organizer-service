#!/bin/bash
# Create a test from Moby Dick chapters for reorganization testing
# Downloads the book, extracts ~50 chapter excerpts, uploads to IPFS

set -e

IPFS_API="https://api.arke.institute"
ORGANIZER_API="https://organizer.arke.institute"
WORK_DIR=$(mktemp -d)
trap "rm -rf $WORK_DIR" EXIT

echo "============================================"
echo "Moby Dick Reorganization Test"
echo "Work dir: $WORK_DIR"
echo "============================================"

# Step 1: Download Moby Dick
echo ""
echo "Step 1: Downloading Moby Dick..."
curl -s "https://www.gutenberg.org/cache/epub/2701/pg2701.txt" > "$WORK_DIR/moby_dick.txt"
TOTAL_LINES=$(wc -l < "$WORK_DIR/moby_dick.txt")
echo "Downloaded $TOTAL_LINES lines"

# Step 2: Extract first ~50 chapters (excerpts - first 1000 chars each)
echo ""
echo "Step 2: Extracting chapter excerpts..."
mkdir -p "$WORK_DIR/chapters"

# Extract chapters using awk
awk '
BEGIN { chapter_num = 0; in_chapter = 0; char_count = 0; max_chars = 1500 }
/^CHAPTER [0-9]+/ {
  if (chapter_num > 0 && chapter_num <= 50) {
    close(outfile)
  }
  chapter_num++
  if (chapter_num > 50) exit
  char_count = 0
  in_chapter = 1
  outfile = sprintf("'"$WORK_DIR/chapters"'/chapter_%02d.txt", chapter_num)
}
in_chapter && chapter_num <= 50 {
  if (char_count < max_chars) {
    print >> outfile
    char_count += length($0) + 1
  }
}
' "$WORK_DIR/moby_dick.txt"

CHAPTER_COUNT=$(ls "$WORK_DIR/chapters" 2>/dev/null | wc -l | tr -d ' ')
echo "Extracted $CHAPTER_COUNT chapter excerpts"

# Step 3: Upload each chapter to IPFS and build arrays
echo ""
echo "Step 3: Uploading chapters to IPFS..."

# Arrays to store data
declare -a FILENAMES
declare -a CIDS
declare -a CONTENTS

idx=0
for chapter_file in "$WORK_DIR/chapters"/*.txt; do
  filename=$(basename "$chapter_file")

  # Upload to IPFS
  upload_result=$(curl -s -X POST "$IPFS_API/upload" -F "file=@$chapter_file")
  cid=$(echo "$upload_result" | jq -r '.[0].cid')

  # Read content for organize request
  content=$(cat "$chapter_file" | jq -Rs '.')

  FILENAMES[$idx]="$filename"
  CIDS[$idx]="$cid"
  CONTENTS[$idx]="$content"

  echo "  Uploaded $filename -> $cid"
  idx=$((idx + 1))
done

echo ""
echo "Uploaded $idx files"

# Step 4: Build components JSON for entity creation
echo ""
echo "Step 4: Creating parent entity..."

COMPONENTS_JSON="{"
for i in "${!FILENAMES[@]}"; do
  if [ $i -gt 0 ]; then
    COMPONENTS_JSON+=","
  fi
  COMPONENTS_JSON+="\"${FILENAMES[$i]}\":\"${CIDS[$i]}\""
done
COMPONENTS_JSON+="}"

CREATE_RESULT=$(curl -s -X POST "$IPFS_API/entities" \
  -H "Content-Type: application/json" \
  -d "{
    \"type\": \"PI\",
    \"components\": $COMPONENTS_JSON,
    \"children_pi\": [],
    \"note\": \"Moby Dick test - 50 shuffled chapters for reorganization\"
  }")

echo "$CREATE_RESULT" | jq '.'

PARENT_PI=$(echo "$CREATE_RESULT" | jq -r '.pi')
PARENT_TIP=$(echo "$CREATE_RESULT" | jq -r '.tip')

# Step 5: Build files array for organize request
echo ""
echo "Step 5: Building organize request..."

FILES_JSON="["
for i in "${!FILENAMES[@]}"; do
  if [ $i -gt 0 ]; then
    FILES_JSON+=","
  fi
  FILES_JSON+="{\"name\":\"${FILENAMES[$i]}\",\"type\":\"text\",\"content\":${CONTENTS[$i]}}"
done
FILES_JSON+="]"

# Build parent_components
PARENT_COMPONENTS_JSON="{"
for i in "${!FILENAMES[@]}"; do
  if [ $i -gt 0 ]; then
    PARENT_COMPONENTS_JSON+=","
  fi
  PARENT_COMPONENTS_JSON+="\"${FILENAMES[$i]}\":\"${CIDS[$i]}\""
done
PARENT_COMPONENTS_JSON+="}"

BATCH_ID="moby-dick-$(date +%s)"

# Step 6: Dispatch organize request
echo ""
echo "Step 6: Dispatching organize request..."
echo "Batch ID: $BATCH_ID"
echo "Parent PI: $PARENT_PI"

PROCESS_PAYLOAD=$(cat << ENDOFPAYLOAD
{
  "batch_id": "$BATCH_ID",
  "chunk_id": "chunk-001",
  "r2_prefix": "staging/moby-test/",
  "operation": "organize",
  "pis": [{
    "pi": "$PARENT_PI",
    "current_tip": "$PARENT_TIP",
    "directory_path": "/moby-dick-collection",
    "files": $FILES_JSON,
    "parent_components": $PARENT_COMPONENTS_JSON
  }]
}
ENDOFPAYLOAD
)

# Save payload for debugging
echo "$PROCESS_PAYLOAD" > "$WORK_DIR/../moby-payload.json"

DISPATCH_RESULT=$(echo "$PROCESS_PAYLOAD" | curl -s -X POST "$ORGANIZER_API/process" \
  -H "Content-Type: application/json" \
  -d @-)

echo "$DISPATCH_RESULT" | jq '.'

# Step 7: Poll for completion
echo ""
echo "Step 7: Polling for completion..."

for i in {1..60}; do
  STATUS=$(curl -s "$ORGANIZER_API/status/$BATCH_ID/chunk-001")
  PHASE=$(echo "$STATUS" | jq -r '.phase // "unknown"')

  echo "  Attempt $i: Phase = $PHASE"

  if [ "$PHASE" == "DONE" ] || [ "$PHASE" == "ERROR" ]; then
    echo ""
    echo "Final Status:"
    echo "$STATUS" | jq '.'
    break
  fi

  if [ "$PHASE" == "not_found" ]; then
    echo "  (DO cleaned up)"
    break
  fi

  sleep 3
done

# Step 8: Check results
echo ""
echo "Step 8: Checking reorganized entity..."
echo ""

ENTITY=$(curl -s "$IPFS_API/entities/$PARENT_PI")
echo "Parent Entity:"
echo "$ENTITY" | jq '{
  pi: .pi,
  ver: .ver,
  note: .note,
  components: (.components | keys | length),
  children: (.children_pi | length)
}'

CHILDREN=$(echo "$ENTITY" | jq -r '.children_pi[]?' 2>/dev/null)
if [ -n "$CHILDREN" ]; then
  echo ""
  echo "Child Entities (Groups):"
  for child in $CHILDREN; do
    echo ""
    curl -s "$IPFS_API/entities/$child" | jq '{
      pi: .pi,
      note: .note,
      files: (.components | keys)
    }'
  done
fi

echo ""
echo "============================================"
echo "Test Complete"
echo "============================================"
echo "Parent PI: $PARENT_PI"
echo "Batch ID: $BATCH_ID"

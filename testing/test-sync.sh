#!/bin/bash
# Test the synchronous endpoints of the organizer service

set -e

BASE_URL="${ORGANIZER_URL:-http://localhost:8787}"

echo "============================================"
echo "Organizer Service Sync Endpoint Tests"
echo "Base URL: $BASE_URL"
echo "============================================"
echo ""

# Health check
echo "1. Health Check"
echo "---------------"
curl -s "$BASE_URL/health" | jq '.'
echo ""

# Test /organize endpoint
echo "2. Test /organize Endpoint"
echo "--------------------------"

ORGANIZE_PAYLOAD=$(cat <<'EOF'
{
  "directory_path": "/test/letters-collection",
  "files": [
    {
      "name": "letter-1895-june.txt",
      "type": "text",
      "content": "Company B Seventh Regiment\nNational Guard S.N.Y.\nNew York, June 26, 1895.\n\nDear Alice,\n\nI thought I would drop you a line before my candle goes out and \"Taps\" sounded. We have to work so hard during the day that even the freight owls are very glad to turn in. We are up at 4:30 and our first drill is at 5 and the last one at 8 so the day is pretty well filled.\n\nYour loving brother,\nJohn"
    },
    {
      "name": "letter-1895-july.txt",
      "type": "text",
      "content": "Company B Seventh Regiment\nNational Guard S.N.Y.\nNew York, July 15, 1895.\n\nDear Alice,\n\nCamp life continues to be strenuous but rewarding. The men are in good spirits despite the heat. We had a parade yesterday that went splendidly.\n\nYour brother,\nJohn"
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
      "content": "COMPANY B ROSTER\nSeventh Regiment, National Guard of New York\nJune 1895\n\nCaptain: William H. Robertson\nFirst Lieutenant: Charles E. Smith\nSecond Lieutenant: John P. Davis\n\nSergeants:\n- Michael O'Brien\n- Thomas Kelly\n- James Murphy\n\nCorporals:\n- Patrick Ryan\n- Daniel Sullivan\n- William Brown\n\nPrivates: [list of 45 names follows]"
    },
    {
      "name": "group-photo.jpg.ref.json",
      "type": "ref",
      "content": "Black and white photograph of Company B soldiers in formation, dated June 1895. Approximately 60 men in uniform standing in three rows.",
      "original_filename": "group-photo.jpg",
      "metadata": { "mime_type": "image/jpeg", "size": 245000 }
    },
    {
      "name": "camp-scene.jpg.ref.json",
      "type": "ref",
      "content": "Photograph showing tents and camp life at the training grounds. Several soldiers visible in casual poses near cooking fires.",
      "original_filename": "camp-scene.jpg",
      "metadata": { "mime_type": "image/jpeg", "size": 198000 }
    }
  ]
}
EOF
)

echo "Sending organize request..."
echo "$ORGANIZE_PAYLOAD" | jq -c '.' | curl -s -X POST "$BASE_URL/organize" \
  -H "Content-Type: application/json" \
  -d @- | jq '.'

echo ""
echo "============================================"
echo "Tests Complete"
echo "============================================"

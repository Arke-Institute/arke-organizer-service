#!/bin/bash
# Test the strategize endpoint of the organizer service

set -e

BASE_URL="${ORGANIZER_URL:-http://localhost:8787}"

echo "============================================"
echo "Organizer Service Strategize Endpoint Test"
echo "Base URL: $BASE_URL"
echo "============================================"
echo ""

# Test /strategize endpoint
echo "Testing /strategize Endpoint"
echo "----------------------------"
echo "Simulating a large directory with 500 files being split into 5 chunks..."
echo ""

STRATEGIZE_PAYLOAD=$(cat <<'EOF'
{
  "directory_path": "/large-collection/civil-war-documents",
  "files": [
    {
      "name": "letter-1861-001.txt",
      "type": "text",
      "content": "Camp near Washington, April 15, 1861.\n\nDear Father,\n\nWe arrived at the capital yesterday after a long journey. The city is in a state of great excitement following the news from Fort Sumter. Men are enlisting by the thousands and there is a spirit of determination everywhere..."
    },
    {
      "name": "letter-1861-052.txt",
      "type": "text",
      "content": "Camp near Bull Run, July 18, 1861.\n\nDear Mother,\n\nWe expect a battle any day now. The Confederate forces are massed across the creek and our scouts report their numbers are substantial. The men are in good spirits despite the heat and uncertainty..."
    },
    {
      "name": "letter-1862-108.txt",
      "type": "text",
      "content": "Camp near Fredericksburg, December 10, 1862.\n\nDear Sister,\n\nThe weather has turned bitterly cold and we are preparing for what promises to be a difficult winter. Supplies are scarce but morale remains high..."
    },
    {
      "name": "medical-record-1862-005.txt",
      "type": "text",
      "content": "FIELD HOSPITAL RECORD\nPatient: Pvt. James Wilson, Company C\nDate: September 17, 1862\nDiagnosis: Gunshot wound to left arm\nTreatment: Amputation above elbow\nPrognosis: Expected to survive, unfit for further service"
    },
    {
      "name": "muster-roll-1861-april.txt",
      "type": "text",
      "content": "MUSTER ROLL - 5th Regiment New York Volunteers\nApril 1861\n\nCompany A: 98 men present\nCompany B: 95 men present\nCompany C: 97 men present\n[continues for 10 companies]"
    },
    {
      "name": "supply-requisition-1862.txt",
      "type": "text",
      "content": "REQUISITION FOR SUPPLIES\nFrom: 5th Regiment NY Volunteers\nTo: Quartermaster General\nDate: March 1, 1862\n\n500 blankets\n300 pairs boots\n200 uniform coats\n1000 rounds ammunition"
    },
    {
      "name": "battle-map-antietam.jpg.ref.json",
      "type": "ref",
      "content": "Hand-drawn battlefield map showing troop positions at Antietam Creek, September 17, 1862. Shows Confederate and Union lines, key terrain features, and direction of major attacks.",
      "original_filename": "battle-map-antietam.jpg"
    },
    {
      "name": "photo-camp-1862.jpg.ref.json",
      "type": "ref",
      "content": "Photograph of soldiers at winter camp, 1862. Shows log cabins and cooking areas. Several officers visible in foreground.",
      "original_filename": "photo-camp-1862.jpg"
    },
    {
      "name": "general-orders-15.txt",
      "type": "text",
      "content": "GENERAL ORDERS NO. 15\nHeadquarters, Army of the Potomac\nMarch 8, 1862\n\nI. All regiments will prepare for movement at dawn on March 10th.\nII. Three days rations to be carried by each man.\nIII. Baggage wagons limited to essential supplies only."
    },
    {
      "name": "court-martial-record-1863.txt",
      "type": "text",
      "content": "COURT MARTIAL PROCEEDINGS\nIn the matter of: Pvt. Thomas Brown, Company D\nCharge: Desertion\nDate: February 15, 1863\nVerdict: Guilty\nSentence: Dishonorable discharge and 2 years hard labor"
    }
  ],
  "total_file_count": 500,
  "chunk_count": 5
}
EOF
)

echo "Sending strategize request..."
RESULT=$(echo "$STRATEGIZE_PAYLOAD" | jq -c '.' | curl -s -X POST "$BASE_URL/strategize" \
  -H "Content-Type: application/json" \
  -d @-)

echo "$RESULT" | jq '.'

echo ""
echo "============================================"
echo "Strategize Analysis Results"
echo "============================================"

SHOULD_COORDINATE=$(echo "$RESULT" | jq -r '.should_coordinate // "error"')
GUIDANCE=$(echo "$RESULT" | jq -r '.guidance // "none"')
REASONING=$(echo "$RESULT" | jq -r '.reasoning // "none"')

echo ""
echo "Should Coordinate: $SHOULD_COORDINATE"
echo ""
echo "Strategy Guidance:"
echo "$GUIDANCE"
echo ""
echo "Reasoning:"
echo "$REASONING"
echo ""

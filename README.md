# Organizer Service

LLM-powered file organization service that analyzes directory contents and groups files into logical collections using DeepSeek-V3.

## Overview

The Organizer Service is called during the REORGANIZATION phase of the Arke pipeline (after OCR, before PINAX). It analyzes files in a directory and intelligently groups them into multi-dimensional collections, enabling rich discovery experiences.

## Features

- **Multi-dimensional organization**: Creates both chronological AND thematic groups
- **Intelligent overlap**: Files can appear in multiple groups when content genuinely spans contexts
- **IPFS-friendly**: Duplicate references have zero storage cost (same CID)
- **Structured output**: Guaranteed valid JSON via DeepSeek-V3's json_schema format
- **Comprehensive validation**: Filesystem-safe group names, complete file accounting

## API Specification

### Endpoint

```
POST /organize
Content-Type: application/json
```

### Request

```typescript
{
  "directory_path": "/faculty-senate-archive",
  "files": [
    {
      "name": "page-001.pdf.ref.json",
      "type": "ref",
      "content": "FACULTY SENATE MEETING\\nJanuary 15, 1972...",
      "original_filename": "page-001.pdf",
      "metadata": {
        "mime_type": "application/pdf",
        "size": 52341
      }
    },
    {
      "name": "meeting-notes.md",
      "type": "text",
      "content": "# Meeting Notes\\n\\nThese are supplementary notes..."
    }
  ]
}
```

### Response

```typescript
{
  "groups": [
    {
      "group_name": "1972-meetings",
      "description": "Faculty Senate meetings from 1972",
      "files": ["page-001.pdf.ref.json", "meeting-notes.md"]
    },
    {
      "group_name": "budget-discussions",
      "description": "Budget and financial discussions",
      "files": ["page-001.pdf.ref.json"]
    }
  ],
  "ungrouped_files": [],
  "reorganization_description": "Files organized into chronological and thematic groups...",
  "model": "deepseek-ai/DeepSeek-V3",
  "tokens": {
    "prompt": 5200,
    "completion": 850,
    "total": 6050
  },
  "cost_usd": 0.0027
}
```

## Configuration

### Model: DeepSeek-V3
- **Pricing**: $0.38/$0.89 per 1M tokens (input/output)
- **Max tokens**: 8192
- **Temperature**: 0.3 (balanced consistency)
- **Structured output**: json_schema for guaranteed valid JSON

### Prompt Strategy: "Softened"
Allows natural overlap when files genuinely span multiple contexts:
- Meeting minutes appear in both chronological AND thematic groups
- Users can browse by time OR topic
- No storage penalty (IPFS deduplication via CID)

## Performance

| Directory Size | Cost | Latency | Expected Groups |
|---------------|------|---------|-----------------|
| 10 files | $0.0006 | 5-10s | 2-5 |
| 30 files | $0.0027 | 10-15s | 5-11 |
| 79 files | $0.0035 | 15-30s | 13-20 |
| 200 files | ~$0.018 | 20-60s | 15-30 |

## Development

### Install Dependencies
```bash
npm install
```

### Local Development
```bash
npm run dev
```
Runs on `http://localhost:8787`

### Build
```bash
npm run build
```

### Deploy
```bash
npm run deploy
wrangler secret put DEEPINFRA_API_KEY
```

## Testing

Test with curl:
```bash
curl -X POST http://localhost:8787/organize \
  -H "Content-Type: application/json" \
  -d '{
    "directory_path": "/test-dir",
    "files": [
      {
        "name": "test.txt",
        "type": "text",
        "content": "Test content"
      }
    ]
  }'
```

## Validation Rules

The service validates:
1. **All files accounted for**: Every file in request must appear in groups OR ungrouped_files
2. **Valid filenames**: All filenames in response must match request
3. **Filesystem-safe names**: No `/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|` in group names
4. **Non-empty groups**: Each group must contain at least 1 file
5. **Overlap allowed**: Files CAN appear in multiple groups

## Error Responses

- **400 Bad Request**: Invalid request format, validation errors
- **413 Payload Too Large**: Request exceeds 10MB limit
- **500 Internal Server Error**: Model failure, processing error
- **503 Service Unavailable**: Model overloaded, rate limited

## Integration

Called by arke-orchestrator during REORGANIZATION phase:
1. After: OCR extraction completes
2. Before: PINAX metadata extraction
3. Controlled by: `processing_config.reorganize` flag

Results in new directory entities with shared CIDs (no re-upload).

## Project Structure

```
organizer-service/
├── src/
│   ├── index.ts          # Entry point & routing (/organize endpoint)
│   ├── types.ts          # TypeScript types from API spec
│   ├── service.ts        # Main business logic with structured output
│   ├── llm.ts           # DeepInfra client with DeepSeek-V3 pricing
│   ├── prompts.ts       # Softened prompt strategy
│   └── validation.ts    # Request/response validation
├── wrangler.jsonc        # Cloudflare Worker config
├── package.json          # Dependencies
└── README.md            # This file
```

## See Also

- [Organizer Service API Specification.md](./Organizer%20Service%20API%20Specification.md) - Full API spec
- [test-reorganize/](./test-reorganize/) - Testing & validation results
- [template-service/](./template-service/) - Service template

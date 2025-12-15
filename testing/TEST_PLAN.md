# Organizer Service Test Plan

## Overview

This document outlines the testing strategy for the organizer service, covering both the legacy sync endpoints and the new async DO pattern.

## Test Phases

### Phase 1: Sync Endpoint Testing (Verify LLM Integration)

Test the synchronous endpoints first to ensure the core LLM functionality works.

1. **POST /organize** - Test file organization
   - Input: Sample files with content
   - Expected: Groups and ungrouped files returned

2. **POST /strategize** - Test strategy analysis
   - Input: Sample files for a large directory
   - Expected: Strategy guidance returned

### Phase 2: Async DO Pattern Testing

Test the new Durable Object based async pattern.

1. **POST /process** with `operation: 'organize'`
   - Dispatches work to DO
   - Returns `{ status: 'accepted', chunk_id: '...' }`

2. **POST /process** with `operation: 'strategize'`
   - Dispatches strategize work to DO
   - Returns `{ status: 'accepted', chunk_id: '...' }`

3. **GET /status/:batchId/:chunkId**
   - Check DO status
   - Should show phase progression

### Phase 3: Integration Testing

Test with real PIs from api.arke.institute:
- Fetch entity components
- Build realistic test data
- Verify entity creation works

## Test Data

### Sample Files for Organize

```json
{
  "files": [
    { "name": "letter-1895.txt", "type": "text", "content": "Company B Seventh Regiment..." },
    { "name": "letter-1896.txt", "type": "text", "content": "Dear Alice, I am writing..." },
    { "name": "invoice-1895.txt", "type": "text", "content": "Invoice #123..." },
    { "name": "invoice-1896.txt", "type": "text", "content": "Invoice #456..." },
    { "name": "photo-album.jpg.ref.json", "type": "ref", "content": "Photo of regiment..." }
  ]
}
```

### Expected Groups

The LLM should create groups like:
- "Correspondence" (letters)
- "Financial Records" (invoices)
- Ungrouped: photos

## Running Tests

```bash
# Start local dev server
cd ai-services/organizer-service
npm run dev

# In another terminal, run tests
./testing/test-sync.sh
./testing/test-async.sh
```

## Environment Variables Required

```
DEEPINFRA_API_KEY=<your-key>
DEEPINFRA_BASE_URL=https://api.deepinfra.com/v1/openai
MODEL_NAME=deepseek-ai/DeepSeek-V3
```

# Organizer Service Batch Size Analysis

## Problem Statement

At scale (500 files), the organizer service was experiencing:
- **File omissions**: LLM not including all files in the response
- **File hallucinations**: LLM making up filenames that weren't in the request
- **Poor organization quality**: Severely truncated content leading to bad grouping decisions

## Root Cause

The service was sending ALL files in a single LLM call, which causes:
1. **Token budget pressure**: Even with progressive truncation, metadata for 500 files uses significant tokens
2. **Cognitive overload**: LLM struggles to track and output 100+ filenames accurately
3. **Instruction following degradation**: At large scale, the LLM fails to account for every file

## Test Results

### Successful Batch Sizes (✅ No hallucinations, no omissions)
- **10 files**: ✅ PASS - 0 missing, 0 hallucinated (1.7k tokens, $0.0009)
- **20 files**: ✅ PASS - 0 missing, 0 hallucinated (2.8k tokens, $0.0014)
- **30 files**: ✅ PASS - 0 missing, 0 hallucinated (3.8k tokens, $0.0018)
- **50 files**: ✅ PASS - 0 missing, 0 hallucinated (5.9k tokens, $0.0028)
- **75 files**: ✅ PASS - 0 missing, 0 hallucinated (8.5k tokens, $0.0039)
- **100 files**: ✅ PASS - 0 missing, 0 hallucinated (11k tokens, $0.0051)

### Failed Batch Sizes (❌ Files missing or hallucinated)
- **150 files**: ❌ FAIL - 20+ files missing (omitted by LLM)
- **200 files**: ❌ FAIL - 2+ files missing

## Breaking Point

**The LLM reliably handles up to 100 files, but fails at 150+ files.**

## Recommendation

### Production Batch Size: **50 files per batch**

**Why 50?**
- ✅ **Safe margin**: Well below the 100-file breaking point
- ✅ **Verified reliable**: 100% success rate in testing
- ✅ **Good token efficiency**: ~6k tokens per batch
- ✅ **Reasonable cost**: ~$0.003 per batch
- ✅ **Predictable performance**: Consistent results

### For 500 files:
- **10 batches** of 50 files each
- Total cost: ~$0.03 (vs ~$0.01 for single batch, but with reliability)
- Processing time: ~10-20 seconds per batch (2-3 minutes total with delays)

## Implementation Strategy

### Option 1: Client-Side Batching (Recommended)
The client splits files into batches of 50 and calls the service multiple times.

**Pros:**
- No service changes needed
- Client controls batching strategy
- Easier to implement retry logic

**Cons:**
- Client must merge results
- More network round trips

### Option 2: Server-Side Batching
The service accepts large requests and internally batches them.

**Pros:**
- Transparent to client
- Service handles result merging
- Single API call

**Cons:**
- More complex server logic
- Longer response times
- Harder to implement well

## Configuration Changes

Current settings in `wrangler.jsonc`:
```jsonc
"MAX_TOKENS": 128000,
"TOKEN_BUDGET_PERCENTAGE": 0.3  // 30% = 38,400 tokens for prompt
```

These settings work well for batches up to 50-100 files. No changes needed if batching is implemented.

## Validation

The service already has robust validation in `src/validation.ts:88-91` that checks:
- ✅ All request files are present in response
- ✅ No extra files were added (hallucinations)
- ✅ No duplicate files in groups

This validation correctly catches the failures at 150+ files.

## Next Steps

1. **Decide on batching approach**: Client-side vs server-side
2. **Implement batching logic** for 500-file directories
3. **Add batch progress tracking** (if server-side)
4. **Update documentation** with batch size recommendations
5. **Consider adding batch size as API parameter** (optional: let caller specify batch size with default of 50)

## Test Scripts

Two test scripts are available:
- `test-batch-sizes.ts`: Tests 10, 20, 30, 50, 75, 100 files
- `test-large-batch-sizes.ts`: Tests 150, 200, 300, 400, 500 files

Run with: `npx tsx test-batch-sizes.ts [port]`

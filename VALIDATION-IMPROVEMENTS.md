# Validation Improvements - Graceful Error Handling

## Overview

Updated the Organizer Service to handle AI response errors gracefully instead of throwing hard 500 errors. The service now automatically sanitizes invalid responses and returns warnings to the orchestrator.

## Problem Statement

The AI occasionally returned directory paths (e.g., `posts/`) instead of file names, causing the validation to throw a 500 Internal Server Error:

```json
{
  "error": "Internal Server Error",
  "message": "Response contains files not in request: posts/",
  "timestamp": "2025-11-13T05:07:21.060Z"
}
```

This crashed the entire request even though the issue was recoverable.

## Solution

Implemented a two-pronged approach:

### 1. Enhanced AI Prompt (Prevention)

Updated `src/prompts.ts` to explicitly instruct the AI not to return directory paths:

```
8. **CRITICAL: Only return EXACT filenames from the list above. NEVER return directory paths (e.g., "posts/", "images/") - only return individual file names.**
```

This instruction appears in both the user-facing prompt and the static instructions template.

### 2. Graceful Validation (Recovery)

Completely rewrote `src/validation.ts` to automatically detect and correct common AI errors:

**Before:**
- Hard error when extra files found
- Request failed with 500 status
- No recovery possible

**After:**
- Automatically detect directory paths (filenames ending with `/`)
- Filter out invalid entries
- Remove empty groups after sanitization
- Return warnings instead of throwing errors
- Continue processing with sanitized data

## API Changes

### New Response Field: `validation_warnings`

The response now includes an optional `validation_warnings` array:

```typescript
interface OrganizeResponse {
  groups: OrganizeGroup[];
  ungrouped_files: string[];
  reorganization_description: string;
  model: string;
  tokens?: { prompt: number; completion: number; total: number };
  cost_usd?: number;
  truncation?: TruncationMetadata;
  validation_warnings?: string[];  // ← NEW FIELD
}
```

### Example Response with Warnings

```json
{
  "groups": [
    {
      "group_name": "Meeting Notes",
      "description": "Faculty meeting notes and minutes",
      "files": ["meeting-2024-01.pdf", "meeting-2024-02.pdf"]
    }
  ],
  "ungrouped_files": [],
  "reorganization_description": "Files organized by content type",
  "model": "deepseek-ai/DeepSeek-V3",
  "tokens": {
    "prompt": 5200,
    "completion": 850,
    "total": 6050
  },
  "cost_usd": 0.0027,
  "validation_warnings": [
    "Directory path \"posts/\" found in group \"Posts\" - directories are not valid file entries and have been removed",
    "Response contains files not in request: extra-file.txt - these have been removed"
  ]
}
```

## Validation Result Type

Created a new `ValidationResult` interface (exported from `src/validation.ts`):

```typescript
export interface ValidationResult {
  warnings: string[];
  sanitizedResponse: OrganizeStructuredOutput;
}
```

This allows the validation function to return both the corrected response and any warnings generated during sanitization.

## Automatic Corrections

The service now automatically handles these issues:

### 1. Directory Paths
**Issue**: AI returns `posts/` instead of file names
**Detection**: Filenames ending with `/`
**Action**: Remove from groups/ungrouped_files
**Warning**: `Directory path "posts/" found in group "Posts" - directories are not valid file entries and have been removed`

### 2. Extra Files
**Issue**: AI returns files not in the original request
**Detection**: Files in response not in request file list
**Action**: Filter out from groups/ungrouped_files
**Warning**: `Response contains files not in request: extra.txt - these have been removed`

### 3. Empty Groups
**Issue**: Group becomes empty after removing invalid entries
**Detection**: Group has 0 files after sanitization
**Action**: Exclude entire group from response
**Warning**: `Group "Posts" was empty after removing directory paths and has been excluded`

## Hard Errors (Still Rejected)

The following validation errors still throw and reject the request:

1. **Missing required fields**: `groups`, `ungrouped_files`, `reorganization_description`
2. **Files not accounted for**: Request file missing from response (after sanitization)
3. **Invalid group names**: Filesystem-unsafe characters in group_name
4. **Empty groups**: Groups with 0 files in original response (before sanitization)

## Implementation Details

### Files Modified

1. **`src/types.ts`**
   - Added `validation_warnings?: string[]` to `OrganizeResponse`

2. **`src/validation.ts`**
   - Changed `validateResponse()` return type from `void` to `ValidationResult`
   - Added `ValidationResult` interface
   - Added directory path detection logic
   - Added automatic sanitization of groups and ungrouped_files
   - Warnings collected instead of throwing for recoverable issues

3. **`src/service.ts`**
   - Updated to use `ValidationResult` instead of void
   - Logs warnings to console for observability
   - Includes warnings in response when present

4. **`src/prompts.ts`**
   - Added instruction #8 warning against directory paths
   - Applied to both user prompt and static instructions

5. **`README.md`**
   - Updated response example to show `validation_warnings`
   - Added response field documentation
   - Updated validation rules section with hard errors vs automatic corrections

## Orchestrator Integration

### Handling Warnings

The orchestrator should check for `validation_warnings` in the response:

```typescript
const response = await organizerService.organize(request);

if (response.validation_warnings && response.validation_warnings.length > 0) {
  // Log warnings for observability
  console.warn('[Organizer Warnings]', response.validation_warnings);

  // Optionally track metrics
  metrics.increment('organizer.validation_warnings', response.validation_warnings.length);

  // Continue processing - response has been sanitized
}

// Process response.groups normally
```

### Logging

The organizer service logs warnings to console:

```
[Validation Warnings] [
  'Directory path "posts/" found in group "Posts" - directories are not valid file entries and have been removed'
]
```

The orchestrator can forward these to its logging system for debugging.

### Error Handling

The orchestrator should distinguish between:

1. **Successful response with warnings** (200 status)
   - Process the sanitized groups normally
   - Log warnings for debugging
   - Continue pipeline

2. **Hard validation errors** (500 status)
   - Stop processing
   - Log error
   - Retry or fail the request

## Benefits

1. **Resilience**: Service handles AI errors gracefully instead of crashing
2. **Observability**: Warnings provide visibility into what was corrected
3. **Debuggability**: Clear messages explain what was removed and why
4. **Continuity**: Pipeline continues instead of failing on minor issues
5. **Safety**: Hard errors still thrown for unrecoverable issues

## Testing

The implementation compiles and builds successfully:

```bash
$ npm run build
> organizer-service@1.0.0 build
> tsc
```

To test the new behavior, send a request with a known issue (or manually edit the LLM response in the code to inject `posts/`) and verify:

1. Response returns 200 status
2. `validation_warnings` array contains appropriate messages
3. Directory paths/extra files are filtered from `groups` and `ungrouped_files`
4. Console shows `[Validation Warnings]` log

## Migration Notes

### For Orchestrator Developers

**No breaking changes** - the `validation_warnings` field is optional. Existing code will continue to work.

**Recommended updates:**
1. Add warning logging to track when sanitization occurs
2. Consider adding metrics/monitoring for validation warnings
3. Update error handling to distinguish warnings from errors

**Example:**

```typescript
// Before (still works)
const response = await organizerService.organize(request);
processGroups(response.groups);

// After (recommended)
const response = await organizerService.organize(request);

if (response.validation_warnings?.length) {
  logger.warn('Organizer sanitized response', {
    warnings: response.validation_warnings
  });
  metrics.increment('organizer.warnings.count');
}

processGroups(response.groups);
```

## Future Improvements

Potential enhancements:

1. **Warning Types**: Structure warnings with types (e.g., `{ type: 'directory_path', file: 'posts/', group: 'Posts' }`)
2. **Metrics**: Track warning frequency to identify prompt improvement opportunities
3. **Auto-correction**: More sophisticated recovery (e.g., inferring correct filenames from directory paths)
4. **Validation Modes**: Strict mode (throw on any issue) vs lenient mode (current behavior)

## Summary

The service now handles AI response errors gracefully:
- ✅ Directory paths automatically removed
- ✅ Extra files automatically filtered
- ✅ Empty groups automatically excluded
- ✅ Warnings returned to orchestrator
- ✅ Processing continues successfully
- ✅ Full observability via logs and warnings
- ✅ No breaking changes to API

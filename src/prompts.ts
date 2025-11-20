/**
 * Prompt generation for Organizer Service
 * Based on the "softened" prompt strategy from test-reorganize
 */

import type { OrganizeRequest, OrganizeFileInput, Env, TruncationMetadata } from './types';
import { estimateTokens, truncateToTokenBudget } from './utils/token-utils';
import { applyProgressiveTax, type TaxableItem } from './utils/progressive-tax';

// Store the last truncation stats globally for access by service layer
let lastTruncationStats: TruncationMetadata | undefined;

/**
 * Get the truncation stats from the last prompt generation
 * Used by the service layer to include in the response
 */
export function getLastTruncationStats(): TruncationMetadata | undefined {
  return lastTruncationStats;
}

/**
 * Generate the system prompt
 * Sets the role and behavior of the LLM for file organization
 */
export function generateSystemPrompt(customPrompt?: string): string {
  let prompt = `You are an expert at organizing and categorizing documents. You think carefully about organizational strategies and can identify patterns across multiple files.`;

  if (customPrompt) {
    prompt += `\n\nADDITIONAL INSTRUCTIONS:\n${customPrompt}`;
  }

  return prompt;
}

/**
 * Generate the user prompt from request data
 * Uses the proven "softened" prompt strategy that allows natural overlap
 * Applies progressive tax truncation to fit within token budget
 */
export function generateUserPrompt(request: OrganizeRequest, env: Env): string {
  const filesList = formatFilesList(request.files, env, request.custom_prompt);

  return `You are organizing a directory of files into logical groups. The directory "${request.directory_path}" contains the following files:

${filesList}

Your task is to create meaningful organizational groups that best represent the content.

INSTRUCTIONS:
1. Analyze the files and identify natural patterns (dates, topics, content types, events, etc.)
2. Determine the organizational strategy that creates logical, coherent groups
3. Assign files to groups based on their content
4. If a file contains content that genuinely belongs to multiple groups (e.g., a page with content from two different meetings), include it in both groups
5. For files without content (binary/ref files with no OCR), use the filename and metadata to infer which group it belongs to
6. Prefer clear, distinct groups over meta-categories
7. **EVERY file listed above MUST be accounted for** - either placed in a group or listed in ungrouped_files. If content is truncated or unclear, use the filename to infer the category.
8. **CRITICAL: Only return EXACT filenames from the list above. NEVER return directory paths (e.g., "posts/", "images/") - only return individual file names.**

IMPORTANT CONSTRAINTS:
- Avoid creating meta-groups that duplicate files unnecessarily (e.g., "all images" when images already belong to thematic groups)
- Each group should be meaningfully distinct from others
- Overlap is acceptable when a file's content truly spans multiple contexts
- Prioritize accurate representation of content over artificial single-group assignment

Provide your response as:
- "groups": An array of groups, each with:
  - "group_name": A clear, descriptive name for this group (must be filesystem-safe: no /, \\, :, *, ?, ", <, >, |)
  - "description": Why these files belong together (what makes this a logical grouping)
  - "files": Array of filenames in this group
- "ungrouped_files": Array of filenames that don't fit into any logical group
- "reorganization_description": Overall description of the organizational strategy you chose

The response will be automatically formatted as structured JSON.`;

}

/**
 * Format the files list for the prompt
 * Handles both text and ref file types with their metadata
 * Applies progressive tax truncation to fit within token budget
 */
function formatFilesList(files: OrganizeFileInput[], env: Env, customPrompt?: string): string {
  // Calculate static prompt overhead
  const systemPrompt = generateSystemPrompt(customPrompt);
  const staticInstructions = `You are organizing a directory of files into logical groups. The directory "" contains the following files:

Your task is to create meaningful organizational groups that best represent the content.

INSTRUCTIONS:
1. Analyze the files and identify natural patterns (dates, topics, content types, events, etc.)
2. Determine the organizational strategy that creates logical, coherent groups
3. Assign files to groups based on their content
4. If a file contains content that genuinely belongs to multiple groups (e.g., a page with content from two different meetings), include it in both groups
5. For files without content (binary/ref files with no OCR), use the filename and metadata to infer which group it belongs to
6. Prefer clear, distinct groups over meta-categories
7. **EVERY file listed above MUST be accounted for** - either placed in a group or listed in ungrouped_files. If content is truncated or unclear, use the filename to infer the category.
8. **CRITICAL: Only return EXACT filenames from the list above. NEVER return directory paths (e.g., "posts/", "images/") - only return individual file names.**

IMPORTANT CONSTRAINTS:
- Avoid creating meta-groups that duplicate files unnecessarily (e.g., "all images" when images already belong to thematic groups)
- Each group should be meaningfully distinct from others
- Overlap is acceptable when a file's content truly spans multiple contexts
- Prioritize accurate representation of content over artificial single-group assignment

Provide your response as:
- "groups": An array of groups, each with:
  - "group_name": A clear, descriptive name for this group (must be filesystem-safe: no /, \\, :, *, ?, ", <, >, |)
  - "description": Why these files belong together (what makes this a logical grouping)
  - "files": Array of filenames in this group
- "ungrouped_files": Array of filenames that don't fit into any logical group
- "reorganization_description": Overall description of the organizational strategy you chose

The response will be automatically formatted as structured JSON.`;

  const staticTokens = estimateTokens(systemPrompt + staticInstructions);

  // Calculate available budget for file content
  const maxTokens = env.MAX_TOKENS || 8192;
  const tokenBudgetPercentage = env.TOKEN_BUDGET_PERCENTAGE || 0.7; // Default: 70% of max tokens for safety
  const totalBudget = Math.floor(maxTokens * tokenBudgetPercentage);
  const availableForContent = totalBudget - staticTokens;

  // Build metadata for each file (doesn't get truncated)
  const fileMetadata = files.map(file => {
    let metadata = `File: ${file.name} (${file.type})`;

    if (file.type === 'ref' && file.original_filename) {
      metadata += `\nOriginal: ${file.original_filename}`;
    }

    if (file.metadata) {
      if (file.metadata.mime_type) {
        metadata += `\nType: ${file.metadata.mime_type}`;
      }
      if (file.metadata.size) {
        metadata += `\nSize: ${formatBytes(file.metadata.size)}`;
      }
    }

    return { file, metadata };
  });

  // Calculate metadata tokens (never truncated)
  const metadataTokens = fileMetadata.reduce(
    (sum, { metadata }) => sum + estimateTokens(metadata),
    0
  );

  // Calculate separator tokens
  const separator = '\n\n---\n\n';
  const separatorTokens = estimateTokens(separator) * (files.length - 1);

  // Available budget for actual file content
  const contentBudget = Math.max(0, availableForContent - metadataTokens - separatorTokens);

  // Prepare items for progressive tax algorithm
  const taxableItems: TaxableItem[] = files
    .map((file, index) => {
      const content = file.content?.trim() || '';
      if (content.length === 0) {
        return null; // Skip files without content
      }

      return {
        name: index.toString(), // Use index as identifier
        tokens: estimateTokens(content),
      };
    })
    .filter((item): item is TaxableItem => item !== null);

  // Apply progressive tax truncation if needed
  let allocations: Map<string, number> = new Map();
  if (taxableItems.length > 0 && contentBudget > 0) {
    const result = applyProgressiveTax(taxableItems, contentBudget);
    allocations = new Map(result.items.map(item => [item.name, item.allocatedTokens]));

    // Store truncation stats for observability
    if (result.stats.deficit > 0) {
      lastTruncationStats = {
        applied: true,
        total_original_tokens: result.stats.totalOriginalTokens,
        target_tokens: result.stats.targetTokens,
        deficit: result.stats.deficit,
        protection_mode_used: result.stats.protectionModeUsed,
        protected_files: result.stats.protectedCount,
        truncated_files: result.stats.truncatedCount,
      };

      // Log truncation stats
      console.log('[Progressive Tax Truncation]', lastTruncationStats);
    } else {
      // No truncation needed
      lastTruncationStats = {
        applied: false,
        total_original_tokens: result.stats.totalOriginalTokens,
        target_tokens: result.stats.targetTokens,
        deficit: 0,
        protection_mode_used: false,
        protected_files: 0,
        truncated_files: 0,
      };
    }
  } else {
    // No content to truncate or no budget
    lastTruncationStats = undefined;
  }

  // Format files with allocated token budgets
  return fileMetadata.map(({ file, metadata }, index) => {
    let formatted = metadata;

    const content = file.content?.trim() || '';
    if (content.length > 0) {
      // Get allocated token budget for this file
      const allocatedTokens = allocations.get(index.toString()) || 0;

      // Truncate content to fit budget
      const truncatedContent = truncateToTokenBudget(content, allocatedTokens);
      formatted += `\nContent:\n${truncatedContent}`;
    } else if (file.type === 'ref') {
      formatted += `\n(No OCR text available - use filename/metadata for grouping)`;
    }

    return formatted;
  }).join(separator);
}

/**
 * Helper: Format bytes as human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

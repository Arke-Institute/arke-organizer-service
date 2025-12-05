/**
 * Prompt generation for Strategize endpoint
 * Analyzes a sample of files to determine a consistent organization strategy
 */

import type { StrategizeRequest, OrganizeFileInput, Env, TruncationMetadata } from './types';
import { estimateTokens, truncateToTokenBudget } from './utils/token-utils';
import { applyProgressiveTax, type TaxableItem } from './utils/progressive-tax';

// Store the last truncation stats globally for access by service layer
let lastTruncationStats: TruncationMetadata | undefined;

/**
 * Get the truncation stats from the last prompt generation
 */
export function getLastStrategizeTruncationStats(): TruncationMetadata | undefined {
  return lastTruncationStats;
}

/**
 * Generate the system prompt for strategize
 */
export function generateStrategizeSystemPrompt(customPrompt?: string): string {
  let prompt = `You analyze document collections and recommend organizational strategies. Your goal is to identify patterns that can guide consistent organization across multiple processing chunks.`;

  if (customPrompt) {
    prompt += `\n\nADDITIONAL CONTEXT:\n${customPrompt}`;
  }

  return prompt;
}

/**
 * Generate the user prompt for strategize
 */
export function generateStrategizeUserPrompt(request: StrategizeRequest, env: Env): string {
  const filesList = formatFilesListForStrategy(request.files, env, request.custom_prompt);

  return `This directory will be split into ${request.chunk_count} chunks for processing.

DIRECTORY: "${request.directory_path}"
TOTAL FILES: ${request.total_file_count}

Here's a representative sample from across the directory:

${filesList}

YOUR TASK: Decide if these chunks should follow a CONSISTENT organization strategy.

If the files share a clear pattern (dates, types, topics, projects, etc.), write guidance that all chunks should follow. Be specific about what groups to create.

If the collection is too varied for a single approach, say so - each chunk can decide independently.

EXAMPLES of good guidance:
- "Organize by year. Create groups for each year found (2018, 2019, 2020, etc). Put undated files in 'undated'."
- "Organize by document type. Use groups: reports, correspondence, invoices, images, other."
- "Organize by project name extracted from filenames or content. Each distinct project gets its own group."
- "Organize by source/author. Group files by their origin or creator."
- "Collection is too varied for a single strategy - let each chunk organize independently based on its contents."

DECISION CRITERIA:
1. Look for ANY useful pattern across the sample - even if not perfect
2. If 50%+ of files could benefit from a shared organizational approach, recommend that strategy
3. Prefer coordination over independence - a consistent (if imperfect) strategy is better than fragmented chunk decisions
4. Only set should_coordinate to false if files are TRULY random with no discernible pattern
5. Good strategies typically create 3-10 meaningful groups, but 2-15 is acceptable

Respond with:
- "should_coordinate": true if chunks should follow unified guidance, false if too varied
- "guidance": Your organizational instructions (be specific about group names when possible)
- "reasoning": Brief explanation of what patterns you observed`;
}

/**
 * Format the files list for the strategize prompt
 * Uses the same progressive tax truncation as organize
 */
function formatFilesListForStrategy(
  files: OrganizeFileInput[],
  env: Env,
  customPrompt?: string
): string {
  // Calculate static prompt overhead
  const systemPrompt = generateStrategizeSystemPrompt(customPrompt);
  const staticInstructionsEstimate = 1500; // Approximate tokens for the static parts of user prompt

  const staticTokens = estimateTokens(systemPrompt) + staticInstructionsEstimate;

  // Calculate available budget for file content
  const maxTokens = env.MAX_TOKENS || 8192;
  const tokenBudgetPercentage = env.TOKEN_BUDGET_PERCENTAGE || 0.7;
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
        return null;
      }

      return {
        name: index.toString(),
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

      console.log('[Strategize Progressive Tax Truncation]', lastTruncationStats);
    } else {
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
    lastTruncationStats = undefined;
  }

  // Format files with allocated token budgets
  return fileMetadata.map(({ file, metadata }, index) => {
    let formatted = metadata;

    const content = file.content?.trim() || '';
    if (content.length > 0) {
      const allocatedTokens = allocations.get(index.toString()) || 0;
      const truncatedContent = truncateToTokenBudget(content, allocatedTokens);
      formatted += `\nContent:\n${truncatedContent}`;
    } else if (file.type === 'ref') {
      formatted += `\n(No OCR text available - use filename/metadata for pattern analysis)`;
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

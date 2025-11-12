/**
 * Token estimation and truncation utilities
 *
 * Uses the standard approximation of 1 token ≈ 4 characters for token estimation.
 */

/**
 * Estimates the number of tokens in a text string.
 * Uses the approximation: 1 token ≈ 4 characters
 *
 * @param text - The text to estimate tokens for
 * @returns Estimated number of tokens
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Truncates text to fit within a specified token budget.
 * Adds a "[truncated]" marker if truncation occurs.
 *
 * @param text - The text to truncate
 * @param tokenBudget - Maximum number of tokens allowed
 * @returns Truncated text that fits within the token budget
 */
export function truncateToTokenBudget(text: string, tokenBudget: number): string {
  const estimatedTokens = estimateTokens(text);

  // If already under budget, return as-is
  if (estimatedTokens <= tokenBudget) {
    return text;
  }

  // Convert token budget to character limit
  // Reserve tokens for the truncation marker
  const truncationMarker = '\n... [truncated]';
  const markerTokens = estimateTokens(truncationMarker);
  const availableTokens = Math.max(0, tokenBudget - markerTokens);
  const maxChars = availableTokens * 4;

  // Truncate and add marker
  return text.slice(0, maxChars) + truncationMarker;
}

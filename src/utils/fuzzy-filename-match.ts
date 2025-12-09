/**
 * Fuzzy Filename Matching Utility
 *
 * Handles LLM variations in filenames through progressive matching:
 * 1. Exact match
 * 2. Normalized match (lowercase, strip extensions, collapse whitespace)
 * 3. Prefix match (LLM output is prefix of normalized original)
 * 4. Token overlap (Jaccard similarity >= 70%)
 */

export type MatchConfidence = 'exact' | 'normalized' | 'prefix' | 'token' | null;

export interface MatchResult {
  match: string | null;
  confidence: MatchConfidence;
}

/**
 * Normalize a filename for comparison
 * - Lowercase
 * - Strip .ref.json and common image extensions
 * - Collapse multiple spaces to single space
 * - Trim whitespace
 */
export function normalizeFilename(filename: string): string {
  return filename
    .toLowerCase()
    // Strip .ref.json extension first
    .replace(/\.ref\.json$/i, '')
    // Strip common image extensions
    .replace(/\.(jpg|jpeg|png|gif|tiff|tif|bmp|webp)$/i, '')
    // Collapse multiple whitespace to single space
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tokenize a filename into a set of meaningful tokens
 * Splits on spaces, underscores, hyphens, and periods
 */
export function tokenizeFilename(filename: string): Set<string> {
  const normalized = normalizeFilename(filename);
  const tokens = normalized
    .split(/[\s_\-\.]+/)
    .map(t => t.toLowerCase())
    .filter(t => t.length > 0);
  return new Set(tokens);
}

/**
 * Calculate Jaccard similarity between two sets
 * Returns a value between 0 and 1
 */
export function calculateJaccardSimilarity(set1: Set<string>, set2: Set<string>): number {
  if (set1.size === 0 && set2.size === 0) return 1;
  if (set1.size === 0 || set2.size === 0) return 0;

  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);

  return intersection.size / union.size;
}

/**
 * Find the best matching original filename for an LLM-returned filename
 * Uses progressive matching strategy with decreasing confidence
 */
export function findBestMatch(
  llmFilename: string,
  originalFilenames: string[]
): MatchResult {
  // 1. Exact match (fastest path)
  if (originalFilenames.includes(llmFilename)) {
    return { match: llmFilename, confidence: 'exact' };
  }

  const normalizedLlm = normalizeFilename(llmFilename);
  const llmTokens = tokenizeFilename(llmFilename);

  // Pre-compute normalized versions and tokens for all originals
  const originalData = originalFilenames.map(original => ({
    original,
    normalized: normalizeFilename(original),
    tokens: tokenizeFilename(original),
  }));

  // 2. Normalized exact match
  for (const data of originalData) {
    if (normalizedLlm === data.normalized) {
      return { match: data.original, confidence: 'normalized' };
    }
  }

  // 3. Prefix match (LLM output is prefix of original, min 60% length)
  const MIN_PREFIX_RATIO = 0.6;
  for (const data of originalData) {
    if (data.normalized.startsWith(normalizedLlm)) {
      const ratio = normalizedLlm.length / data.normalized.length;
      if (ratio >= MIN_PREFIX_RATIO) {
        return { match: data.original, confidence: 'prefix' };
      }
    }
    // Also check reverse: original is prefix of LLM (LLM added something)
    if (normalizedLlm.startsWith(data.normalized)) {
      const ratio = data.normalized.length / normalizedLlm.length;
      if (ratio >= MIN_PREFIX_RATIO) {
        return { match: data.original, confidence: 'prefix' };
      }
    }
  }

  // 4. Token overlap (Jaccard similarity >= 70%)
  const MIN_TOKEN_SIMILARITY = 0.7;
  let bestTokenMatch: { original: string; similarity: number } | null = null;

  for (const data of originalData) {
    const similarity = calculateJaccardSimilarity(llmTokens, data.tokens);
    if (similarity >= MIN_TOKEN_SIMILARITY) {
      if (!bestTokenMatch || similarity > bestTokenMatch.similarity) {
        bestTokenMatch = { original: data.original, similarity };
      }
    }
  }

  if (bestTokenMatch) {
    return { match: bestTokenMatch.original, confidence: 'token' };
  }

  // 5. No match found
  return { match: null, confidence: null };
}

/**
 * Build a lookup structure for efficient matching of multiple filenames
 * Returns a function that can be called repeatedly for each LLM filename
 */
export function buildFilenameMatcher(originalFilenames: string[]): (llmFilename: string) => MatchResult {
  // Pre-compute data once
  const originalSet = new Set(originalFilenames);
  const originalData = originalFilenames.map(original => ({
    original,
    normalized: normalizeFilename(original),
    tokens: tokenizeFilename(original),
  }));

  // Build normalized lookup map
  const normalizedToOriginal = new Map<string, string>();
  for (const data of originalData) {
    // Only keep first occurrence for each normalized name
    if (!normalizedToOriginal.has(data.normalized)) {
      normalizedToOriginal.set(data.normalized, data.original);
    }
  }

  return (llmFilename: string): MatchResult => {
    // 1. Exact match
    if (originalSet.has(llmFilename)) {
      return { match: llmFilename, confidence: 'exact' };
    }

    const normalizedLlm = normalizeFilename(llmFilename);

    // 2. Normalized exact match
    const normalizedMatch = normalizedToOriginal.get(normalizedLlm);
    if (normalizedMatch) {
      return { match: normalizedMatch, confidence: 'normalized' };
    }

    // 3. Prefix match
    const MIN_PREFIX_RATIO = 0.6;
    for (const data of originalData) {
      if (data.normalized.startsWith(normalizedLlm)) {
        const ratio = normalizedLlm.length / data.normalized.length;
        if (ratio >= MIN_PREFIX_RATIO) {
          return { match: data.original, confidence: 'prefix' };
        }
      }
      if (normalizedLlm.startsWith(data.normalized)) {
        const ratio = data.normalized.length / normalizedLlm.length;
        if (ratio >= MIN_PREFIX_RATIO) {
          return { match: data.original, confidence: 'prefix' };
        }
      }
    }

    // 4. Token overlap
    const llmTokens = tokenizeFilename(llmFilename);
    const MIN_TOKEN_SIMILARITY = 0.7;
    let bestTokenMatch: { original: string; similarity: number } | null = null;

    for (const data of originalData) {
      const similarity = calculateJaccardSimilarity(llmTokens, data.tokens);
      if (similarity >= MIN_TOKEN_SIMILARITY) {
        if (!bestTokenMatch || similarity > bestTokenMatch.similarity) {
          bestTokenMatch = { original: data.original, similarity };
        }
      }
    }

    if (bestTokenMatch) {
      return { match: bestTokenMatch.original, confidence: 'token' };
    }

    // 5. No match
    return { match: null, confidence: null };
  };
}

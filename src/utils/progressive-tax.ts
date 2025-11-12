/**
 * Progressive Tax Truncation Algorithm
 *
 * A fair algorithm for distributing token truncation across multiple items.
 * Protects small items while proportionally reducing large items to fit within a target budget.
 *
 * Based on: PROGRESSIVE-TAX-ALGORITHM.md
 */

export interface TaxableItem {
  /** Unique identifier for the item */
  name: string;
  /** Current token count for this item */
  tokens: number;
}

export interface TaxResult {
  /** Item identifier */
  name: string;
  /** Original token count */
  originalTokens: number;
  /** Allocated tokens after truncation */
  allocatedTokens: number;
  /** Whether this item was protected (below average threshold) */
  wasProtected: boolean;
}

export interface TruncationStats {
  /** Total tokens before truncation */
  totalOriginalTokens: number;
  /** Target token budget */
  targetTokens: number;
  /** Token deficit that needed to be cut */
  deficit: number;
  /** Whether protection mode was used (vs fallback mode) */
  protectionModeUsed: boolean;
  /** Number of items that were protected */
  protectedCount: number;
  /** Number of items that were truncated */
  truncatedCount: number;
}

export interface ProgressiveTaxResult {
  /** Per-item allocation results */
  items: TaxResult[];
  /** Overall statistics about the truncation */
  stats: TruncationStats;
}

/**
 * Applies the Progressive Tax Truncation Algorithm to distribute token cuts fairly.
 *
 * Algorithm Steps:
 * 1. Calculate the deficit (total tokens - target)
 * 2. Calculate average tax per item (deficit / item count)
 * 3. Split items into below-average (protected) and above-average groups
 * 4. Check if protection is feasible (protected items <= target budget)
 * 5a. If feasible: Tax only above-average items proportionally (Protection Mode)
 * 5b. If not feasible: Tax all items proportionally (Fallback Mode)
 *
 * @param items - Array of items with name and token count
 * @param targetTokens - Target token budget to fit within
 * @returns Allocation results with per-item budgets and statistics
 */
export function applyProgressiveTax(
  items: TaxableItem[],
  targetTokens: number
): ProgressiveTaxResult {
  // Step 1: Calculate deficit
  const totalTokens = items.reduce((sum, item) => sum + item.tokens, 0);
  const deficit = totalTokens - targetTokens;

  // If already under budget, return items unchanged
  if (deficit <= 0) {
    return {
      items: items.map((item) => ({
        name: item.name,
        originalTokens: item.tokens,
        allocatedTokens: item.tokens,
        wasProtected: false,
      })),
      stats: {
        totalOriginalTokens: totalTokens,
        targetTokens,
        deficit: 0,
        protectionModeUsed: false,
        protectedCount: 0,
        truncatedCount: 0,
      },
    };
  }

  // Step 2: Calculate average tax per item
  const averageTax = deficit / items.length;

  // Step 3: Split items into below-average and above-average groups
  const belowAverage = items.filter((item) => item.tokens < averageTax);
  const aboveAverage = items.filter((item) => item.tokens >= averageTax);

  // Step 4: Check if protection is feasible
  const totalBelow = belowAverage.reduce((sum, item) => sum + item.tokens, 0);

  let protectionModeUsed: boolean;
  let results: TaxResult[];

  if (totalBelow > targetTokens) {
    // Protection NOT feasible - everyone pays proportionally (Fallback Mode)
    protectionModeUsed = false;
    results = items.map((item) => {
      const proportion = item.tokens / totalTokens;
      const tax = proportion * deficit;
      const allocatedTokens = Math.max(0, item.tokens - tax);

      return {
        name: item.name,
        originalTokens: item.tokens,
        allocatedTokens,
        wasProtected: false,
      };
    });
  } else {
    // Protection IS feasible - tax only above-average items (Protection Mode)
    protectionModeUsed = true;
    const totalAbove = aboveAverage.reduce((sum, item) => sum + item.tokens, 0);

    // Map for quick lookup
    const itemMap = new Map(items.map((item) => [item.name, item]));

    // Tax above-average items proportionally
    const aboveResults = aboveAverage.map((item) => {
      const proportion = totalAbove > 0 ? item.tokens / totalAbove : 0;
      const tax = proportion * deficit;
      const allocatedTokens = Math.max(0, item.tokens - tax);

      return {
        name: item.name,
        originalTokens: item.tokens,
        allocatedTokens,
        wasProtected: false,
      };
    });

    // Below-average items keep everything
    const belowResults = belowAverage.map((item) => ({
      name: item.name,
      originalTokens: item.tokens,
      allocatedTokens: item.tokens,
      wasProtected: true,
    }));

    results = [...aboveResults, ...belowResults];
  }

  // Calculate statistics
  const protectedCount = results.filter((r) => r.wasProtected).length;
  const truncatedCount = results.filter((r) => r.allocatedTokens < r.originalTokens).length;

  return {
    items: results,
    stats: {
      totalOriginalTokens: totalTokens,
      targetTokens,
      deficit,
      protectionModeUsed,
      protectedCount,
      truncatedCount,
    },
  };
}

/**
 * Convenience function to get just the token allocations as a map.
 *
 * @param items - Array of items with name and token count
 * @param targetTokens - Target token budget to fit within
 * @returns Map of item name to allocated token count
 */
export function getAllocations(
  items: TaxableItem[],
  targetTokens: number
): Map<string, number> {
  const result = applyProgressiveTax(items, targetTokens);
  return new Map(result.items.map((item) => [item.name, item.allocatedTokens]));
}

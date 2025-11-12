/**
 * Unit tests for Progressive Tax Truncation Algorithm
 *
 * Tests all examples from PROGRESSIVE-TAX-ALGORITHM.md
 */

import { describe, it, expect } from 'vitest';
import { applyProgressiveTax, type TaxableItem } from '../src/utils/progressive-tax';

describe('Progressive Tax Truncation Algorithm', () => {
  describe('Example 1: One Giant File', () => {
    it('should protect small files and tax only the giant file', () => {
      const items: TaxableItem[] = [
        { name: 'file1', tokens: 1000 },
        { name: 'file2', tokens: 1000 },
        { name: 'file3', tokens: 10000 },
        { name: 'file4', tokens: 300000 },
      ];
      const targetTokens = 100000;

      const result = applyProgressiveTax(items, targetTokens);

      // Verify total matches target
      const totalAllocated = result.items.reduce((sum, item) => sum + item.allocatedTokens, 0);
      expect(totalAllocated).toBeCloseTo(targetTokens, 0);

      // Find specific items
      const file1 = result.items.find((i) => i.name === 'file1');
      const file2 = result.items.find((i) => i.name === 'file2');
      const file3 = result.items.find((i) => i.name === 'file3');
      const file4 = result.items.find((i) => i.name === 'file4');

      // Small files should be protected (kept fully)
      expect(file1?.allocatedTokens).toBe(1000);
      expect(file1?.wasProtected).toBe(true);
      expect(file2?.allocatedTokens).toBe(1000);
      expect(file2?.wasProtected).toBe(true);
      expect(file3?.allocatedTokens).toBe(10000);
      expect(file3?.wasProtected).toBe(true);

      // Giant file should be truncated
      expect(file4?.allocatedTokens).toBeCloseTo(88000, 0);
      expect(file4?.wasProtected).toBe(false);

      // Verify stats
      expect(result.stats.protectionModeUsed).toBe(true);
      expect(result.stats.protectedCount).toBe(3);
      expect(result.stats.truncatedCount).toBe(1);
      expect(result.stats.deficit).toBe(212000);
    });
  });

  describe('Example 2: Multiple Large Files', () => {
    it('should protect small files and tax large files proportionally', () => {
      const items: TaxableItem[] = [
        { name: 'file1', tokens: 1000 },
        { name: 'file2', tokens: 1000 },
        { name: 'file3', tokens: 100000 },
        { name: 'file4', tokens: 200000 },
      ];
      const targetTokens = 100000;

      const result = applyProgressiveTax(items, targetTokens);

      // Verify total matches target
      const totalAllocated = result.items.reduce((sum, item) => sum + item.allocatedTokens, 0);
      expect(totalAllocated).toBeCloseTo(targetTokens, 0);

      // Find specific items
      const file1 = result.items.find((i) => i.name === 'file1');
      const file2 = result.items.find((i) => i.name === 'file2');
      const file3 = result.items.find((i) => i.name === 'file3');
      const file4 = result.items.find((i) => i.name === 'file4');

      // Small files should be protected
      expect(file1?.allocatedTokens).toBe(1000);
      expect(file1?.wasProtected).toBe(true);
      expect(file2?.allocatedTokens).toBe(1000);
      expect(file2?.wasProtected).toBe(true);

      // Large files should be truncated proportionally
      expect(file3?.allocatedTokens).toBeCloseTo(32667, 0);
      expect(file3?.wasProtected).toBe(false);
      expect(file4?.allocatedTokens).toBeCloseTo(65333, 0);
      expect(file4?.wasProtected).toBe(false);

      // Both large files should keep approximately the same percentage
      const file3Percentage = file3!.allocatedTokens / file3!.originalTokens;
      const file4Percentage = file4!.allocatedTokens / file4!.originalTokens;
      expect(file3Percentage).toBeCloseTo(file4Percentage, 4);

      // Verify stats
      expect(result.stats.protectionModeUsed).toBe(true);
      expect(result.stats.protectedCount).toBe(2);
      expect(result.stats.truncatedCount).toBe(2);
    });
  });

  describe('Example 3: Many Equal Files', () => {
    it('should tax all files equally when all are the same size', () => {
      // 300 files × 1,000 tokens each = 300,000 total
      const items: TaxableItem[] = Array.from({ length: 300 }, (_, i) => ({
        name: `file${i + 1}`,
        tokens: 1000,
      }));
      const targetTokens = 100000;

      const result = applyProgressiveTax(items, targetTokens);

      // Verify total matches target
      const totalAllocated = result.items.reduce((sum, item) => sum + item.allocatedTokens, 0);
      expect(totalAllocated).toBeCloseTo(targetTokens, 0);

      // All files should have the same allocation (none protected)
      const firstAllocation = result.items[0].allocatedTokens;
      result.items.forEach((item) => {
        expect(item.allocatedTokens).toBeCloseTo(firstAllocation, 1);
        expect(item.wasProtected).toBe(false);
      });

      // Each file should keep approximately 333.33 tokens
      expect(firstAllocation).toBeCloseTo(333.33, 0);

      // Verify stats
      expect(result.stats.protectionModeUsed).toBe(true);
      expect(result.stats.protectedCount).toBe(0);
      expect(result.stats.truncatedCount).toBe(300);
    });
  });

  describe('Example 4: Fallback Mode (Protection Not Feasible)', () => {
    it('should use proportional taxation when protection is not feasible', () => {
      const items: TaxableItem[] = [
        { name: 'file1', tokens: 149 },
        { name: 'file2', tokens: 251 },
      ];
      const targetTokens = 100;

      const result = applyProgressiveTax(items, targetTokens);

      // Verify total matches target
      const totalAllocated = result.items.reduce((sum, item) => sum + item.allocatedTokens, 0);
      expect(totalAllocated).toBeCloseTo(targetTokens, 0);

      // Find specific items
      const file1 = result.items.find((i) => i.name === 'file1');
      const file2 = result.items.find((i) => i.name === 'file2');

      // Both files should be taxed proportionally
      expect(file1?.allocatedTokens).toBeCloseTo(37.25, 1);
      expect(file1?.wasProtected).toBe(false);
      expect(file2?.allocatedTokens).toBeCloseTo(62.75, 1);
      expect(file2?.wasProtected).toBe(false);

      // Both should keep the same percentage (25%)
      const file1Percentage = file1!.allocatedTokens / file1!.originalTokens;
      const file2Percentage = file2!.allocatedTokens / file2!.originalTokens;
      expect(file1Percentage).toBeCloseTo(file2Percentage, 4);
      expect(file1Percentage).toBeCloseTo(0.25, 2);

      // Verify stats - protection mode should NOT be used
      expect(result.stats.protectionModeUsed).toBe(false);
      expect(result.stats.protectedCount).toBe(0);
      expect(result.stats.truncatedCount).toBe(2);
    });
  });

  describe('Edge Cases', () => {
    it('should handle already under budget (no truncation needed)', () => {
      const items: TaxableItem[] = [
        { name: 'file1', tokens: 1000 },
        { name: 'file2', tokens: 2000 },
      ];
      const targetTokens = 5000;

      const result = applyProgressiveTax(items, targetTokens);

      // All items should keep their original tokens
      expect(result.items[0].allocatedTokens).toBe(1000);
      expect(result.items[1].allocatedTokens).toBe(2000);

      // Verify stats
      expect(result.stats.deficit).toBe(0);
      expect(result.stats.truncatedCount).toBe(0);
    });

    it('should handle single item', () => {
      const items: TaxableItem[] = [{ name: 'file1', tokens: 10000 }];
      const targetTokens = 5000;

      const result = applyProgressiveTax(items, targetTokens);

      // Single item should be truncated to target
      expect(result.items[0].allocatedTokens).toBe(5000);
      expect(result.stats.deficit).toBe(5000);
    });

    it('should handle zero target (extreme truncation)', () => {
      const items: TaxableItem[] = [
        { name: 'file1', tokens: 1000 },
        { name: 'file2', tokens: 2000 },
      ];
      const targetTokens = 0;

      const result = applyProgressiveTax(items, targetTokens);

      // All items should be reduced to 0
      result.items.forEach((item) => {
        expect(item.allocatedTokens).toBe(0);
      });
    });

    it('should never allocate negative tokens', () => {
      const items: TaxableItem[] = [
        { name: 'file1', tokens: 100 },
        { name: 'file2', tokens: 200 },
      ];
      const targetTokens = 10;

      const result = applyProgressiveTax(items, targetTokens);

      // No item should have negative tokens
      result.items.forEach((item) => {
        expect(item.allocatedTokens).toBeGreaterThanOrEqual(0);
      });
    });
  });
});

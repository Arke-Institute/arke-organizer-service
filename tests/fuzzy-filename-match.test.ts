/**
 * Tests for Fuzzy Filename Matching
 *
 * Tests the progressive matching strategy for handling LLM variations
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeFilename,
  tokenizeFilename,
  calculateJaccardSimilarity,
  findBestMatch,
  buildFilenameMatcher,
} from '../src/utils/fuzzy-filename-match';

describe('Fuzzy Filename Matching', () => {
  // Real filenames from the failing logs
  const realFilenames = [
    '1895_1-14-Jan 2001-Martin copy.jpg.ref.json',
    '1895_1-14-Jan 2002-Martin copy.jpg.ref.json',
    '1895_1-14-Jan 2003-Martin copy.jpg.ref.json',
    '1897_8-15-Daisy-Unknown Sender envelope 15 july 1897 001 copy.jpg.ref.json',
    '1895_1-14-Jan 2008p-Martin copy.jpg.ref.json',
    '1895_6-18-June 7005-martin copy.jpg.ref.json',
    '1897_8-27-miss hoyt clipping 001 copy.jpg.ref.json',
  ];

  describe('normalizeFilename', () => {
    it('should lowercase the filename', () => {
      expect(normalizeFilename('FILE.TXT')).toBe('file.txt');
    });

    it('should strip .ref.json extension', () => {
      expect(normalizeFilename('photo.jpg.ref.json')).toBe('photo');
    });

    it('should strip common image extensions', () => {
      expect(normalizeFilename('photo.jpg')).toBe('photo');
      expect(normalizeFilename('photo.jpeg')).toBe('photo');
      expect(normalizeFilename('photo.png')).toBe('photo');
    });

    it('should collapse multiple spaces', () => {
      expect(normalizeFilename('file   name   here')).toBe('file name here');
    });

    it('should trim whitespace', () => {
      expect(normalizeFilename('  file.txt  ')).toBe('file.txt');
    });

    it('should handle real complex filenames', () => {
      expect(normalizeFilename('1895_1-14-Jan 2001-Martin copy.jpg.ref.json'))
        .toBe('1895_1-14-jan 2001-martin copy');
    });
  });

  describe('tokenizeFilename', () => {
    it('should split on spaces', () => {
      const tokens = tokenizeFilename('file name here');
      expect(tokens).toEqual(new Set(['file', 'name', 'here']));
    });

    it('should split on underscores', () => {
      const tokens = tokenizeFilename('file_name_here');
      expect(tokens).toEqual(new Set(['file', 'name', 'here']));
    });

    it('should split on hyphens', () => {
      const tokens = tokenizeFilename('file-name-here');
      expect(tokens).toEqual(new Set(['file', 'name', 'here']));
    });

    it('should handle mixed separators', () => {
      const tokens = tokenizeFilename('1895_1-14-Jan 2001-Martin copy');
      expect(tokens).toContain('1895');
      expect(tokens).toContain('jan');
      expect(tokens).toContain('martin');
      expect(tokens).toContain('copy');
    });

    it('should filter empty strings', () => {
      const tokens = tokenizeFilename('file--name');
      expect(tokens).not.toContain('');
    });
  });

  describe('calculateJaccardSimilarity', () => {
    it('should return 1 for identical sets', () => {
      const set = new Set(['a', 'b', 'c']);
      expect(calculateJaccardSimilarity(set, set)).toBe(1);
    });

    it('should return 0 for disjoint sets', () => {
      const set1 = new Set(['a', 'b']);
      const set2 = new Set(['c', 'd']);
      expect(calculateJaccardSimilarity(set1, set2)).toBe(0);
    });

    it('should return 0.5 for half overlap', () => {
      const set1 = new Set(['a', 'b']);
      const set2 = new Set(['b', 'c']);
      // intersection = {b}, union = {a, b, c}
      expect(calculateJaccardSimilarity(set1, set2)).toBeCloseTo(1 / 3, 5);
    });

    it('should handle empty sets', () => {
      const empty = new Set<string>();
      const nonEmpty = new Set(['a']);
      expect(calculateJaccardSimilarity(empty, empty)).toBe(1);
      expect(calculateJaccardSimilarity(empty, nonEmpty)).toBe(0);
    });
  });

  describe('findBestMatch', () => {
    describe('exact match', () => {
      it('should find exact match', () => {
        const result = findBestMatch(
          '1895_1-14-Jan 2001-Martin copy.jpg.ref.json',
          realFilenames
        );
        expect(result.match).toBe('1895_1-14-Jan 2001-Martin copy.jpg.ref.json');
        expect(result.confidence).toBe('exact');
      });
    });

    describe('normalized match', () => {
      it('should match when .ref.json is stripped', () => {
        const result = findBestMatch(
          '1895_1-14-Jan 2001-Martin copy.jpg',
          realFilenames
        );
        expect(result.match).toBe('1895_1-14-Jan 2001-Martin copy.jpg.ref.json');
        expect(result.confidence).toBe('normalized');
      });

      it('should match when .jpg.ref.json is stripped', () => {
        const result = findBestMatch(
          '1895_1-14-Jan 2001-Martin copy',
          realFilenames
        );
        expect(result.match).toBe('1895_1-14-Jan 2001-Martin copy.jpg.ref.json');
        expect(result.confidence).toBe('normalized');
      });

      it('should match with case variation', () => {
        const result = findBestMatch(
          '1895_1-14-JAN 2001-MARTIN COPY.jpg.ref.json',
          realFilenames
        );
        expect(result.match).toBe('1895_1-14-Jan 2001-Martin copy.jpg.ref.json');
        expect(result.confidence).toBe('normalized');
      });

      it('should match with extra whitespace', () => {
        const result = findBestMatch(
          '1895_1-14-Jan  2001-Martin  copy.jpg.ref.json',
          realFilenames
        );
        expect(result.match).toBe('1895_1-14-Jan 2001-Martin copy.jpg.ref.json');
        expect(result.confidence).toBe('normalized');
      });
    });

    describe('prefix match', () => {
      it('should match truncated filename (prefix)', () => {
        const result = findBestMatch(
          '1895_1-14-Jan 2001-Martin',
          realFilenames
        );
        expect(result.match).toBe('1895_1-14-Jan 2001-Martin copy.jpg.ref.json');
        expect(result.confidence).toBe('prefix');
      });

      it('should not match if prefix is too short', () => {
        const result = findBestMatch(
          '1895',
          realFilenames
        );
        // Too short prefix, should fall through to token match or no match
        expect(result.confidence).not.toBe('prefix');
      });
    });

    describe('token match', () => {
      it('should match with high token overlap', () => {
        // This has most tokens but rearranged
        const result = findBestMatch(
          'martin jan 2001 1895 copy 1-14',
          realFilenames
        );
        expect(result.confidence).toBe('token');
        // Should match one of the Martin files
        expect(result.match).toContain('Martin');
      });
    });

    describe('no match', () => {
      it('should return null for completely different filename', () => {
        const result = findBestMatch(
          'completely_different_file.txt',
          realFilenames
        );
        expect(result.match).toBeNull();
        expect(result.confidence).toBeNull();
      });
    });

    describe('similar but different files', () => {
      it('should distinguish between 2001 and 2002 files with exact match', () => {
        const result = findBestMatch(
          '1895_1-14-Jan 2002-Martin copy.jpg.ref.json',
          realFilenames
        );
        // Should find 2002, not 2001
        expect(result.match).toBe('1895_1-14-Jan 2002-Martin copy.jpg.ref.json');
        expect(result.confidence).toBe('exact');
      });
    });
  });

  describe('buildFilenameMatcher', () => {
    it('should return a reusable matcher function', () => {
      const matcher = buildFilenameMatcher(realFilenames);

      // Test multiple lookups
      const result1 = matcher('1895_1-14-Jan 2001-Martin copy.jpg.ref.json');
      expect(result1.confidence).toBe('exact');

      const result2 = matcher('1895_1-14-Jan 2001-Martin copy');
      expect(result2.confidence).toBe('normalized');
    });

    it('should handle empty original list', () => {
      const matcher = buildFilenameMatcher([]);
      const result = matcher('any-file.txt');
      expect(result.match).toBeNull();
    });
  });

  describe('real-world scenarios from logs', () => {
    it('should handle the actual failing filenames from logs', () => {
      // These are actual filenames that were failing
      const originals = [
        '1895_1-14-Jan 2001-Martin copy.jpg.ref.json',
        '1895_1-14-Jan 2002-Martin copy.jpg.ref.json',
        '1895_1-14-Jan 2003-Martin copy.jpg.ref.json',
        '1895_1-14-Jan 2004-Martin copy.jpg.ref.json',
        '1895_1-14-Jan 2005-Martin copy.jpg.ref.json',
      ];

      const matcher = buildFilenameMatcher(originals);

      // LLM might strip extension
      expect(matcher('1895_1-14-Jan 2001-Martin copy.jpg').match)
        .toBe('1895_1-14-Jan 2001-Martin copy.jpg.ref.json');

      // LLM might strip both extensions
      expect(matcher('1895_1-14-Jan 2002-Martin copy').match)
        .toBe('1895_1-14-Jan 2002-Martin copy.jpg.ref.json');

      // LLM might change case
      expect(matcher('1895_1-14-jan 2003-martin copy.jpg.ref.json').match)
        .toBe('1895_1-14-Jan 2003-Martin copy.jpg.ref.json');
    });

    it('should handle the 2008p filename with suffix', () => {
      const originals = [
        '1895_1-14-Jan 2008p-Martin copy.jpg.ref.json',
        '1895_1-14-Jan 2008-Martin copy.jpg.ref.json',
      ];

      const matcher = buildFilenameMatcher(originals);

      // Exact match for 2008p
      expect(matcher('1895_1-14-Jan 2008p-Martin copy.jpg.ref.json').match)
        .toBe('1895_1-14-Jan 2008p-Martin copy.jpg.ref.json');

      // Should NOT match 2008p when looking for 2008
      // (if both exist, they're different files)
      expect(matcher('1895_1-14-Jan 2008-Martin copy.jpg.ref.json').match)
        .toBe('1895_1-14-Jan 2008-Martin copy.jpg.ref.json');
    });

    it('should handle the long envelope filename', () => {
      const originals = [
        '1897_8-15-Daisy-Unknown Sender envelope 15 july 1897 001 copy.jpg.ref.json',
      ];

      const matcher = buildFilenameMatcher(originals);

      // Truncated version
      const truncated = '1897_8-15-Daisy-Unknown Sender envelope 15 july 1897';
      const result = matcher(truncated);
      expect(result.match).toBe(originals[0]);
      expect(result.confidence).toBe('prefix');
    });
  });
});

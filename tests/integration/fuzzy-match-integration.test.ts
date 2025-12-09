/**
 * Integration tests for fuzzy filename matching
 *
 * Tests the full validation pipeline with difficult edge cases
 * that could cause false positive matches
 */

import { describe, it, expect } from 'vitest';
import { validateResponse } from '../../src/validation';
import type { OrganizeStructuredOutput } from '../../src/types';

describe('Fuzzy Matching Integration Tests', () => {
  /**
   * Generate a mock LLM response that returns filenames with various transformations
   */
  function createMockResponse(
    files: string[],
    transform: (filename: string) => string = (f) => f
  ): OrganizeStructuredOutput {
    return {
      groups: [
        {
          group_name: 'Test_Group',
          description: 'Test group for all files',
          files: files.map(transform),
        },
      ],
      ungrouped_files: [],
      reorganization_description: 'Test reorganization',
    };
  }

  describe('Edge Case: Files differing only by number', () => {
    const numberedFiles = [
      '1895_1-14-Jan 2001-Martin copy.jpg.ref.json',
      '1895_1-14-Jan 2002-Martin copy.jpg.ref.json',
      '1895_1-14-Jan 2003-Martin copy.jpg.ref.json',
      '1895_1-14-Jan 2004-Martin copy.jpg.ref.json',
      '1895_1-14-Jan 2005-Martin copy.jpg.ref.json',
    ];

    it('should match exact filenames correctly', () => {
      const response = createMockResponse(numberedFiles);
      const result = validateResponse(response, numberedFiles);

      expect(result.warnings).toHaveLength(0);
      expect(result.sanitizedResponse.groups[0].files).toEqual(numberedFiles);
    });

    it('should match when .ref.json is stripped', () => {
      const response = createMockResponse(numberedFiles, (f) => f.replace('.ref.json', ''));
      const result = validateResponse(response, numberedFiles);

      // Should have fuzzy match warnings but still succeed
      expect(result.sanitizedResponse.groups[0].files).toEqual(numberedFiles);
    });

    it('should match when .jpg.ref.json is stripped', () => {
      const response = createMockResponse(numberedFiles, (f) => f.replace('.jpg.ref.json', ''));
      const result = validateResponse(response, numberedFiles);

      expect(result.sanitizedResponse.groups[0].files).toEqual(numberedFiles);
    });

    it('should NOT cross-match different numbered files', () => {
      // LLM returns 2001 twice, missing 2002
      const badResponse: OrganizeStructuredOutput = {
        groups: [{
          group_name: 'Test',
          description: 'Test',
          files: [
            '1895_1-14-Jan 2001-Martin copy.jpg.ref.json',
            '1895_1-14-Jan 2001-Martin copy.jpg.ref.json', // duplicate
            '1895_1-14-Jan 2003-Martin copy.jpg.ref.json',
            '1895_1-14-Jan 2004-Martin copy.jpg.ref.json',
            '1895_1-14-Jan 2005-Martin copy.jpg.ref.json',
          ],
        }],
        ungrouped_files: [],
        reorganization_description: 'Test',
      };

      // Missing file 2002 should be added to ungrouped with a warning
      const result = validateResponse(badResponse, numberedFiles);
      expect(result.warnings.some(w => w.includes('LLM omitted'))).toBe(true);
      expect(result.sanitizedResponse.ungrouped_files).toContain('1895_1-14-Jan 2002-Martin copy.jpg.ref.json');
    });
  });

  describe('Edge Case: Files with suffix variations', () => {
    const suffixFiles = [
      '1895_1-14-Jan 2001-Martin.jpg.ref.json',
      '1895_1-14-Jan 2001-Martin copy.jpg.ref.json',
      '1895_1-14-Jan 2001-Martin copy 2.jpg.ref.json',
    ];

    it('should distinguish between files with and without "copy" suffix', () => {
      const response = createMockResponse(suffixFiles);
      const result = validateResponse(response, suffixFiles);

      expect(result.sanitizedResponse.groups[0].files).toEqual(suffixFiles);
    });

    it('should handle LLM confusing copy variants by adding missing to ungrouped', () => {
      const badResponse: OrganizeStructuredOutput = {
        groups: [{
          group_name: 'Test',
          description: 'Test',
          files: [
            '1895_1-14-Jan 2001-Martin.jpg.ref.json',
            '1895_1-14-Jan 2001-Martin.jpg.ref.json', // wrong - should be "copy"
            '1895_1-14-Jan 2001-Martin copy 2.jpg.ref.json',
          ],
        }],
        ungrouped_files: [],
        reorganization_description: 'Test',
      };

      // Missing "copy" variant should be added to ungrouped
      const result = validateResponse(badResponse, suffixFiles);
      expect(result.warnings.some(w => w.includes('LLM omitted'))).toBe(true);
      expect(result.sanitizedResponse.ungrouped_files).toContain('1895_1-14-Jan 2001-Martin copy.jpg.ref.json');
    });
  });

  describe('Edge Case: Single character differences', () => {
    const singleCharFiles = [
      '1895_1-14-Jan 2008-Martin copy.jpg.ref.json',
      '1895_1-14-Jan 2008p-Martin copy.jpg.ref.json', // has 'p' suffix
      '1895_1-14-Jan 2008a-Martin copy.jpg.ref.json', // has 'a' suffix
    ];

    it('should distinguish files with single character differences', () => {
      const response = createMockResponse(singleCharFiles);
      const result = validateResponse(response, singleCharFiles);

      expect(result.sanitizedResponse.groups[0].files).toEqual(singleCharFiles);
    });

    it('should NOT fuzzy match 2008 to 2008p - missing file added to ungrouped', () => {
      // If LLM strips the 'p', the 2008p file should go to ungrouped
      const badResponse: OrganizeStructuredOutput = {
        groups: [{
          group_name: 'Test',
          description: 'Test',
          files: [
            '1895_1-14-Jan 2008-Martin copy.jpg.ref.json',
            '1895_1-14-Jan 2008-Martin copy.jpg.ref.json', // wrong - stripped 'p'
            '1895_1-14-Jan 2008a-Martin copy.jpg.ref.json',
          ],
        }],
        ungrouped_files: [],
        reorganization_description: 'Test',
      };

      // The 2008p file should be added to ungrouped
      const result = validateResponse(badResponse, singleCharFiles);
      expect(result.warnings.some(w => w.includes('LLM omitted'))).toBe(true);
      expect(result.sanitizedResponse.ungrouped_files).toContain('1895_1-14-Jan 2008p-Martin copy.jpg.ref.json');
    });
  });

  describe('Edge Case: Similar names, different people', () => {
    const peopleFiles = [
      '1895_6-18-June 7005-Martin copy.jpg.ref.json',
      '1895_6-18-June 7005-Marvin copy.jpg.ref.json',
      '1895_6-18-June 7005-Martinez copy.jpg.ref.json',
    ];

    it('should distinguish between similar but different names', () => {
      const response = createMockResponse(peopleFiles);
      const result = validateResponse(response, peopleFiles);

      expect(result.sanitizedResponse.groups[0].files).toEqual(peopleFiles);
    });
  });

  describe('Edge Case: Sequential numbered files', () => {
    const sequenceFiles = [
      '1897_8-27-miss hoyt clipping 001 copy.jpg.ref.json',
      '1897_8-27-miss hoyt clipping 002 copy.jpg.ref.json',
      '1897_8-27-miss hoyt clipping 003 copy.jpg.ref.json',
      '1897_8-27-miss hoyt clipping 004 copy.jpg.ref.json',
      '1897_8-27-miss hoyt clipping 005 copy.jpg.ref.json',
    ];

    it('should match each sequential file correctly', () => {
      const response = createMockResponse(sequenceFiles);
      const result = validateResponse(response, sequenceFiles);

      expect(result.sanitizedResponse.groups[0].files).toEqual(sequenceFiles);
    });

    it('should match with extension stripped', () => {
      const response = createMockResponse(sequenceFiles, (f) => f.replace('.jpg.ref.json', ''));
      const result = validateResponse(response, sequenceFiles);

      expect(result.sanitizedResponse.groups[0].files).toHaveLength(5);
    });
  });

  describe('Large directory test (50 files)', () => {
    // Generate 50 realistic-looking archival filenames
    const largeFileSet = [
      // Martin correspondence series (10 files)
      ...Array.from({ length: 10 }, (_, i) =>
        `1895_1-14-Jan 200${i + 1}-Martin copy.jpg.ref.json`
      ),
      // Furbush correspondence series (5 files)
      ...Array.from({ length: 5 }, (_, i) =>
        `1895_1-20-Jan 100${i + 1}-furbush copy.jpg.ref.json`
      ),
      // T Q Browne series (5 files)
      ...Array.from({ length: 5 }, (_, i) =>
        `1895_1-31-T Q Browne Jr 31 Jan 189500${i + 1} copy.jpg.ref.json`
      ),
      // Strong correspondence (8 files)
      ...Array.from({ length: 8 }, (_, i) =>
        `1895_11-7-Nov 300${i + 1}-Strong copy.jpg.ref.json`
      ),
      // Daisy Elliot series (10 files)
      ...Array.from({ length: 10 }, (_, i) =>
        `1897_8-${10 + i}-Daisy Elliot Aug ${10 + i}00${(i % 4) + 1} copy.jpg.ref.json`
      ),
      // Alice Cornell Austen (5 files)
      ...Array.from({ length: 5 }, (_, i) =>
        `1897_8-28-Alice Cornell Austen 00${i + 1} copy.jpg.ref.json`
      ),
      // Miscellaneous unique files (7 files)
      '1897_8-15-Daisy-Unknown Sender envelope 15 july 1897 001 copy.jpg.ref.json',
      '1897_8-27-miss hoyt clipping 001 copy.jpg.ref.json',
      '1895_1-Jan 3001 copy.jpg.ref.json',
      '1895_10-10-Sept 1001 copy.jpg.ref.json',
      '1895_11-14-Nov 4001 copy.jpg.ref.json',
      '1895_11-16-Nov 1 001 copy.jpg.ref.json',
      '1895_6-18-June 7005-martin copy.jpg.ref.json',
    ];

    it('should have 50 files', () => {
      expect(largeFileSet).toHaveLength(50);
    });

    it('should handle all 50 files with exact match', () => {
      const response = createMockResponse(largeFileSet);
      const result = validateResponse(response, largeFileSet);

      expect(result.warnings).toHaveLength(0);
      expect(result.sanitizedResponse.groups[0].files).toHaveLength(50);
    });

    it('should handle 50 files with stripped .ref.json extension', () => {
      const response = createMockResponse(largeFileSet, (f) => f.replace('.ref.json', ''));
      const result = validateResponse(response, largeFileSet);

      // All files should be matched
      expect(result.sanitizedResponse.groups[0].files).toHaveLength(50);
      // Should have fuzzy match warnings
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should handle 50 files with stripped .jpg.ref.json extension', () => {
      const response = createMockResponse(largeFileSet, (f) => f.replace('.jpg.ref.json', ''));
      const result = validateResponse(response, largeFileSet);

      expect(result.sanitizedResponse.groups[0].files).toHaveLength(50);
    });

    it('should handle 50 files with case changes', () => {
      const response = createMockResponse(largeFileSet, (f) => f.toLowerCase());
      const result = validateResponse(response, largeFileSet);

      expect(result.sanitizedResponse.groups[0].files).toHaveLength(50);
    });

    it('should add genuinely missing file to ungrouped', () => {
      // Return only 49 files
      const response = createMockResponse(largeFileSet.slice(0, 49));

      // The 50th file should be added to ungrouped
      const result = validateResponse(response, largeFileSet);
      expect(result.warnings.some(w => w.includes('LLM omitted'))).toBe(true);
      expect(result.sanitizedResponse.ungrouped_files).toContain(largeFileSet[49]);
    });

    it('should handle split across multiple groups', () => {
      const response: OrganizeStructuredOutput = {
        groups: [
          {
            group_name: 'Martin_Correspondence',
            description: 'Martin letters',
            files: largeFileSet.slice(0, 10),
          },
          {
            group_name: 'Furbush_Correspondence',
            description: 'Furbush letters',
            files: largeFileSet.slice(10, 15),
          },
          {
            group_name: 'Other_Correspondence',
            description: 'Other letters',
            files: largeFileSet.slice(15, 50),
          },
        ],
        ungrouped_files: [],
        reorganization_description: 'Organized by correspondent',
      };

      const result = validateResponse(response, largeFileSet);

      const totalFiles = result.sanitizedResponse.groups.reduce(
        (sum, g) => sum + g.files.length, 0
      );
      expect(totalFiles).toBe(50);
    });
  });

  describe('Mixed transformations', () => {
    const mixedFiles = [
      '1895_1-14-Jan 2001-Martin copy.jpg.ref.json',
      '1895_1-14-Jan 2002-Martin copy.jpg.ref.json',
      '1897_8-15-Daisy-Unknown Sender envelope 15 july 1897 001 copy.jpg.ref.json',
    ];

    it('should handle mix of exact and fuzzy matches', () => {
      const response: OrganizeStructuredOutput = {
        groups: [{
          group_name: 'Test',
          description: 'Test',
          files: [
            '1895_1-14-Jan 2001-Martin copy.jpg.ref.json', // exact
            '1895_1-14-Jan 2002-Martin copy.jpg', // stripped .ref.json
            '1897_8-15-Daisy-Unknown Sender envelope 15 july 1897 001 copy', // stripped .jpg.ref.json
          ],
        }],
        ungrouped_files: [],
        reorganization_description: 'Test',
      };

      const result = validateResponse(response, mixedFiles);

      expect(result.sanitizedResponse.groups[0].files).toEqual(mixedFiles);
      // Should have warnings for the fuzzy matches
      expect(result.warnings.filter(w => w.includes('fuzzy matching'))).toHaveLength(2);
    });
  });

  describe('File in multiple groups (allowed overlap)', () => {
    const files = [
      'document1.ref.json',
      'document2.ref.json',
      'document3.ref.json',
    ];

    it('should allow same file in multiple groups', () => {
      const response: OrganizeStructuredOutput = {
        groups: [
          {
            group_name: 'Group_A',
            description: 'First group',
            files: ['document1.ref.json', 'document2.ref.json'],
          },
          {
            group_name: 'Group_B',
            description: 'Second group',
            files: ['document2.ref.json', 'document3.ref.json'], // document2 in both
          },
        ],
        ungrouped_files: [],
        reorganization_description: 'Test with overlap',
      };

      const result = validateResponse(response, files);

      // All original files should be accounted for
      expect(result.sanitizedResponse.groups).toHaveLength(2);
    });
  });

  describe('Whitespace variations', () => {
    const files = [
      '1895_1-14-Jan 2001-Martin copy.jpg.ref.json',
    ];

    it('should handle extra spaces', () => {
      const response: OrganizeStructuredOutput = {
        groups: [{
          group_name: 'Test',
          description: 'Test',
          files: ['1895_1-14-Jan  2001-Martin  copy.jpg.ref.json'], // extra spaces
        }],
        ungrouped_files: [],
        reorganization_description: 'Test',
      };

      const result = validateResponse(response, files);
      expect(result.sanitizedResponse.groups[0].files).toEqual(files);
    });

    it('should handle leading/trailing spaces', () => {
      const response: OrganizeStructuredOutput = {
        groups: [{
          group_name: 'Test',
          description: 'Test',
          files: ['  1895_1-14-Jan 2001-Martin copy.jpg.ref.json  '], // padded
        }],
        ungrouped_files: [],
        reorganization_description: 'Test',
      };

      const result = validateResponse(response, files);
      expect(result.sanitizedResponse.groups[0].files).toEqual(files);
    });
  });
});

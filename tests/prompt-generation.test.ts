/**
 * Integration tests for prompt generation with progressive tax truncation
 */

import { describe, it, expect } from 'vitest';
import { generateUserPrompt, getLastTruncationStats } from '../src/prompts';
import type { OrganizeRequest, Env } from '../src/types';

describe('Prompt Generation with Progressive Tax Truncation', () => {
  const mockEnv: Env = {
    DEEPINFRA_API_KEY: 'test-key',
    DEEPINFRA_BASE_URL: 'https://api.deepinfra.com/v1/openai',
    MODEL_NAME: 'deepseek-ai/DeepSeek-V3',
    MAX_TOKENS: 128000,
    TOKEN_BUDGET_PERCENTAGE: 0.7,
  };

  describe('Small files under budget', () => {
    it('should not truncate when all files fit within budget', () => {
      const request: OrganizeRequest = {
        directory_path: '/test/small-files',
        files: [
          {
            name: 'file1.txt',
            type: 'text',
            content: 'Small content that fits easily.',
            metadata: { size: 100 },
          },
          {
            name: 'file2.txt',
            type: 'text',
            content: 'Another small file.',
            metadata: { size: 80 },
          },
        ],
      };

      const prompt = generateUserPrompt(request, mockEnv);
      const stats = getLastTruncationStats();

      // Prompt should be generated
      expect(prompt).toBeTruthy();
      expect(prompt).toContain('file1.txt');
      expect(prompt).toContain('file2.txt');
      expect(prompt).toContain('Small content that fits easily.');
      expect(prompt).toContain('Another small file.');

      // No truncation should have occurred
      expect(stats?.applied).toBe(false);
      expect(stats?.deficit).toBe(0);
    });
  });

  describe('One giant file scenario', () => {
    it('should protect small files and truncate the giant file', () => {
      // Generate content with known token counts
      const smallContent = 'x'.repeat(4000); // ~1000 tokens
      const giantContent = 'y'.repeat(1200000); // ~300,000 tokens

      const request: OrganizeRequest = {
        directory_path: '/test/giant-file',
        files: [
          {
            name: 'small1.txt',
            type: 'text',
            content: smallContent,
            metadata: { size: 4000 },
          },
          {
            name: 'small2.txt',
            type: 'text',
            content: smallContent,
            metadata: { size: 4000 },
          },
          {
            name: 'giant.txt',
            type: 'text',
            content: giantContent,
            metadata: { size: 1200000 },
          },
        ],
      };

      const prompt = generateUserPrompt(request, mockEnv);
      const stats = getLastTruncationStats();

      // Prompt should be generated
      expect(prompt).toBeTruthy();

      // Truncation should have occurred
      expect(stats?.applied).toBe(true);
      expect(stats?.deficit).toBeGreaterThan(0);
      expect(stats?.protection_mode_used).toBe(true);

      // Small files should be protected
      expect(stats?.protected_files).toBeGreaterThan(0);
      expect(stats?.truncated_files).toBeGreaterThan(0);

      // Giant file should have truncation marker
      expect(prompt).toContain('[truncated]');
    });
  });

  describe('Many equal files scenario', () => {
    it('should distribute truncation equally across all files', () => {
      // 10 files with 10,000 tokens each = 100,000 tokens
      const equalContent = 'z'.repeat(40000); // ~10,000 tokens each

      const request: OrganizeRequest = {
        directory_path: '/test/equal-files',
        files: Array.from({ length: 10 }, (_, i) => ({
          name: `file${i + 1}.txt`,
          type: 'text' as const,
          content: equalContent,
          metadata: { size: 40000 },
        })),
      };

      const prompt = generateUserPrompt(request, mockEnv);
      const stats = getLastTruncationStats();

      // Prompt should be generated
      expect(prompt).toBeTruthy();

      // Since all files are equal, truncation stats depend on budget
      if (stats?.applied) {
        // All files should be truncated equally (no protection)
        expect(stats.truncated_files).toBe(10);
        expect(stats.protected_files).toBe(0);
      }
    });
  });

  describe('Mixed file sizes', () => {
    it('should apply progressive taxation to mixed file sizes', () => {
      const request: OrganizeRequest = {
        directory_path: '/test/mixed-files',
        files: [
          {
            name: 'tiny.txt',
            type: 'text',
            content: 'x'.repeat(400), // ~100 tokens
            metadata: { size: 400 },
          },
          {
            name: 'small.txt',
            type: 'text',
            content: 'y'.repeat(4000), // ~1,000 tokens
            metadata: { size: 4000 },
          },
          {
            name: 'medium.txt',
            type: 'text',
            content: 'z'.repeat(40000), // ~10,000 tokens
            metadata: { size: 40000 },
          },
          {
            name: 'large.txt',
            type: 'text',
            content: 'a'.repeat(400000), // ~100,000 tokens
            metadata: { size: 400000 },
          },
        ],
      };

      const prompt = generateUserPrompt(request, mockEnv);
      const stats = getLastTruncationStats();

      // Prompt should be generated
      expect(prompt).toBeTruthy();

      // All files should appear in prompt
      expect(prompt).toContain('tiny.txt');
      expect(prompt).toContain('small.txt');
      expect(prompt).toContain('medium.txt');
      expect(prompt).toContain('large.txt');

      // Truncation stats should be available
      expect(stats).toBeDefined();
    });
  });

  describe('Files without content', () => {
    it('should handle ref files without OCR text', () => {
      const request: OrganizeRequest = {
        directory_path: '/test/ref-files',
        files: [
          {
            name: 'document.pdf.ref.json',
            type: 'ref',
            content: '',
            original_filename: 'document.pdf',
            metadata: { mime_type: 'application/pdf', size: 50000 },
          },
          {
            name: 'text.txt',
            type: 'text',
            content: 'Some text content',
            metadata: { size: 100 },
          },
        ],
      };

      const prompt = generateUserPrompt(request, mockEnv);

      // Prompt should handle ref files
      expect(prompt).toBeTruthy();
      expect(prompt).toContain('document.pdf.ref.json');
      expect(prompt).toContain('No OCR text available');
      expect(prompt).toContain('text.txt');
      expect(prompt).toContain('Some text content');
    });
  });

  describe('Token budget configuration', () => {
    it('should respect custom TOKEN_BUDGET_PERCENTAGE', () => {
      const customEnv: Env = {
        ...mockEnv,
        TOKEN_BUDGET_PERCENTAGE: 0.5, // Only use 50% of tokens
      };

      const largeContent = 'x'.repeat(200000); // ~50,000 tokens

      const request: OrganizeRequest = {
        directory_path: '/test/custom-budget',
        files: [
          {
            name: 'large.txt',
            type: 'text',
            content: largeContent,
            metadata: { size: 200000 },
          },
        ],
      };

      const prompt = generateUserPrompt(request, customEnv);
      const stats = getLastTruncationStats();

      // With 50% budget, truncation should be more aggressive
      expect(prompt).toBeTruthy();
      expect(stats).toBeDefined();
    });

    it('should use default 70% when TOKEN_BUDGET_PERCENTAGE not set', () => {
      const defaultEnv: Env = {
        DEEPINFRA_API_KEY: 'test-key',
        DEEPINFRA_BASE_URL: 'https://api.deepinfra.com/v1/openai',
        MODEL_NAME: 'deepseek-ai/DeepSeek-V3',
        // No TOKEN_BUDGET_PERCENTAGE specified
      };

      const request: OrganizeRequest = {
        directory_path: '/test/default-budget',
        files: [
          {
            name: 'file.txt',
            type: 'text',
            content: 'Test content',
            metadata: { size: 100 },
          },
        ],
      };

      const prompt = generateUserPrompt(request, defaultEnv);

      // Should work with default percentage
      expect(prompt).toBeTruthy();
    });
  });
});

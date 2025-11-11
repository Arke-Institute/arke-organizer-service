/**
 * Prompt generation for Organizer Service
 * Based on the "softened" prompt strategy from test-reorganize
 */

import type { OrganizeRequest, OrganizeFileInput } from './types';

/**
 * Generate the system prompt
 * Sets the role and behavior of the LLM for file organization
 */
export function generateSystemPrompt(): string {
  return `You are an expert at organizing and categorizing documents. You think carefully about organizational strategies and can identify patterns across multiple files.`;
}

/**
 * Generate the user prompt from request data
 * Uses the proven "softened" prompt strategy that allows natural overlap
 */
export function generateUserPrompt(request: OrganizeRequest): string {
  const filesList = formatFilesList(request.files);

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
 */
function formatFilesList(files: OrganizeFileInput[]): string {
  return files.map(file => {
    let formatted = `File: ${file.name} (${file.type})`;

    // Add original filename for ref files
    if (file.type === 'ref' && file.original_filename) {
      formatted += `\nOriginal: ${file.original_filename}`;
    }

    // Add metadata if available
    if (file.metadata) {
      if (file.metadata.mime_type) {
        formatted += `\nType: ${file.metadata.mime_type}`;
      }
      if (file.metadata.size) {
        formatted += `\nSize: ${formatBytes(file.metadata.size)}`;
      }
    }

    // Add content if available
    if (file.content && file.content.trim().length > 0) {
      // Truncate very long content to save tokens
      const content = truncateText(file.content, 5000);
      formatted += `\nContent:\n${content}`;
    } else if (file.type === 'ref') {
      formatted += `\n(No OCR text available - use filename/metadata for grouping)`;
    }

    return formatted;
  }).join('\n\n---\n\n');
}

/**
 * Helper: Truncate long text to save tokens
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength) + '\n... [truncated]';
}

/**
 * Helper: Format bytes as human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

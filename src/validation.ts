/**
 * Validation utilities for Organizer Service
 * Validates requests and responses according to API specification
 */

import type { OrganizeRequest, OrganizeStructuredOutput, OrganizeGroup, StrategizeRequest } from './types';
import { buildFilenameMatcher, type MatchResult } from './utils/fuzzy-filename-match';

/**
 * Validate the incoming request
 * Throws an error if validation fails
 */
export function validateRequest(request: OrganizeRequest): void {
  // Check required fields
  if (!request.directory_path) {
    throw new Error('directory_path is required');
  }

  if (!request.files || !Array.isArray(request.files)) {
    throw new Error('files must be an array');
  }

  if (request.files.length === 0) {
    throw new Error('files array cannot be empty');
  }

  // Validate each file
  request.files.forEach((file, index) => {
    if (!file.name) {
      throw new Error('File at index ' + index + ': name is required');
    }

    if (!file.type || (file.type !== 'text' && file.type !== 'ref')) {
      throw new Error('File at index ' + index + ': type must be "text" or "ref"');
    }

    if (file.content === undefined || file.content === null) {
      throw new Error('File at index ' + index + ': content is required (use empty string if no content)');
    }
  });

  // Check size constraints (per spec: max 10MB total)
  const requestSize = JSON.stringify(request).length;
  const MAX_REQUEST_SIZE = 10 * 1024 * 1024; // 10MB

  if (requestSize > MAX_REQUEST_SIZE) {
    throw new Error('Request size (' + formatBytes(requestSize) + ') exceeds 10MB limit');
  }
}

/**
 * Validation result containing warnings instead of throwing errors for recoverable issues
 */
export interface ValidationResult {
  warnings: string[];
  sanitizedResponse: OrganizeStructuredOutput;
}

/**
 * Validate the LLM response
 * Ensures all files are accounted for and group names are valid
 * Returns warnings for recoverable issues instead of throwing errors
 * Uses fuzzy filename matching to handle LLM variations
 */
export function validateResponse(
  response: OrganizeStructuredOutput,
  requestFiles: string[]
): ValidationResult {
  const warnings: string[] = [];
  // Check required fields
  if (!response.groups || !Array.isArray(response.groups)) {
    throw new Error('Response must contain groups array');
  }

  if (!response.ungrouped_files || !Array.isArray(response.ungrouped_files)) {
    throw new Error('Response must contain ungrouped_files array');
  }

  if (!response.reorganization_description) {
    throw new Error('Response must contain reorganization_description');
  }

  // Validate each group
  response.groups.forEach((group, index) => {
    validateGroup(group, index);
  });

  // Build fuzzy matcher for filename resolution
  const matchFilename = buildFilenameMatcher(requestFiles);

  // Track which original files have been accounted for
  const accountedOriginalFiles = new Set<string>();
  const sanitizedGroups: OrganizeGroup[] = [];

  // Helper to detect directory paths (ends with /)
  const isDirectoryPath = (filename: string): boolean => {
    return filename.endsWith('/');
  };

  // Helper to resolve LLM filename to original filename with logging
  const resolveFilename = (llmFilename: string): string | null => {
    const result = matchFilename(llmFilename);
    if (result.match && result.confidence !== 'exact') {
      // Log fuzzy matches for observability
      console.log(`[FuzzyMatch] "${llmFilename}" → "${result.match}" (${result.confidence})`);
    }
    return result.match;
  };

  // Process groups and filter out directory paths, resolving filenames
  response.groups.forEach(group => {
    const sanitizedFiles: string[] = [];

    group.files.forEach(file => {
      if (isDirectoryPath(file)) {
        warnings.push(`Directory path "${file}" found in group "${group.group_name}" - directories are not valid file entries and have been removed`);
        return;
      }

      const originalFilename = resolveFilename(file);
      if (originalFilename) {
        sanitizedFiles.push(originalFilename);
        accountedOriginalFiles.add(originalFilename);
        if (originalFilename !== file) {
          warnings.push(`Filename "${file}" resolved to "${originalFilename}" via fuzzy matching`);
        }
      } else {
        // File not found in request - will be filtered out later as extra file
        sanitizedFiles.push(file);
      }
    });

    // Only include group if it has files after sanitization
    if (sanitizedFiles.length > 0) {
      sanitizedGroups.push({
        ...group,
        files: sanitizedFiles
      });
    } else {
      warnings.push(`Group "${group.group_name}" was empty after removing directory paths and has been excluded`);
    }
  });

  // Process ungrouped files and filter out directory paths, resolving filenames
  const sanitizedUngrouped: string[] = [];
  response.ungrouped_files.forEach(file => {
    if (isDirectoryPath(file)) {
      warnings.push(`Directory path "${file}" found in ungrouped_files - directories are not valid file entries and have been removed`);
      return;
    }

    const originalFilename = resolveFilename(file);
    if (originalFilename) {
      sanitizedUngrouped.push(originalFilename);
      accountedOriginalFiles.add(originalFilename);
      if (originalFilename !== file) {
        warnings.push(`Filename "${file}" resolved to "${originalFilename}" via fuzzy matching`);
      }
    } else {
      // File not found in request - will be filtered out later as extra file
      sanitizedUngrouped.push(file);
    }
  });

  // Check that all request files are present (using accountedOriginalFiles)
  const missingFiles = requestFiles.filter(file => !accountedOriginalFiles.has(file));
  if (missingFiles.length > 0) {
    // Instead of throwing, add missing files to ungrouped as a fallback
    // This handles cases where the LLM completely omits files from its response
    console.warn(`[Validation] LLM omitted ${missingFiles.length} files - adding to ungrouped: ${missingFiles.join(', ')}`);
    warnings.push(`LLM omitted ${missingFiles.length} files from response - added to ungrouped_files as fallback`);
    sanitizedUngrouped.push(...missingFiles);
    missingFiles.forEach(f => accountedOriginalFiles.add(f));
  }

  // Check for extra files (files in response that don't map to any request file)
  const allResponseFiles = new Set<string>();
  sanitizedGroups.forEach(g => g.files.forEach(f => allResponseFiles.add(f)));
  sanitizedUngrouped.forEach(f => allResponseFiles.add(f));

  const extraFiles = Array.from(allResponseFiles).filter(file => !requestFiles.includes(file));
  if (extraFiles.length > 0) {
    warnings.push(`Response contains files not in request: ${extraFiles.join(', ')} - these have been removed`);
    // Filter out extra files from sanitized response
    sanitizedGroups.forEach(group => {
      group.files = group.files.filter(file => requestFiles.includes(file));
    });
    const finalUngrouped = sanitizedUngrouped.filter(file => requestFiles.includes(file));

    return {
      warnings,
      sanitizedResponse: {
        groups: sanitizedGroups,
        ungrouped_files: finalUngrouped,
        reorganization_description: response.reorganization_description
      }
    };
  }

  return {
    warnings,
    sanitizedResponse: {
      groups: sanitizedGroups,
      ungrouped_files: sanitizedUngrouped,
      reorganization_description: response.reorganization_description
    }
  };
}

/**
 * Validate a single group
 */
function validateGroup(group: OrganizeGroup, index: number): void {
  if (!group.group_name) {
    throw new Error('Group at index ' + index + ': group_name is required');
  }

  if (!group.description) {
    throw new Error('Group at index ' + index + ': description is required');
  }

  if (!group.files || !Array.isArray(group.files)) {
    throw new Error('Group at index ' + index + ': files must be an array');
  }

  if (group.files.length === 0) {
    throw new Error('Group at index ' + index + ' ("' + group.group_name + '"): must contain at least 1 file');
  }

  // Validate filesystem-safe group name
  if (!isFilesystemSafe(group.group_name)) {
    throw new Error(
      'Group at index ' + index + ': group_name "' + group.group_name + '" contains invalid characters. ' +
      'Must not contain: / \\ : * ? " < > |'
    );
  }
}

/**
 * Check if a string is filesystem-safe (no special characters)
 * Per spec: group_name must not contain: / \ : * ? " < > |
 */
function isFilesystemSafe(name: string): boolean {
  const invalidChars = /[\/\\:*?"<>|]/;
  return !invalidChars.test(name);
}

/**
 * Sanitize a group name to make it filesystem-safe
 * Replaces invalid characters with hyphens
 */
export function sanitizeGroupName(name: string): string {
  return name.replace(/[\/\\:*?"<>|]/g, '-');
}

/**
 * Helper: Format bytes as human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' bytes';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/**
 * Validate the strategize request
 * Throws an error if validation fails
 */
export function validateStrategizeRequest(request: StrategizeRequest): void {
  // Check required fields
  if (!request.directory_path) {
    throw new Error('directory_path is required');
  }

  if (!request.files || !Array.isArray(request.files)) {
    throw new Error('files must be an array');
  }

  if (request.files.length === 0) {
    throw new Error('files array cannot be empty');
  }

  if (typeof request.total_file_count !== 'number' || request.total_file_count < 1) {
    throw new Error('total_file_count must be a positive number');
  }

  if (typeof request.chunk_count !== 'number' || request.chunk_count < 1) {
    throw new Error('chunk_count must be a positive number');
  }

  // Validate each file
  request.files.forEach((file, index) => {
    if (!file.name) {
      throw new Error('File at index ' + index + ': name is required');
    }

    if (!file.type || (file.type !== 'text' && file.type !== 'ref')) {
      throw new Error('File at index ' + index + ': type must be "text" or "ref"');
    }

    if (file.content === undefined || file.content === null) {
      throw new Error('File at index ' + index + ': content is required (use empty string if no content)');
    }
  });

  // Check size constraints (per spec: max 10MB total)
  const requestSize = JSON.stringify(request).length;
  const MAX_REQUEST_SIZE = 10 * 1024 * 1024; // 10MB

  if (requestSize > MAX_REQUEST_SIZE) {
    throw new Error('Request size (' + formatBytes(requestSize) + ') exceeds 10MB limit');
  }
}

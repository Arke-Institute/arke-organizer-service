/**
 * Validation utilities for Organizer Service
 * Validates requests and responses according to API specification
 */

import type { OrganizeRequest, OrganizeStructuredOutput, OrganizeGroup } from './types';

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
 * Validate the LLM response
 * Ensures all files are accounted for and group names are valid
 */
export function validateResponse(
  response: OrganizeStructuredOutput,
  requestFiles: string[]
): void {
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

  // Check that all files are accounted for
  const allFilesInResponse = new Set<string>();

  // Add files from groups
  response.groups.forEach(group => {
    group.files.forEach(file => allFilesInResponse.add(file));
  });

  // Add ungrouped files
  response.ungrouped_files.forEach(file => allFilesInResponse.add(file));

  // Check that all request files are present
  const missingFiles = requestFiles.filter(file => !allFilesInResponse.has(file));
  if (missingFiles.length > 0) {
    throw new Error('Files not accounted for in response: ' + missingFiles.join(', '));
  }

  // Check that no extra files were added
  const extraFiles = Array.from(allFilesInResponse).filter(file => !requestFiles.includes(file));
  if (extraFiles.length > 0) {
    throw new Error('Response contains files not in request: ' + extraFiles.join(', '));
  }
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

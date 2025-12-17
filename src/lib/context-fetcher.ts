/**
 * Fetch organizer context from IPFS
 *
 * Fetches entity components (text files and refs with OCR) for LLM processing.
 * The orchestrator only sends PIs; we fetch everything from IPFS.
 */

import { IPFSClient, Entity } from '../services/ipfs-client';
import { OrganizeFileInput } from '../types';

// Text file extensions to fetch as content
const TEXT_EXTENSIONS = [
  '.txt', '.md', '.json', '.xml', '.html', '.htm', '.csv', '.tsv',
  '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.log',
  '.rst', '.tex', '.rtf', '.asc', '.nfo'
];

/**
 * Check if a filename is a text file we should fetch
 */
function isTextFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  // Skip special metadata files
  if (lower === 'pinax.json' || lower === 'cheimarros.json' || lower === 'description.md') {
    return false;
  }
  // Skip reorganization description (from previous reorganization)
  if (lower === 'reorganization-description.txt') {
    return false;
  }
  // Skip ref files (handled separately)
  if (lower.endsWith('.ref.json')) {
    return false;
  }
  return TEXT_EXTENSIONS.some(ext => lower.endsWith(ext));
}

/**
 * Context for organizing files in a directory
 */
export interface OrganizerContext {
  id: string;
  tip: string;
  directoryPath: string;
  files: OrganizeFileInput[];
  components: Record<string, string>;  // filename -> CID (for creating groups)
}

/**
 * Fetch context needed for file organization
 * Returns files suitable for the LLM to analyze
 */
export async function fetchOrganizerContext(
  id: string,
  ipfsClient: IPFSClient
): Promise<OrganizerContext> {
  const entity = await ipfsClient.getEntity(id);
  const files: OrganizeFileInput[] = [];
  const components: Record<string, string> = {};

  // Track all component CIDs for later group creation
  for (const [filename, cid] of Object.entries(entity.components)) {
    components[filename] = cid;
  }

  // 1. Fetch all text files from components
  const textFilePromises: Promise<void>[] = [];
  for (const [filename, cid] of Object.entries(entity.components)) {
    if (isTextFile(filename)) {
      textFilePromises.push(
        (async () => {
          try {
            const content = await ipfsClient.downloadContent(cid);
            files.push({
              name: filename,
              type: 'text',
              content,
              original_filename: filename,
            });
          } catch (e) {
            console.warn(`[ContextFetcher] Failed to fetch text file ${filename} for ${id}: ${e}`);
          }
        })()
      );
    }
  }
  await Promise.all(textFilePromises);

  // 2. Fetch all refs from IPFS (includes OCR text if available)
  const refPromises: Promise<void>[] = [];
  for (const [filename, cid] of Object.entries(entity.components)) {
    if (filename.endsWith('.ref.json')) {
      refPromises.push(
        (async () => {
          try {
            const content = await ipfsClient.downloadContent(cid);
            // Parse the ref to extract OCR and metadata
            const ref = JSON.parse(content);

            // Build a summary for the LLM
            let refContent = '';
            if (ref.ocr) {
              // Include OCR text if available
              refContent = `[Image/Document: ${filename.replace('.ref.json', '')}]\n${ref.ocr}`;
            } else {
              // Just describe the file if no OCR
              refContent = `[Binary file: ${filename.replace('.ref.json', '')}]`;
              if (ref.type) refContent += ` Type: ${ref.type}`;
              if (ref.filename) refContent += ` Original: ${ref.filename}`;
            }

            files.push({
              name: filename,
              type: 'ref',
              content: refContent,
              original_filename: ref.filename || filename.replace('.ref.json', ''),
              metadata: {
                mime_type: ref.type,
                size: ref.size,
              },
            });
          } catch (e) {
            console.warn(`[ContextFetcher] Failed to fetch ref ${filename} for ${id}: ${e}`);
          }
        })()
      );
    }
  }
  await Promise.all(refPromises);

  // Use last part of ID as directory name (since we don't have actual paths)
  const directoryPath = id.slice(-8);

  console.log(
    `[ContextFetcher] Fetched context for ${id}: ${files.length} files ` +
      `(text: ${files.filter(f => f.type === 'text').length}, ` +
      `refs: ${files.filter(f => f.type === 'ref').length})`
  );

  return {
    id,
    tip: entity.tip,
    directoryPath,
    files,
    components,
  };
}

/**
 * Fetch sample files for strategize operation
 * Takes a subset of files for the LLM to analyze and devise a strategy
 */
export async function fetchStrategizeContext(
  id: string,
  ipfsClient: IPFSClient,
  maxFiles: number = 10
): Promise<{
  directoryPath: string;
  files: OrganizeFileInput[];
  totalFileCount: number;
}> {
  const context = await fetchOrganizerContext(id, ipfsClient);

  // Return sample files (first maxFiles)
  const sampleFiles = context.files.slice(0, maxFiles);

  return {
    directoryPath: context.directoryPath,
    files: sampleFiles,
    totalFileCount: context.files.length,
  };
}

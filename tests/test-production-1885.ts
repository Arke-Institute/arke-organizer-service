#!/usr/bin/env npx tsx
/**
 * Test the organizer service against real production data
 *
 * Fetches the 1885 collection entity from production API,
 * builds an OrganizeRequest, and tests against local or production organizer service
 */

const WRAPPER_API = 'https://api.arke.institute';
const TARGET_PI = '01KC28TTFKCFDY5SE6PA06F7PV';
const ORGANIZER_URL = process.env.ORGANIZER_URL || 'http://localhost:8787';

interface EntityResponse {
  id: string;
  components: Record<string, string>;
  parent_pi?: string;
}

interface OrganizeFileInput {
  name: string;
  type: 'text' | 'ref';
  content: string;
  original_filename?: string;
}

interface OrganizeRequest {
  directory_path: string;
  files: OrganizeFileInput[];
}

async function fetchEntity(id: string): Promise<EntityResponse> {
  const response = await fetch(`${WRAPPER_API}/entities/${id}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch entity ${id}: ${response.status}`);
  }
  return response.json();
}

async function fetchContent(cid: string): Promise<string> {
  const response = await fetch(`${WRAPPER_API}/cat/${cid}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch content ${cid}: ${response.status}`);
  }
  return response.text();
}

function isRefFile(filename: string): boolean {
  return filename.endsWith('.ref.json');
}

function isTextFile(filename: string): boolean {
  const textExtensions = ['.txt', '.md', '.json'];
  return textExtensions.some(ext => filename.endsWith(ext)) && !isRefFile(filename);
}

async function buildOrganizeRequest(entity: EntityResponse): Promise<OrganizeRequest> {
  const files: OrganizeFileInput[] = [];

  // Fetch all component content in parallel
  const componentEntries = Object.entries(entity.components);

  console.log(`Fetching ${componentEntries.length} components...`);

  const contents = await Promise.all(
    componentEntries.map(async ([name, cid]) => {
      try {
        const content = await fetchContent(cid);
        return { name, content, success: true };
      } catch (error) {
        console.warn(`Failed to fetch ${name}: ${error}`);
        return { name, content: '', success: false };
      }
    })
  );

  for (const { name, content, success } of contents) {
    if (!success) continue;

    // Skip pinax.json - it's metadata, not a file to organize
    if (name === 'pinax.json') continue;

    if (isRefFile(name)) {
      // Parse ref JSON to extract OCR content
      try {
        const refData = JSON.parse(content);
        files.push({
          name,
          type: 'ref',
          content: refData.ocr || '',
          original_filename: refData.filename || name.replace('.ref.json', ''),
        });
      } catch (e) {
        console.warn(`Failed to parse ref JSON for ${name}:`, e);
      }
    } else if (isTextFile(name)) {
      files.push({
        name,
        type: 'text',
        content,
      });
    }
  }

  return {
    directory_path: '/Alice Austen House/content/1885',
    files,
  };
}

async function callOrganizer(request: OrganizeRequest): Promise<any> {
  console.log(`Calling organizer at ${ORGANIZER_URL}...`);

  const response = await fetch(`${ORGANIZER_URL}/organize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Organizer failed (${response.status}): ${text}`);
  }

  return response.json();
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║          PRODUCTION DATA TEST (1885 Collection)                            ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');
  console.log();

  // Fetch entity
  console.log(`Fetching entity ${TARGET_PI} from ${WRAPPER_API}...`);
  const entity = await fetchEntity(TARGET_PI);
  console.log(`Entity has ${Object.keys(entity.components).length} components`);
  console.log();

  // Build request
  const request = await buildOrganizeRequest(entity);
  console.log(`Built request with ${request.files.length} files`);
  console.log(`  - Ref files: ${request.files.filter(f => f.type === 'ref').length}`);
  console.log(`  - Text files: ${request.files.filter(f => f.type === 'text').length}`);
  console.log();

  // Save input for reference
  const fs = await import('fs');
  const inputPath = './tests/stress-results/production-1885-input.json';
  fs.writeFileSync(inputPath, JSON.stringify(request, null, 2));
  console.log(`Saved input to ${inputPath}`);
  console.log();

  // List files
  console.log('Files to organize:');
  request.files.forEach(f => {
    const contentPreview = f.content.length > 50
      ? f.content.substring(0, 50) + '...'
      : f.content || '(empty)';
    console.log(`  ${f.type === 'ref' ? '📷' : '📄'} ${f.name}`);
    console.log(`     Content: ${contentPreview}`);
  });
  console.log();

  // Call organizer
  console.log('Sending to organizer service...');
  const startTime = Date.now();
  const result = await callOrganizer(request);
  const elapsed = Date.now() - startTime;

  console.log();
  console.log(`✓ Organizer completed in ${elapsed}ms`);
  console.log();

  // Save output
  const outputPath = './tests/stress-results/production-1885-output.json';
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log(`Saved output to ${outputPath}`);
  console.log();

  // Analyze result
  console.log('Result summary:');
  console.log(`  Model: ${result.model}`);
  console.log(`  Groups: ${result.groups?.length || 0}`);
  console.log(`  Ungrouped: ${result.ungrouped_files?.length || 0}`);
  console.log(`  Warnings: ${result.validation_warnings?.length || 0}`);

  if (result.tokens) {
    console.log(`  Tokens: ${result.tokens.total} (prompt: ${result.tokens.prompt}, completion: ${result.tokens.completion})`);
  }
  if (result.cost_usd) {
    console.log(`  Cost: $${result.cost_usd.toFixed(4)}`);
  }

  console.log();
  console.log('Groups:');
  result.groups?.forEach((g: any) => {
    console.log(`  📁 ${g.group_name} (${g.files.length} files)`);
    console.log(`     ${g.description}`);
  });

  if (result.ungrouped_files?.length > 0) {
    console.log();
    console.log('Ungrouped files:');
    result.ungrouped_files.forEach((f: string) => console.log(`  ❓ ${f}`));
  }

  if (result.validation_warnings?.length > 0) {
    console.log();
    console.log('Validation warnings:');
    result.validation_warnings.forEach((w: string) => console.log(`  ⚠️ ${w}`));
  }

  // Verify all files accounted for
  const inputFiles = new Set(request.files.map(f => f.name));
  const outputFiles = new Set<string>();
  result.groups?.forEach((g: any) => g.files.forEach((f: string) => outputFiles.add(f)));
  result.ungrouped_files?.forEach((f: string) => outputFiles.add(f));

  const missingFiles = [...inputFiles].filter(f => !outputFiles.has(f));
  const extraFiles = [...outputFiles].filter(f => !inputFiles.has(f));

  console.log();
  if (missingFiles.length === 0 && extraFiles.length === 0) {
    console.log('✓ All files accounted for correctly');
  } else {
    if (missingFiles.length > 0) {
      console.log(`⚠️ Missing files (${missingFiles.length}):`);
      missingFiles.forEach(f => console.log(`  - ${f}`));
    }
    if (extraFiles.length > 0) {
      console.log(`⚠️ Extra files (${extraFiles.length}):`);
      extraFiles.forEach(f => console.log(`  - ${f}`));
    }
  }

  console.log();
  console.log('════════════════════════════════════════════════════════════════════════════');
  console.log('Test complete!');
  console.log('════════════════════════════════════════════════════════════════════════════');
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});

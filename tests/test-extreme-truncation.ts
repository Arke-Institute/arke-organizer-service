#!/usr/bin/env npx tsx
/**
 * Test extreme truncation scenario to replicate production failures
 *
 * The original failure had:
 * - 102 files
 * - 96,488 original tokens
 * - 44,553 target tokens (54% reduction needed)
 * - 91 files truncated
 * - 11 files protected
 *
 * This test creates similar conditions to see if we can reproduce the
 * "Files not accounted for" error
 */

const ORGANIZER_URL = process.env.ORGANIZER_URL || 'http://localhost:8787';

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

// Generate a large text file (like the transcript file in production)
function generateLargeTranscript(tokens: number): string {
  // Each word is roughly 1.3 tokens, each sentence about 20 tokens
  const sentences = [];
  const targetSentences = Math.ceil(tokens / 20);

  for (let i = 0; i < targetSentences; i++) {
    const correspondents = ['Julia Martin', 'Bessie Strong', 'Daisy Elliot', 'Trude Eccleston', 'Violet Ward', 'Alice Cornell Austen'];
    const person = correspondents[i % correspondents.length];
    const date = `${1885 + (i % 10)}_${(i % 12) + 1}-${(i % 28) + 1}`;

    sentences.push(
      `Letter from ${person} dated ${date}: My dearest Alice, I hope this letter finds you well. ` +
      `We had the most wonderful time at the party last evening. The weather has been quite agreeable. ` +
      `Mother sends her regards and hopes you will visit us soon. Your devoted friend, ${person}.`
    );
  }

  return sentences.join('\n\n');
}

// Generate realistic ref file with OCR content
function generateRefFile(
  year: number,
  month: number,
  day: number,
  index: number,
  correspondent: string,
  contentTokens: number
): OrganizeFileInput {
  const monthName = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month - 1];

  // Generate realistic archival filename
  const filename = `${year}_${month}-${day}-${monthName} ${1000 + index}-${correspondent} copy.jpg.ref.json`;

  // Generate OCR-like content
  let content = '';
  if (contentTokens > 0) {
    const sentences = Math.ceil(contentTokens / 25);
    const parts = [];
    for (let i = 0; i < sentences; i++) {
      parts.push(
        `My dearest Alice, I write to you from ${correspondent === 'Martin' ? 'my home in the city' : 'our country estate'}. ` +
        `The ${monthName} weather has been ${i % 2 === 0 ? 'quite fine' : 'rather dreary'}. ` +
        `I remain your affectionate friend.`
      );
    }
    content = parts.join(' ');
  }

  return {
    name: filename,
    type: 'ref',
    content,
    original_filename: filename.replace('.ref.json', ''),
  };
}

async function buildExtremeRequest(): Promise<OrganizeRequest> {
  const files: OrganizeFileInput[] = [];

  // 1. Add ONE large transcript file (~20,000 tokens - majority of content)
  // This should trigger truncation but not timeout
  console.log('Generating large transcript file (~20,000 tokens)...');
  files.push({
    name: '1885-1897 Complete Transcripts.txt',
    type: 'text',
    content: generateLargeTranscript(20000),
  });

  // 2. Add a docx ref with no content
  files.push({
    name: '1885-1897 Complete Transcripts.docx.ref.json',
    type: 'ref',
    content: '',
    original_filename: '1885-1897 Complete Transcripts.docx',
  });

  // 3. Generate 78 ref files with varying content sizes
  // This simulates real production where some have OCR, some don't
  const correspondents = [
    { name: 'Martin', count: 12 },
    { name: 'Strong', count: 12 },
    { name: 'Elliot', count: 10 },
    { name: 'Eccleston', count: 8 },
    { name: 'Ward', count: 10 },
    { name: 'Austen', count: 6 },
    { name: 'Bruce', count: 6 },
    { name: 'Hartnell', count: 5 },
    { name: 'Hustace', count: 5 },
    { name: 'Bredt', count: 4 },
  ];

  console.log('Generating 78 ref files with varying content...');

  let fileIndex = 0;
  for (const { name: correspondent, count } of correspondents) {
    for (let i = 0; i < count; i++) {
      const year = 1885 + (fileIndex % 13);
      const month = ((fileIndex * 3) % 12) + 1;
      const day = ((fileIndex * 7) % 28) + 1;

      // Vary content size: some have lots of OCR, some have little, some have none
      let contentTokens: number;
      if (fileIndex % 10 === 0) {
        contentTokens = 0; // 10% have no OCR
      } else if (fileIndex % 5 === 0) {
        contentTokens = 500; // 10% have substantial OCR
      } else if (fileIndex % 3 === 0) {
        contentTokens = 200; // ~23% have medium OCR
      } else {
        contentTokens = 50; // Rest have minimal OCR
      }

      files.push(generateRefFile(year, month, day, i + 1, correspondent, contentTokens));
      fileIndex++;
    }
  }

  console.log(`Total files: ${files.length}`);

  return {
    directory_path: '/Alice Austen House/content/1885-1897',
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
  console.log('║          EXTREME TRUNCATION TEST                                           ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');
  console.log();
  console.log('Replicating production conditions:');
  console.log('  - 80 files total');
  console.log('  - ~35,000 original tokens');
  console.log('  - Heavy truncation from large transcript');
  console.log('  - 1 large transcript file dominating token budget');
  console.log();

  // Build request
  const request = await buildExtremeRequest();

  // Save input
  const fs = await import('fs');
  const inputPath = './tests/stress-results/extreme-truncation-input.json';
  fs.writeFileSync(inputPath, JSON.stringify(request, null, 2));
  console.log(`Saved input to ${inputPath}`);
  console.log();

  // Call organizer
  console.log('Sending to organizer service...');
  console.log('(This may take a while due to heavy truncation processing)');
  console.log();

  const startTime = Date.now();

  try {
    const result = await callOrganizer(request);
    const elapsed = Date.now() - startTime;

    console.log();
    console.log(`✓ Organizer completed in ${elapsed}ms`);
    console.log();

    // Save output
    const outputPath = './tests/stress-results/extreme-truncation-output.json';
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

    // Show truncation stats
    if (result.truncation) {
      console.log();
      console.log('Truncation stats:');
      console.log(`  Applied: ${result.truncation.applied}`);
      console.log(`  Original tokens: ${result.truncation.total_original_tokens}`);
      console.log(`  Target tokens: ${result.truncation.target_tokens}`);
      console.log(`  Deficit: ${result.truncation.deficit}`);
      console.log(`  Protection mode: ${result.truncation.protection_mode_used}`);
      console.log(`  Protected files: ${result.truncation.protected_files}`);
      console.log(`  Truncated files: ${result.truncation.truncated_files}`);
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
      console.log('⚠️ FILE ACCOUNTING ISSUE DETECTED!');
      console.log();
      if (missingFiles.length > 0) {
        console.log(`❌ Missing files (${missingFiles.length}):`);
        missingFiles.forEach(f => console.log(`  - ${f}`));
      }
      if (extraFiles.length > 0) {
        console.log(`❌ Extra/hallucinated files (${extraFiles.length}):`);
        extraFiles.forEach(f => console.log(`  - ${f}`));
      }
    }

    // Show groups
    console.log();
    console.log('Groups:');
    result.groups?.forEach((g: any) => {
      console.log(`  📁 ${g.group_name} (${g.files.length} files)`);
    });

    if (result.ungrouped_files?.length > 0) {
      console.log(`  ❓ Ungrouped (${result.ungrouped_files.length} files)`);
    }

    // Show validation warnings
    if (result.validation_warnings?.length > 0) {
      console.log();
      console.log('Validation warnings (fuzzy matches):');
      result.validation_warnings.slice(0, 20).forEach((w: string) => {
        console.log(`  ⚠️ ${w}`);
      });
      if (result.validation_warnings.length > 20) {
        console.log(`  ... and ${result.validation_warnings.length - 20} more`);
      }
    }

  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    console.log();
    console.log(`❌ ORGANIZER FAILED after ${elapsed}ms`);
    console.log();
    console.log('Error:', error.message);

    // Check if it's the "Files not accounted for" error
    if (error.message.includes('Files not accounted for')) {
      console.log();
      console.log('🎯 REPRODUCED THE ORIGINAL ERROR!');
      console.log('The fuzzy matching should have prevented this.');
      console.log('This indicates the fuzzy matching is not working as expected,');
      console.log('OR the LLM is completely omitting files (not just mangling names).');
    }

    process.exit(1);
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

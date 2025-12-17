#!/usr/bin/env npx tsx
/**
 * Stress test to induce LLM hallucinations
 *
 * Uses realistic irregular filenames from actual archival data
 */

import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = process.env.ORGANIZER_URL || 'http://localhost:8787';

interface FileInput {
  name: string;
  type: 'text' | 'ref';
  content: string;
  original_filename?: string;
}

interface OrganizeRequest {
  directory_path: string;
  files: FileInput[];
}

// Real filename patterns from Alice Austen House archive
// These have all the irregularities that cause problems
const REAL_FILENAME_PATTERNS = [
  // Standard pattern with correspondent
  (year: string, m: string, d: string, seq: string, code: string) =>
    `${year}_${m}-${d}-${getMonthName(m)} ${seq}-${code} copy.jpg.ref.json`,

  // No correspondent (anonymous)
  (year: string, m: string, d: string, seq: string, _: string) =>
    `${year}_${m}-${d}-${getMonthName(m)} ${seq} copy.jpg.ref.json`,

  // Decimal suffixes like 1.1, 1.2, 1.3
  (year: string, m: string, d: string, seq: string, code: string) =>
    `${year}_${m}-${d}-${getMonthName(m)} ${seq.slice(0, -1)}.${seq.slice(-1)}-${code} copy.jpg.ref.json`,

  // Full name in filename
  (year: string, m: string, d: string, seq: string, code: string) =>
    `${year}_${m}-${d}-${code} ${getMonthName(m).toLowerCase()} ${d}${seq} copy.jpg.ref.json`,

  // Alice Cornell Austen pattern
  (year: string, m: string, d: string, seq: string, _: string) =>
    `${year}_${m}-${d}-Alice Cornell Austen ${getMonthName(m).toLowerCase()} ${d}${seq} copy.jpg.ref.json`,

  // Extra spaces and variations
  (year: string, m: string, d: string, seq: string, code: string) =>
    `${year}_${m}-${d}-${getMonthName(m)}  ${seq}-${code} copy.jpg.ref.json`,

  // Lowercase month
  (year: string, m: string, d: string, seq: string, code: string) =>
    `${year}_${m}-${d}-${getMonthName(m).toLowerCase()} ${seq}-${code} copy.jpg.ref.json`,
];

function getMonthName(m: string): string {
  const months: Record<string, string> = {
    '1': 'Jan', '2': 'Feb', '3': 'Mar', '4': 'Apr', '5': 'May', '6': 'Jun',
    '7': 'Jul', '8': 'Aug', '9': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dec',
  };
  return months[m] || 'Jan';
}

// Correspondents with case variations (as seen in real data)
const CORRESPONDENTS = [
  { name: 'Julia Martin', codes: ['Martin', 'martin'] },
  { name: 'Julie Bredt', codes: ['Bredt', 'bredt'] },
  { name: 'Violet Ward', codes: ['Ward', 'ward', 'Violet'] },
  { name: 'Bessie Strong', codes: ['Strong', 'strong'] },
  { name: 'Grace Hustace', codes: ['Grace', 'grace', 'Hustace'] },
  { name: 'Gertrude Eccleston', codes: ['Eccleston', 'Trude'] },
  { name: 'Annie Hedley', codes: ['Hedley', 'hedley'] },
  { name: 'E. Bruce', codes: ['Bruce', 'bruce'] },
  { name: 'Isabella King', codes: ['King', 'king'] },
  { name: 'Eva Hartnell', codes: ['Hartnell', 'hartnell'] },
  { name: 'Alice Cornell Austen', codes: ['ACA', 'aca', 'Austen'] },
  { name: 'Daisy Elliot', codes: ['Daisy', 'Elliot', 'daisy'] },
];

// Generate realistic letter content (verbose to trigger truncation)
function generateLetterContent(sender: string, pageNum: number, totalPages: number): string {
  const filler = `
I write to you on this fine day with news of our recent activities. The weather has been
most agreeable for this time of year, though we have had some rain which has kept us
indoors more than we would like. Nevertheless, I have been occupied with various pursuits
including my photography work, which continues to bring me great satisfaction.

Speaking of photography, I have been experimenting with new techniques that I believe
will yield superior results. The quality of light at this time of year is particularly
conducive to capturing excellent exposures. I have been studying the works of several
notable photographers and attempting to incorporate their methods into my own practice.

The garden requires constant attention at present. The roses are in need of pruning and
the vegetable patch demands daily care. Mother has been supervising the household staff
in their various duties while I attend to my artistic endeavors. We had visitors last
week from the city who were most complimentary about the grounds.

I must tell you of the delightful gathering we attended at the Strongs' residence. The
company was most agreeable and the conversation stimulating. We discussed matters of art,
literature, and the current state of affairs. Mrs. Strong served the most excellent
refreshments and the evening passed most pleasantly.

I do hope you will be able to visit us soon. There is much to discuss and show you.
The new photographs I have been working on are particularly fine and I am eager for
your opinion of them. Please give my regards to your family.
`.repeat(2);

  return `[Page ${pageNum} of ${totalPages}]\n\nFrom: ${sender}\n\n${filler}`;
}

// Generate a set of related files (multi-page correspondence)
function generateCorrespondenceSet(
  year: string,
  month: string,
  day: string,
  correspondent: typeof CORRESPONDENTS[0],
  pageCount: number
): FileInput[] {
  const files: FileInput[] = [];
  const baseSeq = 1000 + Math.floor(Math.random() * 9000);
  const code = correspondent.codes[Math.floor(Math.random() * correspondent.codes.length)];
  const patternFn = REAL_FILENAME_PATTERNS[Math.floor(Math.random() * REAL_FILENAME_PATTERNS.length)];

  for (let page = 1; page <= pageCount; page++) {
    const seq = String(baseSeq + page).padStart(4, '0');
    const filename = patternFn(year, month, day, seq, code);

    files.push({
      name: filename,
      type: 'ref',
      content: generateLetterContent(correspondent.name, page, pageCount),
      original_filename: filename.replace('.ref.json', ''),
    });
  }

  // Sometimes add envelope or enclosure with different naming
  if (Math.random() > 0.6) {
    const envelopePatterns = [
      `${year}_${month}-${day}-${correspondent.name} envelope ${day} ${getMonthName(month).toLowerCase()} ${year} 001 copy.jpg.ref.json`,
      `${year}_${month}-${day}-envelope-${code} copy.jpg.ref.json`,
      `${year}_${month}-${day}-${getMonthName(month)} env${baseSeq}-${code} copy.jpg.ref.json`,
    ];
    const envelope = envelopePatterns[Math.floor(Math.random() * envelopePatterns.length)];
    files.push({
      name: envelope,
      type: 'ref',
      content: `Envelope addressed to Miss Alice Austen, Clear Comfort, Staten Island. From ${correspondent.name}. Postmarked ${getMonthName(month)} ${day}, ${year}.`,
      original_filename: envelope.replace('.ref.json', ''),
    });
  }

  return files;
}

// Generate stress test data
function generateStressTestData(targetFileCount: number): OrganizeRequest {
  const files: FileInput[] = [];
  const years = ['1885', '1886', '1887', '1888', '1889', '1890', '1893', '1894', '1895', '1896', '1897'];

  while (files.length < targetFileCount) {
    const year = years[Math.floor(Math.random() * years.length)];
    const month = String(Math.floor(Math.random() * 12) + 1);
    const day = String(Math.floor(Math.random() * 28) + 1);
    const correspondent = CORRESPONDENTS[Math.floor(Math.random() * CORRESPONDENTS.length)];
    const pageCount = Math.floor(Math.random() * 5) + 2; // 2-6 pages

    const correspondenceFiles = generateCorrespondenceSet(year, month, day, correspondent, pageCount);

    for (const file of correspondenceFiles) {
      if (files.length >= targetFileCount) break;
      files.push(file);
    }
  }

  // Add text files like transcripts
  files.push({
    name: `${years[0]} transcripts.txt`,
    type: 'text',
    content: 'Collection transcripts and notes for the correspondence archive.',
  });

  files.push({
    name: `${years[0]} transcripts.docx.ref.json`,
    type: 'ref',
    content: 'Word document containing full transcriptions of all correspondence.',
    original_filename: `${years[0]} transcripts.docx`,
  });

  return {
    directory_path: '/Alice Austen House/content/stress-test',
    files,
  };
}

async function runStressTest(fileCount: number, testDir: string): Promise<{
  success: boolean;
  totalFiles: number;
  matchedFiles: number;
  missingFiles: string[];
  extraFiles: string[];
  error?: string;
}> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`STRESS TEST: ${fileCount} files`);
  console.log('='.repeat(80));

  const request = generateStressTestData(fileCount);
  const originalFilenames = request.files.map(f => f.name);

  // Save input
  const inputPath = path.join(testDir, `stress-${fileCount}-input.json`);
  fs.writeFileSync(inputPath, JSON.stringify(request, null, 2));
  console.log(`Saved input to: ${inputPath}`);

  console.log(`Generated ${request.files.length} files`);
  console.log(`Total content size: ${JSON.stringify(request).length.toLocaleString()} bytes`);

  // Show sample filenames to see the irregularity
  console.log('\nSample filenames (showing irregularity):');
  const samples = originalFilenames.filter((_, i) => i % 5 === 0).slice(0, 10);
  samples.forEach(f => console.log(`  ${f}`));
  console.log('  ...');

  const startTime = Date.now();

  try {
    const response = await fetch(`${BASE_URL}/organize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    const latency = Date.now() - startTime;

    if (!response.ok) {
      const error = await response.text();
      console.log(`\n❌ HTTP ${response.status}: ${error.slice(0, 500)}`);

      // Save error output
      const outputPath = path.join(testDir, `stress-${fileCount}-output.json`);
      fs.writeFileSync(outputPath, JSON.stringify({ error, status: response.status }, null, 2));

      return {
        success: false,
        totalFiles: fileCount,
        matchedFiles: 0,
        missingFiles: [],
        extraFiles: [],
        error: `HTTP ${response.status}: ${error.slice(0, 200)}`,
      };
    }

    const result = await response.json();

    // Save output
    const outputPath = path.join(testDir, `stress-${fileCount}-output.json`);
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log(`Saved output to: ${outputPath}`);

    console.log(`\nResponse received in ${(latency / 1000).toFixed(1)}s`);
    console.log(`Groups: ${result.groups.length}`);
    console.log(`Tokens: ${result.tokens.total.toLocaleString()} (prompt: ${result.tokens.prompt.toLocaleString()}, completion: ${result.tokens.completion.toLocaleString()})`);
    console.log(`Cost: $${result.cost_usd.toFixed(4)}`);

    if (result.truncation?.applied) {
      console.log(`\n⚠️  TRUNCATION APPLIED:`);
      console.log(`   Original tokens: ${result.truncation.total_original_tokens.toLocaleString()}`);
      console.log(`   Target tokens: ${result.truncation.target_tokens.toLocaleString()}`);
      console.log(`   Deficit: ${result.truncation.deficit.toLocaleString()}`);
      console.log(`   Truncated files: ${result.truncation.truncated_files}`);
    }

    // Collect all files from response
    const responseFiles = new Set<string>();
    result.groups.forEach((g: any) => g.files.forEach((f: string) => responseFiles.add(f)));
    result.ungrouped_files.forEach((f: string) => responseFiles.add(f));

    // Check for missing files
    const missingFiles = originalFilenames.filter(f => !responseFiles.has(f));

    // Check for extra files (hallucinations)
    const extraFiles = Array.from(responseFiles).filter(f => !originalFilenames.includes(f));

    console.log(`\n📊 RESULTS:`);
    console.log(`   Files in request: ${originalFilenames.length}`);
    console.log(`   Files in response: ${responseFiles.size}`);
    console.log(`   Missing files: ${missingFiles.length}`);
    console.log(`   Extra files (hallucinations): ${extraFiles.length}`);

    if (missingFiles.length > 0) {
      console.log(`\n❌ MISSING FILES (first 10):`);
      missingFiles.slice(0, 10).forEach(f => console.log(`   ${f}`));
      if (missingFiles.length > 10) {
        console.log(`   ... and ${missingFiles.length - 10} more`);
      }
    }

    if (extraFiles.length > 0) {
      console.log(`\n🔴 HALLUCINATED FILES (first 10):`);
      extraFiles.slice(0, 10).forEach(f => console.log(`   ${f}`));
      if (extraFiles.length > 10) {
        console.log(`   ... and ${extraFiles.length - 10} more`);
      }
    }

    const success = missingFiles.length === 0 && extraFiles.length === 0;
    console.log(`\n${success ? '✅ PASSED' : '❌ FAILED'}`);

    return {
      success,
      totalFiles: originalFilenames.length,
      matchedFiles: responseFiles.size - extraFiles.length,
      missingFiles,
      extraFiles,
    };

  } catch (error) {
    console.log(`\n❌ Error: ${error}`);

    // Save error
    const outputPath = path.join(testDir, `stress-${fileCount}-output.json`);
    fs.writeFileSync(outputPath, JSON.stringify({ error: String(error) }, null, 2));

    return {
      success: false,
      totalFiles: fileCount,
      matchedFiles: 0,
      missingFiles: [],
      extraFiles: [],
      error: String(error),
    };
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║              HALLUCINATION STRESS TEST                                     ║');
  console.log('║              (with realistic irregular filenames)                          ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');
  console.log(`\nTarget: ${BASE_URL}`);
  console.log('\nThis test uses realistic archival filenames with irregularities like:');
  console.log('  - Case variations (Strong vs strong, Bredt vs bredt)');
  console.log('  - Decimal suffixes (1.1, 1.2, 1.3)');
  console.log('  - Full names in filenames (Alice Cornell Austen)');
  console.log('  - Extra spaces and variations');
  console.log('  - Mixed patterns for same correspondent\n');

  // Create output directory
  const testDir = path.join(__dirname, 'stress-results');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }
  console.log(`Results will be saved to: ${testDir}\n`);

  // Escalating file counts
  const fileCounts = [40, 60, 80, 100];

  const results: Array<{ fileCount: number; result: Awaited<ReturnType<typeof runStressTest>> }> = [];

  for (const count of fileCounts) {
    const result = await runStressTest(count, testDir);
    results.push({ fileCount: count, result });

    // If we found issues, note the breaking point
    if (result.extraFiles.length > 0 || result.missingFiles.length > 0) {
      console.log(`\n⚠️  Found issues at ${count} files!`);
    }

    // Delay between tests
    await new Promise(r => setTimeout(r, 2000));
  }

  // Summary
  console.log('\n\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));

  console.log('\n| Files | Status | Missing | Hallucinated | Error |');
  console.log('|-------|--------|---------|--------------|-------|');
  for (const { fileCount, result } of results) {
    const status = result.success ? '✅ PASS' : '❌ FAIL';
    const error = result.error ? result.error.slice(0, 20) + '...' : '-';
    console.log(`| ${fileCount.toString().padStart(5)} | ${status} | ${result.missingFiles.length.toString().padStart(7)} | ${result.extraFiles.length.toString().padStart(12)} | ${error} |`);
  }

  const failedAt = results.find(r => !r.result.success);
  if (failedAt) {
    console.log(`\n🔴 LLM starts having issues at ${failedAt.fileCount} files`);

    // Show detailed analysis for failed case
    if (failedAt.result.extraFiles.length > 0) {
      console.log('\n📋 HALLUCINATION ANALYSIS:');
      console.log('The LLM returned these filenames that don\'t exist in the input:');
      failedAt.result.extraFiles.forEach(f => console.log(`  - ${f}`));
    }
  } else {
    console.log('\n✅ LLM handled all test cases successfully!');
  }

  console.log('\n' + '='.repeat(80));
}

main().catch(console.error);

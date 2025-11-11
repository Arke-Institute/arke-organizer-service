#!/usr/bin/env npx tsx

/**
 * Test runner for Organizer Service
 * Runs all test cases against local dev server
 */

import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = 'http://localhost:8787';
const TESTS_DIR = __dirname;

interface TestResult {
  name: string;
  success: boolean;
  groups: number;
  files: number;
  overlap: number;
  cost: number;
  tokens: number;
  latency: number;
  error?: string;
}

async function runTest(testDir: string): Promise<TestResult> {
  const testName = path.basename(testDir);
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Running: ${testName}`);
  console.log('='.repeat(80));

  const inputPath = path.join(testDir, 'input.json');
  const input = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));

  console.log(`  Directory: ${input.directory_path}`);
  console.log(`  Files: ${input.files.length}`);

  const startTime = Date.now();

  try {
    const response = await fetch(`${BASE_URL}/organize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(input)
    });

    const latency = Date.now() - startTime;

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`HTTP ${response.status}: ${error}`);
    }

    const result = await response.json();

    // Save output
    const outputPath = path.join(testDir, 'output.json');
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));

    // Calculate overlap
    const fileCounts = new Map<string, number>();
    result.groups.forEach((group: any) => {
      group.files.forEach((file: string) => {
        fileCounts.set(file, (fileCounts.get(file) || 0) + 1);
      });
    });

    const filesInMultipleGroups = Array.from(fileCounts.values()).filter((count: number) => count > 1).length;
    const overlapPercent = fileCounts.size > 0 
      ? (filesInMultipleGroups / fileCounts.size * 100)
      : 0;

    console.log(`\n  ✓ Success!`);
    console.log(`  Groups: ${result.groups.length}`);
    console.log(`  Ungrouped files: ${result.ungrouped_files.length}`);
    console.log(`  Files in multiple groups: ${filesInMultipleGroups} / ${fileCounts.size} (${overlapPercent.toFixed(1)}%)`);
    console.log(`  Tokens: ${result.tokens.total} (${result.tokens.prompt} prompt + ${result.tokens.completion} completion)`);
    console.log(`  Cost: $${result.cost_usd.toFixed(4)}`);
    console.log(`  Latency: ${(latency / 1000).toFixed(1)}s`);
    console.log(`\n  Groups created:`);
    result.groups.forEach((group: any, index: number) => {
      console.log(`    ${index + 1}. "${group.group_name}" (${group.files.length} files)`);
      console.log(`       ${group.description}`);
    });
    if (result.ungrouped_files.length > 0) {
      console.log(`\n  Ungrouped files: ${result.ungrouped_files.join(', ')}`);
    }
    console.log(`\n  Reorganization strategy:`);
    console.log(`    ${result.reorganization_description}`);

    return {
      name: testName,
      success: true,
      groups: result.groups.length,
      files: input.files.length,
      overlap: overlapPercent,
      cost: result.cost_usd,
      tokens: result.tokens.total,
      latency
    };

  } catch (error) {
    console.log(`\n  ✗ Failed: ${error}`);

    return {
      name: testName,
      success: false,
      groups: 0,
      files: input.files.length,
      overlap: 0,
      cost: 0,
      tokens: 0,
      latency: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    ORGANIZER SERVICE TEST SUITE                            ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');

  console.log('\nRunning tests against:', BASE_URL);

  // Find all test directories
  const testDirs = fs.readdirSync(TESTS_DIR)
    .filter(name => name.startsWith('test') && name !== 'run-tests.ts')
    .map(name => path.join(TESTS_DIR, name))
    .filter(dir => fs.statSync(dir).isDirectory());

  console.log(`Found ${testDirs.length} test cases\n`);

  const results: TestResult[] = [];

  for (const testDir of testDirs) {
    const result = await runTest(testDir);
    results.push(result);
  }

  // Summary
  console.log('\n\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));

  const successful = results.filter(r => r.success).length;
  console.log(`\nTests: ${successful}/${results.length} passed`);

  if (successful > 0) {
    const totalCost = results.reduce((sum, r) => sum + r.cost, 0);
    const totalTokens = results.reduce((sum, r) => sum + r.tokens, 0);
    const avgLatency = results.reduce((sum, r) => sum + r.latency, 0) / results.length;

    console.log(`\nPerformance:`);
    console.log(`  Total cost: $${totalCost.toFixed(4)}`);
    console.log(`  Total tokens: ${totalTokens.toLocaleString()}`);
    console.log(`  Average latency: ${(avgLatency / 1000).toFixed(1)}s`);

    console.log(`\nResults by test:`);
    results.forEach(r => {
      if (r.success) {
        console.log(`  ${r.name}:`);
        console.log(`    Groups: ${r.groups}, Overlap: ${r.overlap.toFixed(1)}%, Cost: $${r.cost.toFixed(4)}`);
      }
    });
  }

  // Failed tests
  const failed = results.filter(r => !r.success);
  if (failed.length > 0) {
    console.log(`\nFailed tests:`);
    failed.forEach(r => {
      console.log(`  ${r.name}: ${r.error}`);
    });
  }

  console.log('\n' + '='.repeat(80));
  console.log('All tests complete!');
  console.log('Output saved to tests/test*/output.json');
  console.log('='.repeat(80) + '\n');

  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch(console.error);

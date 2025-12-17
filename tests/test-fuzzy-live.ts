#!/usr/bin/env npx tsx
/**
 * Live test for fuzzy filename matching
 *
 * This test simulates what happens when the LLM returns filenames
 * without extensions (a common variation we've seen in production)
 */

import { validateResponse } from '../src/validation';
import type { OrganizeStructuredOutput } from '../src/types';

// The actual filenames we'd send to the LLM
const originalFilenames = [
  '1895_1-14-Jan 2001-Martin copy.jpg.ref.json',
  '1895_1-14-Jan 2002-Martin copy.jpg.ref.json',
  '1895_1-14-Jan 2003-Martin copy.jpg.ref.json',
  '1895_1-14-Jan 2004-Martin copy.jpg.ref.json',
  '1895_1-14-Jan 2005-Martin copy.jpg.ref.json',
  '1895_6-18-June 7001-martin copy.jpg.ref.json',
  '1895_6-18-June 7002-martin copy.jpg.ref.json',
  '1895_6-18-June 7003-martin copy.jpg.ref.json',
  '1895_6-18-June 7004-martin copy.jpg.ref.json',
  '1895_6-18-June 7005-martin copy.jpg.ref.json',
  '1895_1-20-Jan 1001-furbush copy.jpg.ref.json',
  '1895_1-20-Jan 1002-furbush copy.jpg.ref.json',
  '1895_1-20-Jan 1003-furbush copy.jpg.ref.json',
  '1895_1-31-T Q Browne Jr 31 Jan 1895001 copy.jpg.ref.json',
  '1895_1-31-T Q Browne Jr 31 Jan 1895002 copy.jpg.ref.json',
  '1895_1-31-T Q Browne Jr 31 Jan 1895003 copy.jpg.ref.json',
  '1895_11-7-Nov 3001-Strong copy.jpg.ref.json',
  '1895_11-7-Nov 3002-Strong copy.jpg.ref.json',
  '1895_11-7-Nov 3003-Strong copy.jpg.ref.json',
  '1895_11-7-Nov 3004-Strong copy.jpg.ref.json',
  '1895_11-7-Nov 3005-strong copy.jpg.ref.json', // Note: lowercase 'strong'
  '1895_11-27-Nov 2001-martin copy.jpg.ref.json',
  '1895_11-27-Nov 2002-martin copy.jpg.ref.json',
  '1895_11-27-Nov 2003-Martin copy.jpg.ref.json', // Note: uppercase 'Martin'
  '1895_11-27-Nov 2004-Martin copy.jpg.ref.json',
  '1895_11-27-Nov 2005-Martin copy.jpg.ref.json',
  '1895_8-15-Daisy-Unknown Sender envelope 15 july 1897 001 copy.jpg.ref.json',
];

// Simulate what the LLM might return (stripped extensions, case variations)
function simulateLLMResponse(): OrganizeStructuredOutput {
  return {
    groups: [
      {
        group_name: 'Julia_Martin_January',
        description: 'January correspondence from Julia Martin',
        files: [
          // LLM strips .ref.json
          '1895_1-14-Jan 2001-Martin copy.jpg',
          '1895_1-14-Jan 2002-Martin copy.jpg',
          '1895_1-14-Jan 2003-Martin copy.jpg',
          '1895_1-14-Jan 2004-Martin copy.jpg',
          '1895_1-14-Jan 2005-Martin copy.jpg',
        ],
      },
      {
        group_name: 'Julia_Martin_June',
        description: 'June correspondence',
        files: [
          // LLM strips .jpg.ref.json
          '1895_6-18-June 7001-martin copy',
          '1895_6-18-June 7002-martin copy',
          '1895_6-18-June 7003-martin copy',
          '1895_6-18-June 7004-martin copy',
          '1895_6-18-June 7005-martin copy',
        ],
      },
      {
        group_name: 'Furbush_Order',
        description: 'Photography supplies order',
        files: [
          // LLM changes case
          '1895_1-20-jan 1001-FURBUSH copy.jpg.ref.json',
          '1895_1-20-jan 1002-FURBUSH copy.jpg.ref.json',
          '1895_1-20-jan 1003-FURBUSH copy.jpg.ref.json',
        ],
      },
      {
        group_name: 'TQ_Browne_Legal',
        description: 'Legal correspondence',
        files: [
          // LLM strips extension and adds extra space
          '1895_1-31-T Q Browne Jr 31 Jan 1895001  copy',
          '1895_1-31-T Q Browne Jr 31 Jan 1895002  copy',
          '1895_1-31-T Q Browne Jr 31 Jan 1895003  copy',
        ],
      },
      {
        group_name: 'Strong_November',
        description: 'Strong family correspondence',
        files: [
          // Mix of exact and variations
          '1895_11-7-Nov 3001-Strong copy.jpg.ref.json',
          '1895_11-7-Nov 3002-Strong copy.jpg',
          '1895_11-7-Nov 3003-Strong copy',
          '1895_11-7-nov 3004-strong copy.jpg.ref.json', // all lowercase
          '1895_11-7-Nov 3005-strong copy.jpg.ref.json',
        ],
      },
      {
        group_name: 'Martin_November',
        description: 'November Martin correspondence',
        files: [
          '1895_11-27-Nov 2001-martin copy.jpg.ref.json',
          '1895_11-27-Nov 2002-martin copy.jpg.ref.json',
          '1895_11-27-Nov 2003-Martin copy.jpg.ref.json',
          '1895_11-27-Nov 2004-Martin copy.jpg.ref.json',
          '1895_11-27-Nov 2005-Martin copy.jpg.ref.json',
        ],
      },
      {
        group_name: 'Long_Filename_Test',
        description: 'Testing long filename with truncation',
        files: [
          // LLM might truncate very long filenames
          '1895_8-15-Daisy-Unknown Sender envelope 15 july 1897 001 copy',
        ],
      },
    ],
    ungrouped_files: [],
    reorganization_description: 'Test reorganization with various filename transformations',
  };
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║          FUZZY FILENAME MATCHING LIVE TEST                                 ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');
  console.log();
  console.log(`Testing with ${originalFilenames.length} original filenames`);
  console.log();

  const llmResponse = simulateLLMResponse();

  console.log('Simulated LLM response transformations:');
  console.log('  - Some files with .ref.json stripped');
  console.log('  - Some files with .jpg.ref.json stripped');
  console.log('  - Some files with case changes');
  console.log('  - Some files with extra whitespace');
  console.log('  - Some files truncated');
  console.log();

  try {
    console.log('Running validation with fuzzy matching...');
    console.log();

    const result = validateResponse(llmResponse, originalFilenames);

    console.log();
    console.log('✓ Validation PASSED!');
    console.log();
    console.log(`Warnings (fuzzy matches): ${result.warnings.length}`);

    if (result.warnings.length > 0) {
      console.log();
      console.log('Fuzzy match details:');
      result.warnings.forEach(w => {
        if (w.includes('fuzzy matching')) {
          console.log(`  ${w}`);
        }
      });
    }

    console.log();
    console.log('Groups in sanitized response:');
    result.sanitizedResponse.groups.forEach(g => {
      console.log(`  ${g.group_name}: ${g.files.length} files`);
    });

    // Verify all original files are accounted for
    const allFiles = new Set<string>();
    result.sanitizedResponse.groups.forEach(g => g.files.forEach(f => allFiles.add(f)));
    result.sanitizedResponse.ungrouped_files.forEach(f => allFiles.add(f));

    console.log();
    console.log(`Total files accounted for: ${allFiles.size} / ${originalFilenames.length}`);

    // Check if all original files are present
    const missing = originalFilenames.filter(f => !allFiles.has(f));
    if (missing.length > 0) {
      console.log('⚠ Missing files:', missing);
    } else {
      console.log('✓ All original filenames preserved in sanitized response');
    }

  } catch (error) {
    console.log();
    console.log('✗ Validation FAILED!');
    console.log(`Error: ${error}`);
    process.exit(1);
  }

  console.log();
  console.log('════════════════════════════════════════════════════════════════════════════');
  console.log('Test complete!');
  console.log('════════════════════════════════════════════════════════════════════════════');
}

main().catch(console.error);

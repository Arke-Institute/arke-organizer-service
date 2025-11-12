/**
 * Test script to verify progressive tax truncation with a large file set
 *
 * This creates a realistic scenario with:
 * - Multiple small files (should be protected)
 * - Some medium files (may or may not be protected)
 * - A few giant files (should be truncated proportionally)
 * - Files without content (ref files)
 *
 * Run with: npx tsx test-large-files.ts
 */

import type { OrganizeRequest } from './src/types';

// Generate large content for testing
function generateContent(sizeInChars: number): string {
  const words = [
    'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit',
    'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et', 'dolore',
    'magna', 'aliqua', 'enim', 'ad', 'minim', 'veniam', 'quis', 'nostrud', 'exercitation'
  ];

  let content = '';
  while (content.length < sizeInChars) {
    content += words[Math.floor(Math.random() * words.length)] + ' ';
  }
  return content.slice(0, sizeInChars);
}

// Create test request with various file sizes
function createLargeFileSetRequest(): OrganizeRequest {
  const files = [];

  // 10 small files (~500 chars each = ~125 tokens each = 1,250 total tokens)
  console.log('Creating 10 small files (~125 tokens each)...');
  for (let i = 1; i <= 10; i++) {
    files.push({
      name: `small-file-${i}.txt`,
      type: 'text' as const,
      content: generateContent(500),
      metadata: { size: 500 }
    });
  }

  // 5 medium files (~4,000 chars each = ~1,000 tokens each = 5,000 total tokens)
  console.log('Creating 5 medium files (~1,000 tokens each)...');
  for (let i = 1; i <= 5; i++) {
    files.push({
      name: `medium-file-${i}.txt`,
      type: 'text' as const,
      content: generateContent(4000),
      metadata: { size: 4000 }
    });
  }

  // 3 large files (~40,000 chars each = ~10,000 tokens each = 30,000 total tokens)
  console.log('Creating 3 large files (~10,000 tokens each)...');
  for (let i = 1; i <= 3; i++) {
    files.push({
      name: `large-file-${i}.txt`,
      type: 'text' as const,
      content: generateContent(40000),
      metadata: { size: 40000 }
    });
  }

  // 2 giant files (~200,000 chars each = ~50,000 tokens each = 100,000 total tokens)
  console.log('Creating 2 giant files (~50,000 tokens each)...');
  for (let i = 1; i <= 2; i++) {
    files.push({
      name: `giant-file-${i}.txt`,
      type: 'text' as const,
      content: generateContent(200000),
      metadata: { size: 200000 }
    });
  }

  // 1 MASSIVE file (~800,000 chars = ~200,000 tokens)
  console.log('Creating 1 MASSIVE file (~200,000 tokens)...');
  files.push({
    name: `massive-document.txt`,
    type: 'text' as const,
    content: generateContent(800000),
    metadata: { size: 800000 }
  });

  // 3 ref files without content
  console.log('Creating 3 ref files (no content)...');
  for (let i = 1; i <= 3; i++) {
    files.push({
      name: `image-${i}.pdf.ref.json`,
      type: 'ref' as const,
      content: '',
      original_filename: `image-${i}.pdf`,
      metadata: { mime_type: 'application/pdf', size: 500000 }
    });
  }

  const totalFiles = files.length;
  const totalChars = files.reduce((sum, f) => sum + f.content.length, 0);
  const estimatedTokens = Math.ceil(totalChars / 4);

  console.log('\n=== Test File Set Summary ===');
  console.log(`Total files: ${totalFiles}`);
  console.log(`Total characters: ${totalChars.toLocaleString()}`);
  console.log(`Estimated tokens: ${estimatedTokens.toLocaleString()}`);
  console.log(`Token budget (70% of 128k): ~${Math.floor(128000 * 0.7).toLocaleString()}`);
  console.log(`Expected deficit: ~${(estimatedTokens - Math.floor(128000 * 0.7)).toLocaleString()} tokens\n`);

  return {
    directory_path: '/test/large-file-set',
    files
  };
}

// Test against local dev server
async function testLargeFileSet() {
  console.log('=== Progressive Tax Truncation Test ===\n');

  const request = createLargeFileSetRequest();

  // Get port from command line args or use default
  const port = process.argv[2] || '8787';
  const url = `http://localhost:${port}/organize`;

  console.log(`Sending request to ${url}...\n`);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Error response:', response.status, errorText);
      return;
    }

    const result = await response.json();

    console.log('=== Response Received ===\n');
    console.log('Groups created:', result.groups?.length || 0);
    console.log('Ungrouped files:', result.ungrouped_files?.length || 0);
    console.log('\nModel:', result.model);

    if (result.tokens) {
      console.log('\n=== Token Usage ===');
      console.log('Prompt tokens:', result.tokens.prompt.toLocaleString());
      console.log('Completion tokens:', result.tokens.completion.toLocaleString());
      console.log('Total tokens:', result.tokens.total.toLocaleString());
      console.log('Cost:', `$${result.cost_usd?.toFixed(4)}`);
    }

    if (result.truncation) {
      console.log('\n=== Progressive Tax Truncation Stats ===');
      console.log('Truncation applied:', result.truncation.applied ? 'YES ✅' : 'NO');
      console.log('Total original tokens:', result.truncation.total_original_tokens.toLocaleString());
      console.log('Target token budget:', result.truncation.target_tokens.toLocaleString());
      console.log('Deficit (tokens cut):', result.truncation.deficit.toLocaleString());
      console.log('Protection mode used:', result.truncation.protection_mode_used ? 'YES' : 'NO (fallback)');
      console.log('Protected files:', result.truncation.protected_files);
      console.log('Truncated files:', result.truncation.truncated_files);

      // Verify truncation was effective
      if (result.truncation.applied) {
        console.log('\n✅ SUCCESS: Progressive tax truncation was applied!');
        console.log(`   Small files protected: ${result.truncation.protected_files}`);
        console.log(`   Large files truncated: ${result.truncation.truncated_files}`);

        if (result.truncation.protection_mode_used) {
          console.log('   Protection mode worked - small files kept fully!');
        } else {
          console.log('   Fallback mode used - all files truncated proportionally');
        }
      }
    } else {
      console.log('\n⚠️  No truncation stats found in response');
    }

    console.log('\n=== Groups ===');
    result.groups?.forEach((group: any, i: number) => {
      console.log(`${i + 1}. ${group.group_name} (${group.files.length} files)`);
      console.log(`   ${group.description}`);
    });

    if (result.ungrouped_files?.length > 0) {
      console.log('\nUngrouped files:', result.ungrouped_files.join(', '));
    }

    console.log('\n=== Test Complete ===');

  } catch (error) {
    console.error('Error making request:', error);
    console.log('\nMake sure the dev server is running: npm run dev');
  }
}

// Run the test
testLargeFileSet().catch(console.error);

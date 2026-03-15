#!/usr/bin/env node

/**
 * Comprehensive YouTube Audio Extraction Test Suite
 *
 * Tests both:
 * - Option A: Self-hosted MichaelBelgium/Youtube-API
 * - Option B: RapidAPI youtube-to-mp315 service
 */

const https = require('https');
const http = require('http');

// Test configuration
const TEST_VIDEO_ID = 'dQw4w9WgXcQ'; // Rick Astley - Never Gonna Give You Up (safe test video)
const TEST_VIDEO_URL = `https://www.youtube.com/watch?v=${TEST_VIDEO_ID}`;

// RapidAPI Configuration (you'll need to add your API key)
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || 'YOUR_RAPIDAPI_KEY_HERE';
const RAPIDAPI_HOST = 'youtube-to-mp315.p.rapidapi.com';

// Self-hosted API configuration
const SELF_HOSTED_URL = process.env.YOUTUBE_API_URL || 'http://localhost:80';

console.log('🎵 YouTube Audio Extraction API Test Suite\n');
console.log('━'.repeat(60));

/**
 * Helper: Make HTTP(S) request
 */
function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https://');
    const lib = isHttps ? https : http;

    const req = lib.get(url, options, (res) => {
      let data = '';

      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, headers: res.headers, data: json });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, data, raw: true });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout (30s)'));
    });
  });
}

/**
 * Test Option A: Self-Hosted API (MichaelBelgium/Youtube-API)
 */
async function testSelfHostedAPI() {
  console.log('\n📦 OPTION A: Self-Hosted API (MichaelBelgium/Youtube-API)');
  console.log('─'.repeat(60));

  const tests = [
    {
      name: 'Convert to MP3',
      url: `${SELF_HOSTED_URL}/convert.php?youtubelink=${encodeURIComponent(TEST_VIDEO_URL)}&format=mp3`,
      expectedFields: ['error', 'file', 'link']
    },
    {
      name: 'Search Videos',
      url: `${SELF_HOSTED_URL}/search.php?q=test&max_results=5`,
      expectedFields: ['error', 'results']
    },
    {
      name: 'Get Video Info',
      url: `${SELF_HOSTED_URL}/info.php?q=${TEST_VIDEO_ID}`,
      expectedFields: ['error', 'id', 'title', 'duration']
    }
  ];

  for (const test of tests) {
    console.log(`\n🧪 Testing: ${test.name}`);
    console.log(`   URL: ${test.url}`);

    try {
      const result = await makeRequest(test.url);

      console.log(`   ✅ Status: ${result.status}`);
      console.log(`   📊 Response:`, JSON.stringify(result.data, null, 2).substring(0, 500));

      if (result.data.error === false) {
        console.log(`   ✅ Success: No errors`);

        // Check for expected fields
        const hasExpectedFields = test.expectedFields.every(field =>
          field in result.data || (result.data.results && result.data.results.length > 0)
        );

        if (hasExpectedFields) {
          console.log(`   ✅ Has expected fields`);
        } else {
          console.log(`   ⚠️  Missing some expected fields:`, test.expectedFields);
        }

        // If it's a convert request, check if we got a download link
        if (test.name === 'Convert to MP3' && result.data.link) {
          console.log(`   🎵 Audio URL: ${result.data.link}`);

          // Test if the audio URL is accessible
          try {
            const audioTest = await makeRequest(result.data.link);
            console.log(`   ✅ Audio file accessible (${audioTest.headers['content-type']})`);
            console.log(`   📏 Size: ${audioTest.headers['content-length']} bytes`);
          } catch (e) {
            console.log(`   ❌ Audio file not accessible: ${e.message}`);
          }
        }
      } else {
        console.log(`   ❌ Error: ${result.data.message}`);
      }

    } catch (error) {
      console.log(`   ❌ Failed: ${error.message}`);

      if (error.code === 'ECONNREFUSED') {
        console.log(`   ℹ️  API not running at ${SELF_HOSTED_URL}`);
        console.log(`   ℹ️  To test this option, you need to deploy the API locally or on a server`);
      }
    }
  }
}

/**
 * Test Option B: RapidAPI Service
 */
async function testRapidAPI() {
  console.log('\n\n☁️  OPTION B: RapidAPI (youtube-to-mp315)');
  console.log('─'.repeat(60));

  if (RAPIDAPI_KEY === 'YOUR_RAPIDAPI_KEY_HERE') {
    console.log('\n⚠️  No RapidAPI key provided');
    console.log('   Set RAPIDAPI_KEY environment variable to test this option');
    console.log('   Sign up at: https://rapidapi.com/marcocollatina/api/youtube-to-mp315');
    return;
  }

  const tests = [
    {
      name: 'Get Download Link (MP3)',
      endpoint: '/dl',
      params: { id: TEST_VIDEO_ID }
    },
    {
      name: 'Get Video Info',
      endpoint: '/info',
      params: { id: TEST_VIDEO_ID }
    }
  ];

  for (const test of tests) {
    console.log(`\n🧪 Testing: ${test.name}`);

    const queryString = new URLSearchParams(test.params).toString();
    const url = `https://${RAPIDAPI_HOST}${test.endpoint}?${queryString}`;

    console.log(`   URL: ${url}`);

    try {
      const options = {
        headers: {
          'X-RapidAPI-Key': RAPIDAPI_KEY,
          'X-RapidAPI-Host': RAPIDAPI_HOST
        }
      };

      const result = await makeRequest(url, options);

      console.log(`   ✅ Status: ${result.status}`);
      console.log(`   📊 Response:`, JSON.stringify(result.data, null, 2).substring(0, 500));

      if (result.status === 200) {
        console.log(`   ✅ Success`);

        // If we got a download link, test it
        if (result.data.link || result.data.url) {
          const audioUrl = result.data.link || result.data.url;
          console.log(`   🎵 Audio URL: ${audioUrl}`);

          try {
            const audioTest = await makeRequest(audioUrl);
            console.log(`   ✅ Audio file accessible (${audioTest.headers['content-type']})`);
            console.log(`   📏 Size: ${audioTest.headers['content-length']} bytes`);
          } catch (e) {
            console.log(`   ⚠️  Could not verify audio file: ${e.message}`);
          }
        }
      } else if (result.status === 403) {
        console.log(`   ❌ Authentication failed - check your API key`);
      } else if (result.status === 429) {
        console.log(`   ❌ Rate limit exceeded`);
      } else {
        console.log(`   ❌ Error: ${result.data.message || 'Unknown error'}`);
      }

    } catch (error) {
      console.log(`   ❌ Failed: ${error.message}`);
    }
  }
}

/**
 * Performance comparison
 */
async function performanceTest() {
  console.log('\n\n⚡ PERFORMANCE COMPARISON');
  console.log('─'.repeat(60));
  console.log('\n(Testing response times for both APIs)\n');

  // Test self-hosted
  console.log('📦 Self-Hosted API:');
  const selfHostedStart = Date.now();
  try {
    await makeRequest(`${SELF_HOSTED_URL}/info.php?q=${TEST_VIDEO_ID}`);
    const selfHostedTime = Date.now() - selfHostedStart;
    console.log(`   ⏱️  Response time: ${selfHostedTime}ms`);
  } catch (e) {
    console.log(`   ❌ Not available`);
  }

  // Test RapidAPI
  if (RAPIDAPI_KEY !== 'YOUR_RAPIDAPI_KEY_HERE') {
    console.log('\n☁️  RapidAPI:');
    const rapidStart = Date.now();
    try {
      await makeRequest(
        `https://${RAPIDAPI_HOST}/info?id=${TEST_VIDEO_ID}`,
        {
          headers: {
            'X-RapidAPI-Key': RAPIDAPI_KEY,
            'X-RapidAPI-Host': RAPIDAPI_HOST
          }
        }
      );
      const rapidTime = Date.now() - rapidStart;
      console.log(`   ⏱️  Response time: ${rapidTime}ms`);
    } catch (e) {
      console.log(`   ❌ Error: ${e.message}`);
    }
  }
}

/**
 * Main test runner
 */
async function runTests() {
  try {
    await testSelfHostedAPI();
    await testRapidAPI();
    await performanceTest();

    console.log('\n\n' + '━'.repeat(60));
    console.log('📝 SUMMARY & RECOMMENDATIONS');
    console.log('━'.repeat(60));
    console.log('\n✅ Option A (Self-Hosted):');
    console.log('   - Full control over infrastructure');
    console.log('   - Zero ongoing API costs');
    console.log('   - Requires server setup & maintenance');
    console.log('   - May face YouTube blocking (datacenter IPs)');
    console.log('   - Can add residential proxy rotation ($50-200/mo)');

    console.log('\n✅ Option B (RapidAPI):');
    console.log('   - No infrastructure to maintain');
    console.log('   - They handle YouTube blocking');
    console.log('   - ~$10-200/mo depending on usage');
    console.log('   - Higher latency (cloud service)');
    console.log('   - Most reliable for production');

    console.log('\n💡 Recommendation:');
    console.log('   Start with RapidAPI ($50/mo tier) for reliability,');
    console.log('   then migrate to self-hosted + proxies if scaling costs');
    console.log('\n');

  } catch (error) {
    console.error('\n❌ Test suite failed:', error);
    process.exit(1);
  }
}

// Run tests
runTests().catch(console.error);

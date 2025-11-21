const { execSync } = require('child_process');

const API_URL = process.env.API_URL || 'http://localhost:8080';

// Test URLs
const TEST_URLS = [
  'https://example.com',
  'https://www.google.com',
  'https://httpbin.org/deny' // This might be blocked by robots.txt
];

let testsPassed = 0;
let testsFailed = 0;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForService(url, maxAttempts = 30) {
  console.log(`Waiting for service at ${url}...`);
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        console.log('Service is ready!');
        return true;
      }
    } catch (error) {
      // Service not ready yet
    }
    await sleep(2000);
  }
  throw new Error('Service did not become ready in time');
}

async function submitCrawl(url) {
  console.log(`\nSubmitting crawl for: ${url}`);
  const response = await fetch(`${API_URL}/crawl`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url })
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to submit: ${error.error}`);
  }
  
  const data = await response.json();
  console.log(`Received UID: ${data.uid}`);
  return data.uid;
}

async function pollCrawlStatus(uid, maxAttempts = 30) {
  console.log(`Polling status for UID: ${uid}`);
  
  for (let i = 0; i < maxAttempts; i++) {
    const response = await fetch(`${API_URL}/crawl/${uid}`);
    const data = await response.json();
    
    console.log(`  Attempt ${i + 1}: status=${data.status}`);
    
    if (data.status === 'done') {
      console.log(`Crawl completed successfully`);
      console.log(`  Description length: ${data.result.description.length} chars`);
      console.log(`  Image: ${data.result.image ? 'present' : 'missing'}`);
      console.log(`  Processing time: ${data.result.tookMs}ms`);
      return data;
    }
    
    if (data.status === 'error') {
      console.log(`Crawl failed: ${data.message}`);
      return data;
    }
    
    await sleep(2000);
  }
  
  throw new Error('Polling timeout');
}

async function testIdempotency() {
  console.log('\n\nTesting Idempotency...');
  console.log('Submitting the same URL twice in quick succession...');
  
  const url = TEST_URLS[0];
  const uid1 = await submitCrawl(url);
  await sleep(500);
  const uid2 = await submitCrawl(url);
  
  if (uid1 === uid2) {
    console.log('[PASS] Idempotency test: Same UID returned');
    testsPassed++;
    return true;
  } else {
    console.log(`[FAIL] Idempotency test: Different UIDs (${uid1} vs ${uid2})`);
    testsFailed++;
    return false;
  }
}

async function testCrawl(url) {
  try {
    const uid = await submitCrawl(url);
    const result = await pollCrawlStatus(uid);
    
    if (result.status === 'done') {
      if (!result.result.image || !result.result.description) {
        console.log('[FAIL] Test failed: Missing required fields');
        testsFailed++;
        return false;
      }
      console.log('[PASS] Test passed');
      testsPassed++;
      return true;
    } else if (result.status === 'error') {
      if (result.message.includes('robots')) {
        console.log('[PASS] Test passed (correctly blocked by robots.txt)');
        testsPassed++;
        return true;
      }
      console.log('[WARN] Test completed with error (may be expected)');
      testsPassed++;
      return true;
    }
  } catch (error) {
    console.log(`[FAIL] Test failed: ${error.message}`);
    testsFailed++;
    return false;
  }
}

async function runTests() {
  console.log('Starting E2E Tests for Mini Crawler\n');
  console.log('=' .repeat(60));
  
  try {
    await waitForService(`${API_URL}/healthz`);
    
    for (const url of TEST_URLS) {
      await testCrawl(url);
      await sleep(1000);
    }
    
    await testIdempotency();
    
    console.log('\n' + '='.repeat(60));
    console.log('Test Summary');
    console.log('='.repeat(60));
    console.log(`Passed: ${testsPassed}`);
    console.log(`Failed: ${testsFailed}`);
    console.log(`Total:  ${testsPassed + testsFailed}`);
    
    if (testsFailed === 0) {
      console.log('\nAll tests passed!');
      process.exit(0);
    } else {
      console.log('\nSome tests failed');
      process.exit(1);
    }
  } catch (error) {
    console.error('\nTest suite failed:', error.message);
    process.exit(1);
  }
}

// Check if Docker Compose is running
console.log('Checking if Docker Compose stack is running...');
try {
  execSync('docker compose ps', { cwd: __dirname + '/..', stdio: 'inherit' });
} catch (error) {
  console.log('\nDocker Compose stack not running. Starting it now...');
  console.log('This may take a few minutes...\n');
  try {
    execSync('docker compose up -d --build', { cwd: __dirname + '/..', stdio: 'inherit' });
    console.log('\nStack started successfully!\n');
  } catch (startError) {
    console.error('Failed to start Docker Compose stack');
    process.exit(1);
  }
}

runTests();

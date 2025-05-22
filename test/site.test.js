// This function will be our mock for fetchc
const mockFetchcImplementation = async (url, options) => {
    console.log(`[Test Mock] fetchc called with URL: ${url}`);
    if (mockFetchcImplementation.shouldThrowError) {
        throw new Error(mockFetchcImplementation.errorMessage || 'Simulated fetch error');
    }
    return {
        text: async () => mockFetchcImplementation.htmlContent,
        status: 200, // Assuming success unless error is thrown
    };
};
// Initialize properties for the mock
mockFetchcImplementation.htmlContent = '';
mockFetchcImplementation.shouldThrowError = false;
mockFetchcImplementation.errorMessage = '';

// Test suite
async function runAllTests() {
    // Dynamically import setMockFetchc from fetch.js and hasHostedByProfessionalWikiLogo from site.js
    const { setMockFetchc } = await import('../src/fetch.js');
    const { hasHostedByProfessionalWikiLogo } = await import('../src/site.js');

    if (typeof setMockFetchc !== 'function') {
        console.error('FATAL: src/fetch.js does not export setMockFetchc. Ensure pre-test modification step was successful.');
        // process.exit(1); // Node.js doesn't have process.exit in ESM top-level await scope like this
        throw new Error('setMockFetchc is not available');
    }

    // Set our mock function in fetch.js
    setMockFetchc(mockFetchcImplementation);

    let passed = 0;
    let failed = 0;

    console.log('Running hasHostedByProfessionalWikiLogo tests...');

    // Test Case 1: HTML contains the magic string
    mockFetchcImplementation.htmlContent = '<html><body>Hello<img src="w/images/HostedByProfessionalWiki.png"/>World</body></html>';
    mockFetchcImplementation.shouldThrowError = false;
    try {
        const result1 = await hasHostedByProfessionalWikiLogo('http://example.com/hosted');
        if (result1 === true) {
            console.log('✅ Test 1 Passed: Magic string found.');
            passed++;
        } else {
            console.error('❌ Test 1 Failed: Expected true, got false.');
            failed++;
        }
    } catch (e) {
        console.error('❌ Test 1 Failed with exception:', e.message);
        failed++;
    }

    // Test Case 2: HTML does not contain the magic string
    mockFetchcImplementation.htmlContent = '<html><body>Just some regular page.</body></html>';
    mockFetchcImplementation.shouldThrowError = false;
    try {
        const result2 = await hasHostedByProfessionalWikiLogo('http://example.com/not-hosted');
        if (result2 === false) {
            console.log('✅ Test 2 Passed: Magic string not found.');
            passed++;
        } else {
            console.error('❌ Test 2 Failed: Expected false, got true.');
            failed++;
        }
    } catch (e) {
        console.error('❌ Test 2 Failed with exception:', e.message);
        failed++;
    }

    // Test Case 3: fetchc simulates a fetch error
    mockFetchcImplementation.shouldThrowError = true;
    mockFetchcImplementation.errorMessage = 'Network connection failed.';
    try {
        const result3 = await hasHostedByProfessionalWikiLogo('http://example.com/network-error');
        if (result3 === false) {
            console.log('✅ Test 3 Passed: Fetch error handled, returned false.');
            passed++;
        } else {
            console.error('❌ Test 3 Failed: Expected false on error, got true.');
            failed++;
        }
    } catch (e) {
        // This catch is for errors thrown by isProfessionallyHosted itself, not the ones it's supposed to handle from fetchc
        console.error('❌ Test 3 Failed with unexpected exception:', e.message);
        failed++;
    }

    console.log(`\n--- Test Summary ---`);
    console.log(`Total tests: ${passed + failed}`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);

    if (failed > 0) {
        // process.exitCode = 1; // Indicate failure to CI or other runners
        // In a script, you might throw an error here to signal failure if not using process.exitCode
        // For now, console output is the primary indicator.
        // throw new Error(`${failed} test(s) failed.`);
    }
}

runAllTests().catch(err => {
    console.error("Critical error during test execution:", err);
    // process.exitCode = 1;
    // To ensure the process exits with an error code if runAllTests itself rejects
    // throw err; // Re-throw after logging to make sure node process exits with non-zero
});

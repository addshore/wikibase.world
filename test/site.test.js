/* eslint-env mocha */
/* global describe, it, beforeEach */
import { expect } from 'chai';
import { setMockFetchc } from '../src/fetch.js';
import { hasHostedByProfessionalWikiLogo, checkOnlineAndWikibase } from '../src/site.js';

describe('checkOnlineAndWikibase', function () {
    const mockFetchcImplementation = async (url, options) => {
        if (mockFetchcImplementation.shouldThrowError) {
            throw new Error(mockFetchcImplementation.errorMessage || 'Simulated fetch error');
        }

        if (options && options.method === 'HEAD') {
            return {
                status: mockFetchcImplementation.headStatus || 200,
                headers: {
                    get: (name) => {
                        if (name.toLowerCase() === 'link') {
                            return mockFetchcImplementation.linkHeader || null;
                        }
                        return null;
                    }
                }
            };
        }

        if (url.includes('Special:Version')) {
            return {
                status: 200,
                text: async () => 'mw-version-ext-wikibase-WikibaseRepository'
            }
        }

        return {
            status: mockFetchcImplementation.status || 200,
            text: async () => mockFetchcImplementation.htmlContent,
            headers: {
                get: () => null
            }
        };
    };

    beforeEach(() => {
        mockFetchcImplementation.htmlContent = '';
        mockFetchcImplementation.shouldThrowError = false;
        mockFetchcImplementation.errorMessage = '';
        mockFetchcImplementation.headStatus = 200;
        mockFetchcImplementation.status = 200;
        mockFetchcImplementation.linkHeader = null;
        setMockFetchc(mockFetchcImplementation);
    });

    it('successfully validates via HEAD request with Link header', async function () {
        mockFetchcImplementation.linkHeader = '<https://example.com/w/api.php>; rel="EditURI"';
        const result = await checkOnlineAndWikibase('https://example.com');
        expect(result.result).to.not.be.false;
        expect(result.text).to.equal('https://example.com');
    });

    it('falls back to GET if HEAD has no Link header', async function () {
        mockFetchcImplementation.linkHeader = null;
        mockFetchcImplementation.htmlContent = '<html><head><link rel="EditURI" type="application/rsd+xml" href="https://example.com/w/api.php?action=rsd" /></head><body>MediaWiki</body></html>';
        const result = await checkOnlineAndWikibase('https://example.com');
        expect(result.result).to.not.be.false;
        expect(result.text).to.equal('https://example.com');
    });

    it('fails if neither HEAD nor GET provide EditURI', async function () {
        mockFetchcImplementation.linkHeader = null;
        mockFetchcImplementation.htmlContent = '<html><body>Not a wiki</body></html>';
        const result = await checkOnlineAndWikibase('https://example.com');
        expect(result.result).to.be.false;
        expect(result.text).to.contain('does not have a correct EditURI');
    });
});

describe('hasHostedByProfessionalWikiLogo', function () {
    // This function will be our mock for fetchc
    const mockFetchcImplementation = async () => {
        if (mockFetchcImplementation.shouldThrowError) {
            throw new Error(mockFetchcImplementation.errorMessage || 'Simulated fetch error');
        }
        return {
            text: async () => mockFetchcImplementation.htmlContent,
            status: 200,
        };
    };
    // Initialize properties for the mock
    beforeEach(() => {
        mockFetchcImplementation.htmlContent = '';
        mockFetchcImplementation.shouldThrowError = false;
        mockFetchcImplementation.errorMessage = '';
        setMockFetchc(mockFetchcImplementation);
    });

    it('returns true if the HTML contains the magic string', async function () {
        mockFetchcImplementation.htmlContent = '<html><body>Hello<img src="w/images/HostedByProfessionalWiki.png"/>World</body></html>';
        const result = await hasHostedByProfessionalWikiLogo('http://example.com/hosted');
        expect(result).to.be.true;
    });

    it('returns false if the HTML does not contain the magic string', async function () {
        mockFetchcImplementation.htmlContent = '<html><body>Just some regular page.</body></html>';
        const result = await hasHostedByProfessionalWikiLogo('http://example.com/not-hosted');
        expect(result).to.be.false;
    });

    it('returns false if fetchc throws an error', async function () {
        mockFetchcImplementation.shouldThrowError = true;
        mockFetchcImplementation.errorMessage = 'Network connection failed.';
        const result = await hasHostedByProfessionalWikiLogo('http://example.com/network-error');
        expect(result).to.be.false;
    });
});

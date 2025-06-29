/* eslint-env mocha */
/* global describe, it, beforeEach */
import { expect } from 'chai';
import { setMockFetchc } from '../src/fetch.js';
import { hasHostedByProfessionalWikiLogo } from '../src/site.js';

describe('hasHostedByProfessionalWikiLogo', function () {
    // This function will be our mock for fetchc
    const mockFetchcImplementation = async (url) => {
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

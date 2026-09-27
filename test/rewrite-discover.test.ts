import { expect } from 'chai';
import { describe, it } from 'node:test';
import { discoverWikis } from '../src/rewrite/discover.js';
import type { WikiCandidate } from '../src/rewrite/model.js';

describe('discoverWikis', () => {
    const candidate = (site: string): WikiCandidate => ({ source: 'test', site });

    it('plans validated new wikis without writing by default', async () => {
        let writes = 0;
        const results = await discoverWikis({
            candidates: [candidate('https://new.example/')],
            knownWikis: [],
            verifier: { verify: async site => ({ site }) },
            writer: { create: async () => { writes++; return 'Q1'; } },
        });

        expect(results.map(result => result.status)).to.deep.equal(['planned']);
        expect(writes).to.equal(0);
    });

    it('recognizes existing sites regardless of scheme and trailing slash', async () => {
        let validations = 0;
        const results = await discoverWikis({
            candidates: [candidate('https://known.example/wiki/')],
            knownWikis: [{ item: 'Q1', site: 'http://known.example/wiki' }],
            verifier: { verify: async site => { validations++; return { site }; } },
            writer: { create: async () => { throw new Error('should not write'); } },
        });

        expect(results[0].status).to.equal('existing');
        expect(results[0].item).to.equal('Q1');
        expect(validations).to.equal(0);
    });

    it('deduplicates candidates that resolve to the same canonical site', async () => {
        let writes = 0;
        const results = await discoverWikis({
            candidates: [
                candidate('https://alias.example/'),
                candidate('https://new.example'),
            ],
            knownWikis: [],
            verifier: {
                verify: async () => ({ site: 'https://new.example/' }),
            },
            writer: { create: async () => { writes++; return 'Q1'; } },
            dryRun: false,
        });

        expect(results.map(result => result.status)).to.deep.equal(['created', 'duplicate']);
        expect(results[0].item).to.equal('Q1');
        expect(writes).to.equal(1);
    });

    it('does not turn verifier failures into success-shaped results', async () => {
        const failure = new Error('verification failed');
        try {
            await discoverWikis({
                candidates: [candidate('https://new.example')],
                knownWikis: [],
                verifier: { verify: async () => { throw failure; } },
                writer: { create: async () => 'Q1' },
            });
            expect.fail('expected discovery to reject');
        } catch (error) {
            expect(error).to.equal(failure);
        }
    });

    it('does not turn write failures into success-shaped results', async () => {
        const failure = new Error('write failed');
        try {
            await discoverWikis({
                candidates: [candidate('https://new.example')],
                knownWikis: [],
                verifier: { verify: async site => ({ site }) },
                writer: { create: async () => { throw failure; } },
                dryRun: false,
            });
            expect.fail('expected write to reject');
        } catch (error) {
            expect(error).to.equal(failure);
        }
    });

    it('marks rejected candidates as invalid', async () => {
        const results = await discoverWikis({
            candidates: [candidate('https://not-a-wiki.example')],
            knownWikis: [],
            verifier: { verify: async () => null },
            writer: { create: async () => 'Q1' },
        });

        expect(results[0].status).to.equal('invalid');
    });

    it('marks malformed candidate URLs as invalid without calling the verifier', async () => {
        let validations = 0;
        const results = await discoverWikis({
            candidates: [candidate('not a URL')],
            knownWikis: [],
            verifier: { verify: async site => { validations++; return { site }; } },
            writer: { create: async () => 'Q1' },
        });

        expect(results[0].status).to.equal('invalid');
        expect(validations).to.equal(0);
    });

    it('rejects non-HTTP URLs as invalid candidates', async () => {
        const results = await discoverWikis({
            candidates: [candidate('ftp://files.example/wiki')],
            knownWikis: [],
            verifier: { verify: async site => ({ site }) },
            writer: { create: async () => 'Q1' },
        });

        expect(results[0].status).to.equal('invalid');
    });

    it('recognizes a verified redirect to a known site', async () => {
        let writes = 0;
        const results = await discoverWikis({
            candidates: [candidate('https://redirect.example')],
            knownWikis: [{ item: 'Q2', site: 'https://known.example/' }],
            verifier: { verify: async () => ({ site: 'http://known.example' }) },
            writer: { create: async () => { writes++; return 'Q1'; } },
            dryRun: false,
        });

        expect(results[0].status).to.equal('existing');
        expect(writes).to.equal(0);
    });

    it('updates site-based claims when verification canonicalizes the site URL', async () => {
        const results = await discoverWikis({
            candidates: [{
                ...candidate('https://old.example'),
                claims: {
                    P1: 'https://old.example',
                    P49: 'https://old.example/wiki/Main_Page',
                    P53: 'https://other.example/data',
                },
            }],
            knownWikis: [],
            verifier: { verify: async () => ({ site: 'https://new.example' }) },
            writer: { create: async () => 'Q1' },
        });

        expect(results[0].candidate.claims).to.deep.equal({
            P1: 'https://new.example',
            P49: 'https://new.example/wiki/Main_Page',
            P53: 'https://other.example/data',
        });
    });
});

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { createGoogleSearchSource } from '../src/rewrite/sources/google.js';

describe('Google search source adapter', () => {
    it('filters ignored domains and maps distinct eligible hosts to candidates', async () => {
        let query = '';
        const source = createGoogleSearchSource({
            apiKey: 'test-key',
            search: async options => {
                query = options.q;
                return {
                    organic_results: [
                        { link: 'https://catalog.example/wiki/Special:NewItem' },
                        { link: 'https://sub.catalog.example/wiki/Special:NewItem' },
                        { link: 'https://wikibase.cloud/wiki/Special:NewItem' },
                        { link: 'not a URL' },
                    ],
                };
            },
        });

        const candidates = await source.discover();

        assert.equal(candidates.length, 2);
        assert.equal(candidates[0].site, 'https://catalog.example');
        assert.equal(candidates[1].site, 'https://sub.catalog.example');
        assert.equal(candidates[0].claims?.P3, 'Q10');
        assert.equal(query.includes('"Special:NewItem"'), true);
        assert.equal(query.includes('-site:wikibase.cloud'), true);
    });

    it('surfaces missing keys and search failures', async () => {
        const missingKeySource = createGoogleSearchSource({
            search: async () => ({ organic_results: [] }),
        });
        await assert.rejects(missingKeySource.discover(), /SERPAPI_KEY is required/);

        const failingSource = createGoogleSearchSource({
            apiKey: 'test-key',
            search: async () => ({ error: 'quota exceeded' }),
        });
        await assert.rejects(failingSource.discover(), /quota exceeded/);
    });
});

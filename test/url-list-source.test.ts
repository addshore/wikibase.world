import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { createUrlListSource } from '../src/rewrite/sources/url-list.js';

describe('URL list source adapter', () => {
    it('normalizes bare hosts and deduplicates equivalent URLs', async () => {
        const source = createUrlListSource([
            'example.test',
            'https://example.test/',
            'http://second.example.test/wiki#section',
        ], { hostItem: 'Q8' });

        const candidates = await source.discover();

        assert.equal(candidates.length, 2);
        assert.equal(candidates[0].site, 'https://example.test');
        assert.equal(candidates[0].claims?.P2, 'Q8');
        assert.equal(candidates[1].site, 'http://second.example.test/wiki');
    });

    it('reports malformed list entries clearly', async () => {
        const source = createUrlListSource(['https://valid.example', 'file:///invalid']);
        await assert.rejects(source.discover(), /Invalid URL list entry "file:\/\/\/invalid"/);
    });
});

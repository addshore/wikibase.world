import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { createMirahezeSource } from '../src/rewrite/sources/miraheze.js';

describe('Miraheze source adapter', () => {
    it('deduplicates database entries and maps redirects and banner status', async () => {
        const requests: string[] = [];
        const source = createMirahezeSource({
            endpoint: 'https://lists.example/miraheze.php',
            concurrency: 2,
            fetch: async (input) => {
                const url = input.toString();
                requests.push(url);
                if (url === 'https://lists.example/miraheze.php') {
                    return new Response("'alphawiki' => 1,\n'betawiki' => 1,\n'alphaWiki' => 1,");
                }
                if (url === 'https://alpha.miraheze.org') {
                    return new Response('home');
                }
                if (url === 'https://beta.miraheze.org') {
                    const response = new Response('home');
                    Object.defineProperty(response, 'url', { value: 'https://renamed.miraheze.org/' });
                    return response;
                }
                if (url.includes('alpha.miraheze.org/wiki/Main_Page')) {
                    return new Response('<title>Wiki deleted</title>');
                }
                return new Response('active wiki');
            },
        });

        const candidates = await source.discover();
        const alpha = candidates.find(candidate => candidate.site === 'https://alpha.miraheze.org');
        const renamed = candidates.find(candidate => candidate.site === 'https://renamed.miraheze.org');

        assert.equal(candidates.length, 2);
        assert.equal(alpha?.claims?.P13, 'Q57');
        assert.deepEqual(renamed?.aliases, ['beta.miraheze.org']);
        assert.equal(renamed?.claims?.P13, 'Q54');
        assert.equal(requests.filter(url => url === 'https://alpha.miraheze.org').length, 1);
    });

    it('rejects failed list retrievals and invalid concurrency', async () => {
        const source = createMirahezeSource({
            fetch: async () => new Response('unavailable', { status: 503 }),
        });
        await assert.rejects(source.discover(), /HTTP 503/);
        assert.throws(() => createMirahezeSource({ concurrency: 0 }), /positive safe integer/);
    });
});

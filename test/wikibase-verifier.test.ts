import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { createWikibaseVerifier } from '../src/rewrite/verifier.js';

describe('Wikibase verifier', () => {
    it('uses the EditURI header and confirms the Wikibase repository extension', async () => {
        const requested: URL[] = [];
        const verifier = createWikibaseVerifier({
            fetch: async (input, init) => {
                const url = new URL(input.toString());
                requested.push(url);
                if (init?.method === 'HEAD') {
                    const response = new Response(null, {
                        status: 200,
                        headers: { Link: '<https://example.test/w/api.php?action=rsd>; rel="EditURI"' },
                    });
                    Object.defineProperty(response, 'url', { value: 'https://example.test/wiki/Main_Page' });
                    return response;
                }
                return new Response('mw-version-ext-wikibase-WikibaseRepository');
            },
        });

        assert.deepEqual(await verifier.verify('https://example.test/'), {
            site: 'https://example.test',
        });
        assert.equal(requested.length, 2);
        assert.equal(requested[1].pathname, '/w/index.php');
        assert.equal(requested[1].searchParams.get('title'), 'Special:Version');
    });

    it('falls back to the page EditURI when HEAD does not provide one', async () => {
        const requested: URL[] = [];
        const verifier = createWikibaseVerifier({
            fetch: async (input, init) => {
                requested.push(new URL(input.toString()));
                if (init?.method === 'HEAD') return new Response(null, { status: 405 });
                if (requested.length === 2) {
                    return new Response(
                        '<link rel="EditURI" type="application/rsd+xml" href="/w/api.php?action=rsd">',
                    );
                }
                return new Response('mw-version-ext-wikibase-WikibaseRepository');
            },
        });

        assert.equal((await verifier.verify('https://example.test'))?.site, 'https://example.test');
        assert.equal(requested.length, 3);
    });

    it('rejects non-Wikibase pages and non-HTTP URLs', async () => {
        const verifier = createWikibaseVerifier({
            fetch: async () => new Response('MediaWiki, but no Wikibase'),
        });

        assert.equal(await verifier.verify('ftp://example.test'), null);
        assert.equal(await verifier.verify('https://example.test'), null);
    });
});

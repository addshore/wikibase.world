import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { createWikibaseCloudSource } from '../src/rewrite/sources/cloud.js';

describe('wikibase.cloud source adapter', () => {
    it('paginates the API and maps source metadata to candidate claims', async () => {
        const requests: URL[] = [];
        const source = createWikibaseCloudSource({
            endpoint: 'https://cloud.example/api/wiki',
            perPage: 2,
            fetch: async input => {
                const url = new URL(input.toString());
                requests.push(url);
                const page = Number(url.searchParams.get('page'));
                const body = page === 1
                    ? {
                        data: [
                            { id: 4, domain: 'named.example', sitename: 'Named wiki' },
                            { id: 3, domain: 'test2.example', sitename: 'test2' },
                        ],
                        meta: { last_page: 2 },
                    }
                    : {
                        data: [{ id: 2, domain: 'plain.example', sitename: 'Plain wiki' }],
                        meta: { last_page: 2 },
                    };

                return Response.json(body);
            },
        });

        const candidates = await source.discover();

        assert.deepEqual(requests.map(url => url.searchParams.get('page')), ['1', '2']);
        assert.deepEqual(candidates.map(candidate => candidate.site), [
            'https://named.example',
            'https://test2.example',
            'https://plain.example',
        ]);
        assert.equal(candidates[0].label, 'Named wiki');
        assert.deepEqual(candidates[0].aliases, ['named.example']);
        assert.deepEqual(candidates[0].claims, {
            P1: 'https://named.example',
            P2: 'Q8',
            P3: 'Q10',
            P13: 'Q54',
            P49: 'https://named.example/wiki/Main_Page',
            P54: '4',
        });
        assert.equal(candidates[1].label, 'test2.example');
        assert.equal(candidates[1].aliases, undefined);
    });

    it('rejects failed API responses instead of treating them as an empty list', async () => {
        const source = createWikibaseCloudSource({
            fetch: async () => new Response('unavailable', { status: 503 }),
        });

        await assert.rejects(source.discover(), /HTTP 503/);
    });

    it('rejects malformed entries and invalid page sizes', async () => {
        const source = createWikibaseCloudSource({
            fetch: async () => Response.json({ data: [{ id: 'bad', domain: '' }] }),
        });

        await assert.rejects(source.discover(), /invalid wiki list/);
        assert.throws(() => createWikibaseCloudSource({ perPage: 0 }), /positive safe integer/);
    });

    it('rejects incomplete pagination rather than treating it as a complete source list', async () => {
        const missingMetadata = createWikibaseCloudSource({
            fetch: async () => Response.json({ data: [] }),
        });
        await assert.rejects(missingMetadata.discover(), /invalid wiki list/);

        const emptyPage = createWikibaseCloudSource({
            perPage: 1,
            fetch: async input => {
                const page = new URL(input.toString()).searchParams.get('page');
                return Response.json({
                    data: page === '1' ? [{ id: 1, domain: 'one.example' }] : [],
                    meta: { last_page: 2 },
                });
            },
        });
        await assert.rejects(emptyPage.discover(), /page 2 was unexpectedly empty/);
    });

    it('marks missing Cloud-hosted wikis offline without touching other hosts', async () => {
        const source = createWikibaseCloudSource();
        const updates = source.syncMissing?.([
            { item: 'Q1', site: 'https://gone.wikibase.cloud', hostItem: 'Q8', statusItem: 'Q54' },
            { item: 'Q2', site: 'https://known.wikibase.cloud/wiki/Main_Page', hostItem: 'Q8' },
            { item: 'Q3', site: 'https://gone.wikibase.cloud', hostItem: 'Q8', statusItem: 'Q57' },
            { item: 'Q4', site: 'https://other.example', hostItem: 'Q7' },
        ], [{
            source: 'wikibase.cloud',
            site: 'https://known.wikibase.cloud',
        }]);

        assert.deepEqual(updates, [{
            item: 'Q1',
            site: 'https://gone.wikibase.cloud',
            source: 'wikibase.cloud API',
            property: 'P13',
            value: 'Q57',
            policy: 'single',
        }]);

        assert.deepEqual(source.syncMissing?.([
            { item: 'Q1', site: 'https://gone.wikibase.cloud', hostItem: 'Q8', statusItem: 'Q54' },
        ], []), []);
    });
});

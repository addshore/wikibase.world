import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
    fetchExternalLinkDomains,
    planWikiLinkSyncs,
} from '../src/rewrite/external-links.js';

describe('external wiki links', () => {
    it('paginates external URL usage and excludes internal or ignored domains', async () => {
        const calls: URL[] = [];
        const result = await fetchExternalLinkDomains(new URL('https://wiki.example/api.php'), {
            fetch: async input => {
                const url = new URL(input.toString());
                calls.push(url);
                return calls.length === 1
                    ? Response.json({
                        query: {
                            exturlusage: [
                                { url: 'https://Target.Example/wiki/Q1' },
                                { url: '//commons.wikimedia.org/wiki/File:One' },
                                { url: 'not a URL' },
                            ],
                        },
                        continue: { eucontinue: 'next', continue: '||' },
                    })
                    : Response.json({
                        query: {
                            exturlusage: [
                                { url: 'https://target.example/item/Q2' },
                                { url: 'https://another.example/page' },
                            ],
                        },
                    });
            },
        });

        assert.equal(result.truncated, false);
        assert.deepEqual(result.domains.sort(), ['another.example', 'target.example']);
        assert.equal(calls.length, 2);
        assert.equal(calls[1].searchParams.get('eucontinue'), 'next');
    });

    it('reports truncated scans and rejects API failures', async () => {
        const truncated = await fetchExternalLinkDomains(new URL('https://wiki.example/api.php'), {
            maxIterations: 1,
            fetch: async () => Response.json({
                query: { exturlusage: [] },
                continue: { eucontinue: 'next' },
            }),
        });
        assert.deepEqual(truncated, { domains: [], truncated: true });

        await assert.rejects(
            fetchExternalLinkDomains(new URL('https://wiki.example/api.php'), {
                fetch: async () => new Response('failed', { status: 503 }),
            }),
            /HTTP 503/,
        );
    });

    it('plans outgoing and incoming links without self-links or special source items', () => {
        const source = { item: 'Q1', site: 'https://source.example' };
        const wikis = [
            source,
            { item: 'Q2', site: 'https://target.example/wiki/Main_Page' },
            { item: 'Q3', site: 'https://target.example/another/path' },
            { item: 'Q4', site: 'https://unmatched.example' },
        ];

        assert.deepEqual(planWikiLinkSyncs(source, ['TARGET.example'], wikis), [
            { item: 'Q1', property: 'P55', value: 'Q2' },
            { item: 'Q2', property: 'P56', value: 'Q1' },
            { item: 'Q1', property: 'P55', value: 'Q3' },
            { item: 'Q3', property: 'P56', value: 'Q1' },
        ]);
        assert.deepEqual(
            planWikiLinkSyncs({ item: 'Q3', site: 'https://special.example' }, ['target.example'], wikis),
            [],
        );
    });
});

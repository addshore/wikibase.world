import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { planHostClaimSyncs } from '../src/rewrite/host-detection.js';

describe('wiki host detection', () => {
    it('plans wikibase.cloud host, endpoints, tools, and entity types', () => {
        assert.deepEqual(planHostClaimSyncs('https://wiki.wikibase.cloud'), [
            { property: 'P2', value: 'Q8', policy: 'single' },
            { property: 'P7', value: 'https://wiki.wikibase.cloud/query', policy: 'single' },
            { property: 'P8', value: 'https://wiki.wikibase.cloud/query/sparql', policy: 'single' },
            { property: 'P49', value: 'https://wiki.wikibase.cloud/wiki/Main_Page', policy: 'single' },
            {
                property: 'P37',
                value: 'Q285',
                policy: 'include',
                qualifiers: {
                    P7: 'https://wiki.wikibase.cloud/query',
                    P8: 'https://wiki.wikibase.cloud/query/sparql',
                },
            },
            {
                property: 'P37',
                value: 'Q287',
                policy: 'include',
                qualifiers: { P1: 'https://wiki.wikibase.cloud/tools/cradle' },
            },
            {
                property: 'P37',
                value: 'Q286',
                policy: 'include',
                qualifiers: { P1: 'https://wiki.wikibase.cloud/tools/quickstatements' },
            },
            { property: 'P12', value: 'Q51', policy: 'include' },
            { property: 'P12', value: 'Q52', policy: 'include' },
        ]);
    });

    it('detects host providers from domains, reverse DNS, and the Professional Wiki logo', () => {
        assert.deepEqual(
            planHostClaimSyncs('https://custom.example', [
                '221.76.141.34.bc.googleusercontent.com',
                'cp37.wikitide.net',
            ]).filter(sync => sync.property === 'P2'),
            [
                { property: 'P2', value: 'Q8', policy: 'single' },
                { property: 'P2', value: 'Q118', policy: 'single' },
            ],
        );
        assert.deepEqual(
            planHostClaimSyncs('https://wiki.wikibase.wiki').map(sync => sync.value),
            ['Q7'],
        );
        assert.deepEqual(
            planHostClaimSyncs('https://custom.example', [], 'w/images/HostedByProfessionalWiki.png')
                .map(sync => sync.value),
            ['Q7'],
        );
        assert.deepEqual(
            planHostClaimSyncs('https://project.wmflabs.org').map(sync => sync.value),
            ['Q6'],
        );
    });
});

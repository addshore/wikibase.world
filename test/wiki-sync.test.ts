import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
    extractMediaWikiVersion,
    findEntityNamespaces,
    planEntityMetricClaimSyncs,
    planInceptionClaimSync,
    planLastEditClaimSync,
    planMainPageUrlNormalization,
    planSiteInfoClaimSyncs,
    planWikiClaimSyncs,
    selectWikisForSync,
} from '../src/rewrite/wiki-sync.js';
import {
    extractPageMetadata,
    planEntityMetadataSyncs,
} from '../src/rewrite/entity-metadata.js';

describe('wiki metadata sync planning', () => {
    const wikis = [
        { item: 'Q1', site: 'https://sub.first.example' },
        { item: 'Q2', site: 'https://second.example', statusItem: 'Q57' },
        { item: 'Q3', site: 'https://another.example', statusItem: 'Q54' },
    ];

    it('selects existing wikis by substring, domain, item ID, and random sample', () => {
        assert.deepEqual(
            selectWikisForSync(wikis, { filter: 'another', limit: 1 }).map(wiki => wiki.item),
            ['Q3'],
        );
        assert.deepEqual(selectWikisForSync(wikis, { filter: 'missing' }), []);
        assert.deepEqual(
            selectWikisForSync(wikis, { domain: 'first.example' }).map(wiki => wiki.item),
            ['Q1'],
        );
        assert.deepEqual(
            selectWikisForSync(wikis, { item: 'Q2' }).map(wiki => wiki.item),
            ['Q2'],
        );
        const randomSample = selectWikisForSync(wikis, { random: true, limit: 2 });
        assert.equal(randomSample.length, 2);
        assert.equal(new Set(randomSample.map(wiki => wiki.item)).size, 2);
        assert.throws(() => selectWikisForSync(wikis, { domain: 'https://first.example' }), TypeError);
        assert.throws(() => selectWikisForSync(wikis, { item: 'not-an-item' }), TypeError);
    });

    it('extracts the MediaWiki version from the generator meta tag', () => {
        assert.equal(
            extractMediaWikiVersion('<meta name="generator" content="MediaWiki 1.43.9">'),
            '1.43.9',
        );
        assert.equal(extractMediaWikiVersion('<html></html>'), undefined);
    });

    it('updates the version and adds active status only when status is missing', () => {
        assert.deepEqual(planWikiClaimSyncs(wikis[0], '1.43.9'), [
            { property: 'P57', value: '1.43.9', policy: 'single' },
            { property: 'P13', value: 'Q54', policy: 'include' },
        ]);
        assert.deepEqual(planWikiClaimSyncs(wikis[1], undefined), []);
        assert.deepEqual(planWikiClaimSyncs(wikis[2], '1.44.0'), [
            { property: 'P57', value: '1.44.0', policy: 'single' },
        ]);
    });

    it('maps siteinfo software fields and thresholded statistics', () => {
        assert.deepEqual(planSiteInfoClaimSyncs({
            general: {
                phpversion: '8.3.1',
                dbtype: 'mysql',
                dbversion: '10.11.6-MariaDB',
            },
            statistics: {
                pages: 120,
                edits: '450',
                users: 30,
                activeusers: 8,
                articles: 'invalid',
            },
        }), [
            { property: 'P68', value: '8.3.1', policy: 'single' },
            { property: 'P69', value: 'mysql', policy: 'single' },
            { property: 'P70', value: '10.11.6-MariaDB', policy: 'single' },
            { property: 'P62', value: 120, policy: 'single', numericThreshold: 0.5 },
            { property: 'P59', value: 450, policy: 'single', numericThreshold: 0.5 },
            { property: 'P60', value: 30, policy: 'single', numericThreshold: 0.5 },
            { property: 'P61', value: 8, policy: 'single', numericThreshold: 0.5 },
        ]);
        assert.deepEqual(planSiteInfoClaimSyncs({
            statistics: { pages: -1, edits: 'invalid' },
        }), []);
    });

    it('maps property-count and max-item-ID metrics with the legacy threshold', () => {
        assert.deepEqual(planEntityMetricClaimSyncs({ propertyCount: 250, maxItemId: 12345 }), [
            { property: 'P58', value: 250, policy: 'single', numericThreshold: 0.5 },
            { property: 'P67', value: 12345, policy: 'single', numericThreshold: 0.5 },
        ]);
        assert.deepEqual(findEntityNamespaces({
            '-1': { id: -1, defaultcontentmodel: 'wikitext' },
            '120': { id: 120, defaultcontentmodel: 'wikibase-item' },
            '122': { id: 122, defaultcontentmodel: 'wikibase-property' },
        }), { item: 120, property: 122 });
    });

    it('adds inception dates with references and only backfills references for a matching date', () => {
        const source = 'https://wiki.example/api.php?action=query&list=logevents';
        assert.deepEqual(
            planInceptionClaimSync('2020-02-11', source, '2026-09-27'),
            [{
                property: 'P5',
                value: '2020-02-11',
                policy: 'single',
                references: { P21: source, P22: '2026-09-27' },
            }],
        );
        assert.deepEqual(
            planInceptionClaimSync('2020-02-11', source, '2026-09-27', [{
                mainsnak: { datavalue: { value: { time: '+2020-02-11T00:00:00Z' } } },
            }]),
            [{
                property: 'P5',
                value: '2020-02-11',
                policy: 'single',
                references: { P21: source, P22: '2026-09-27' },
                referenceOnly: true,
            }],
        );
        assert.deepEqual(planInceptionClaimSync('2020-02-11', source, '2026-09-27', [{
            mainsnak: { datavalue: { value: '+2019-01-01T00:00:00Z' } },
        }]), []);
        assert.deepEqual(planInceptionClaimSync('2020-02-11', source, '2026-09-27', [{
            references: [{}],
            mainsnak: { datavalue: { value: '2020-02-11' } },
        }]), []);
    });

    it('plans month-precision last-edit claims with source references', () => {
        const source = 'https://wiki.example/api.php?action=query&list=recentchanges%7Clogevents';
        assert.deepEqual(planLastEditClaimSync(
            '2026-08-17T09:30:00Z',
            source,
            '2026-09-27',
        ), [{
            property: 'P73',
            value: {
                time: '+2026-08-01T00:00:00Z',
                timezone: 0,
                before: 0,
                after: 0,
                precision: 10,
                calendarmodel: 'http://www.wikidata.org/entity/Q1985727',
            },
            policy: 'single',
            references: { P21: source, P22: '2026-09-27' },
        }]);
        assert.deepEqual(planLastEditClaimSync('invalid', source, '2026-09-27'), []);
    });

    it('adds missing English descriptions and removes malformed Main Page aliases', () => {
        const metadata = extractPageMetadata(
            '<meta name="description" content="A wiki &amp; its &quot;pages&quot;">',
        );
        assert.deepEqual(metadata, {
            language: 'en',
            description: 'A wiki & its "pages"',
        });
        assert.deepEqual(planEntityMetadataSyncs(metadata, {
            aliases: ['Main Page - Bad alias', 'Useful alias'],
        }), [
            { type: 'description', language: 'en', value: 'A wiki & its "pages"' },
            { type: 'alias-remove', language: 'en', value: 'Main Page - Bad alias' },
        ]);
        assert.deepEqual(planEntityMetadataSyncs(metadata, {
            description: 'Existing description',
            aliases: [],
        }), []);
        assert.deepEqual(planEntityMetadataSyncs({
            language: 'fr',
            description: 'French description',
        }, {
            aliases: ['Main Page - Alias'],
        }), []);
    });

    it('shortens a Main_Page URL only when the bare URL resolves to the same page', () => {
        const site = 'https://wiki.example/wiki/Main_Page';
        assert.deepEqual(planMainPageUrlNormalization(
            site,
            'https://wiki.example/wiki/Main_Page',
            'https://wiki.example/wiki/Main_Page',
            [{ mainsnak: { datavalue: { value: site } } }],
        ), [{
            property: 'P1',
            value: 'https://wiki.example',
            policy: 'single',
        }]);
        assert.deepEqual(planMainPageUrlNormalization(
            site,
            'https://wiki.example/wiki/Main_Page',
            'https://wiki.example/wiki/Other_Page',
            [{ mainsnak: { datavalue: { value: site } } }],
        ), []);
        assert.deepEqual(planMainPageUrlNormalization(
            site,
            'https://wiki.example/wiki/Main_Page',
            'https://wiki.example/wiki/Main_Page',
            [
                { mainsnak: { datavalue: { value: site } } },
                { mainsnak: { datavalue: { value: site } } },
            ],
        ), []);
    });
});

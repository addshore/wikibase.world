import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import WBEdit from 'wikibase-edit';
import { createWikibaseWriter } from '../../src/rewrite/wikibase-writer.js';
import { loadKnownWikis } from '../../src/rewrite/wikibase-reader.js';
import { createWikibaseVerifier } from '../../src/rewrite/verifier.js';
import { planWikiSync } from '../../src/rewrite/wiki-sync-runner.js';
import type { WikiCandidate } from '../../src/rewrite/model.js';
import { wikibaseWorldPropertySchema } from './wikibase-world-property-schema.js';

const instance = process.env.LOCAL_WIKIBASE_URL ?? 'http://localhost:8081';
const username = process.env.LOCAL_WIKIBASE_USERNAME ?? 'Admin';
const password = process.env.LOCAL_WIKIBASE_PASSWORD ?? 'wikibase-local-only';
const expectedMediaWikiVersion = 'MediaWiki 1.43.9';
const instanceUrl = new URL(instance);

if (!['localhost', '127.0.0.1', '::1'].includes(instanceUrl.hostname)) {
    throw new Error('Integration tests are restricted to a local Wikibase URL');
}

const apiUrl = new URL('/api.php', instanceUrl);

async function waitForWikibase(timeoutMs = 5 * 60 * 1000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown;

    while (Date.now() < deadline) {
        try {
            const response = await fetch(apiUrl);
            if (response.ok) return;
            lastError = new Error(`Wikibase API returned HTTP ${response.status}`);
        } catch (error) {
            lastError = error;
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    throw new Error(`Local Wikibase did not become ready at ${apiUrl}`, { cause: lastError });
}

async function seedWikibaseWorldPropertySchema(): Promise<void> {
    const propertyIds = wikibaseWorldPropertySchema.map((_, index) => `P${index + 1}`);
    const existing: Record<string, { datatype?: string; missing?: string }> = {};

    for (let offset = 0; offset < propertyIds.length; offset += 50) {
        const query = new URLSearchParams({
            action: 'wbgetentities',
            ids: propertyIds.slice(offset, offset + 50).join('|'),
            props: 'datatype',
            format: 'json',
        });
        const response = await fetch(`${apiUrl}?${query}`);
        assert.equal(response.status, 200);
        const data = await response.json() as {
            entities?: Record<string, { datatype?: string; missing?: string }>;
        };
        Object.assign(existing, data.entities);
    }

    const presentIndices = propertyIds
        .map((id, index) =>
            existing[id] && existing[id].missing === undefined ? index : -1,
        )
        .filter(index => index >= 0);
    const highestPresentIndex = Math.max(-1, ...presentIndices);
    for (let index = 0; index < highestPresentIndex; index++) {
        assert.ok(
            existing[propertyIds[index]] &&
                existing[propertyIds[index]].missing === undefined,
            `Local schema has a property-ID gap before ${propertyIds[highestPresentIndex]}; use the isolated test stack`,
        );
    }

    const edit = WBEdit({
        instance,
        credentials: { username, password },
        maxlag: 30,
    });
    for (let index = 0; index < wikibaseWorldPropertySchema.length; index++) {
        const id = propertyIds[index];
        const [label, datatype] = wikibaseWorldPropertySchema[index];
        const property = existing[id];
        if (property && property.missing === undefined) {
            assert.equal(property.datatype, datatype, `${id} datatype differs from the Wikibase World fixture`);
            continue;
        }

        const result = await edit.entity.create({
            type: 'property',
            datatype,
            labels: { en: `${id}: ${label}` },
        }, { summary: 'Seed Wikibase World property schema for integration tests' });
        assert.equal(result.entity?.id, id, `Expected to seed ${id} in sequence`);
    }
}

describe('local Wikibase integration', () => {
    before(async () => {
        await waitForWikibase();
        const query = new URLSearchParams({
            action: 'query',
            meta: 'siteinfo',
            siprop: 'general',
            format: 'json',
        });
        const response = await fetch(`${apiUrl}?${query}`);
        const data = await response.json() as {
            query?: { general?: { generator?: string } };
        };
        assert.equal(data.query?.general?.generator, expectedMediaWikiVersion);
        assert.ok(await createWikibaseVerifier().verify(instance));
        await seedWikibaseWorldPropertySchema();
    }, { timeout: 5 * 60 * 1000 });

    it('creates an item and reads the created label back from the Action API', async () => {
        const label = `Integration test ${randomUUID()}`;
        const candidate: WikiCandidate = {
            source: 'local integration test',
            site: 'https://example.invalid',
            label,
            aliases: [`${label} alias`],
        };
        const writer = createWikibaseWriter({ instance, username, password });

        const entityId = await writer.create(candidate);
        const edit = WBEdit({
            instance,
            credentials: { username, password },
            maxlag: 30,
        });
        const propertyResult = await edit.entity.create({
            type: 'property',
            datatype: 'string',
            labels: { en: `Integration field ${randomUUID()}` },
        }, { summary: 'Create local integration-test property' });
        const property = propertyResult.entity?.id;
        assert.ok(property, 'Expected property creation to return an ID');

        const singleClaim = {
            id: entityId,
            property,
            value: 'initial value',
            policy: 'single' as const,
            summary: 'Exercise single-value claim reconciliation',
        };
        await writer.ensureClaim(singleClaim);
        await writer.ensureClaim(singleClaim);
        await writer.ensureClaim({ ...singleClaim, value: 'updated value' });
        await writer.ensureClaim({
            ...singleClaim,
            value: 'additional value',
            policy: 'include',
            summary: 'Exercise include-value claim reconciliation',
        });
        await writer.ensureClaim({
            ...singleClaim,
            value: 'qualified value',
            policy: 'include',
            qualifiers: { [property]: 'qualifier value' },
            summary: 'Exercise qualifier creation',
        });
        await writer.setDescription({
            id: entityId,
            language: 'en',
            value: 'Integration test description',
            summary: 'Exercise description setting',
        });
        await writer.removeAlias({
            id: entityId,
            language: 'en',
            value: `${label} alias`,
            summary: 'Exercise alias removal',
        });
        const referenceSourceProperty = (await edit.entity.create({
            type: 'property',
            datatype: 'url',
            labels: { en: `Integration reference source ${randomUUID()}` },
        }, { summary: 'Create local reference source property' })).entity?.id;
        const referenceDateProperty = (await edit.entity.create({
            type: 'property',
            datatype: 'time',
            labels: { en: `Integration reference date ${randomUUID()}` },
        }, { summary: 'Create local reference date property' })).entity?.id;
        assert.ok(referenceSourceProperty, 'Expected source property creation to return an ID');
        assert.ok(referenceDateProperty, 'Expected date property creation to return an ID');
        const referenceClaimProperty = (await edit.entity.create({
            type: 'property',
            datatype: 'string',
            labels: { en: `Integration referenced claim ${randomUUID()}` },
        }, { summary: 'Create local reference test property' })).entity?.id;
        assert.ok(referenceClaimProperty, 'Expected referenced property creation to return an ID');
        const referenceClaim = {
            id: entityId,
            property: referenceClaimProperty,
            value: 'referenced value',
            policy: 'single' as const,
            references: {
                [referenceSourceProperty]: 'https://example.invalid/api.php',
                [referenceDateProperty]: '+2026-09-27T00:00:00Z',
            },
            summary: 'Exercise reference creation',
        };
        await writer.ensureClaim(referenceClaim);
        await writer.ensureClaim({ ...referenceClaim, referenceOnly: true });

        const entityQuery = new URLSearchParams({
            action: 'wbgetentities',
            ids: entityId,
            props: 'labels|aliases|descriptions|claims',
            languages: 'en',
            format: 'json',
        });
        const entityResponse = await fetch(`${apiUrl}?${entityQuery}`);
        const entityData = await entityResponse.json() as {
            entities?: Record<string, {
                labels?: { en?: { value: string } };
                aliases?: { en?: Array<{ value: string }> };
                descriptions?: { en?: { value: string } };
                claims?: Record<string, Array<{
                    mainsnak?: { datavalue?: { value?: unknown } };
                    qualifiers?: Record<string, Array<{
                        datavalue?: { value?: unknown };
                    }>>;
                }>>;
            }>;
        };

        assert.equal(entityResponse.status, 200);
        assert.equal(entityData.entities?.[entityId]?.labels?.en?.value, label);
        assert.deepEqual(
            entityData.entities?.[entityId]?.aliases?.en?.map(alias => alias.value) ?? [],
            [],
        );
        assert.equal(
            entityData.entities?.[entityId]?.descriptions?.en?.value,
            'Integration test description',
        );
        assert.deepEqual(
            entityData.entities?.[entityId]?.claims?.[property]?.map(
                claim => claim.mainsnak?.datavalue?.value,
            ).sort(),
            ['additional value', 'qualified value', 'updated value'],
        );
        assert.equal(
            entityData.entities?.[entityId]?.claims?.[property]?.find(
                claim => claim.mainsnak?.datavalue?.value === 'qualified value',
            )?.qualifiers?.[property]?.[0].datavalue?.value,
            'qualifier value',
        );

        const quantityPropertyResult = await edit.entity.create({
            type: 'property',
            datatype: 'quantity',
            labels: { en: `Integration quantity ${randomUUID()}` },
        }, { summary: 'Create local numeric-threshold integration property' });
        const quantityProperty = quantityPropertyResult.entity?.id;
        assert.ok(quantityProperty, 'Expected quantity property creation to return an ID');
        const quantityClaim = {
            id: entityId,
            property: quantityProperty,
            value: { amount: '+100', unit: '1' },
            policy: 'single' as const,
            numericThreshold: 0.5,
            summary: 'Exercise numeric threshold reconciliation',
        };
        await writer.ensureClaim(quantityClaim);
        await writer.ensureClaim({ ...quantityClaim, value: { amount: '+200', unit: '1' } });
        const afterSmallChange = await fetch(`${apiUrl}?${new URLSearchParams({
            action: 'wbgetentities',
            ids: entityId,
            props: 'claims',
            format: 'json',
        })}`);
        const smallChangeData = await afterSmallChange.json() as {
            entities?: Record<string, { claims?: Record<string, Array<{
                mainsnak?: { datavalue?: { value?: { amount?: string } } };
            }>> }>;
        };
        assert.equal(
            Number(smallChangeData.entities?.[entityId]?.claims?.[quantityProperty]?.[0]
                .mainsnak?.datavalue?.value?.amount),
            100,
        );

        await writer.ensureClaim({ ...quantityClaim, value: { amount: '+1000', unit: '1' } });
        const afterLargeChange = await fetch(`${apiUrl}?${new URLSearchParams({
            action: 'wbgetentities',
            ids: entityId,
            props: 'claims',
            format: 'json',
        })}`);
        const largeChangeData = await afterLargeChange.json() as typeof smallChangeData;
        assert.equal(
            Number(largeChangeData.entities?.[entityId]?.claims?.[quantityProperty]?.[0]
                .mainsnak?.datavalue?.value?.amount),
            1000,
        );

        const referencedEntity = await fetch(`${apiUrl}?${new URLSearchParams({
            action: 'wbgetentities',
            ids: entityId,
            props: 'claims',
            format: 'json',
        })}`);
        const referencedData = await referencedEntity.json() as {
            entities?: Record<string, { claims?: Record<string, Array<{
                references?: Array<{ snaks?: Record<string, unknown> }>;
            }>> }>;
        };
        const references = referencedData.entities?.[entityId]?.claims?.[referenceClaimProperty]?.[0]
            .references;
        assert.equal(references?.length, 1);
        assert.ok(references?.[0].snaks?.[referenceSourceProperty]);
        assert.ok(references?.[0].snaks?.[referenceDateProperty]);

        const knownWikis = await loadKnownWikis(instance);
        assert.equal(knownWikis.some(wiki => wiki.site === candidate.site), false);

        const hostItem = await writer.create({
            source: 'local integration test',
            site: 'https://integration-host.invalid',
            label: `Integration host ${randomUUID()}`,
        });
        await writer.ensureClaim({
            id: entityId,
            property: 'P1',
            value: candidate.site,
            policy: 'single',
            summary: 'Exercise the production URL property',
        });
        await writer.ensureClaim({
            id: entityId,
            property: 'P2',
            value: hostItem,
            policy: 'single',
            summary: 'Exercise the production item property',
        });
        await writer.ensureClaim({
            id: entityId,
            property: 'P57',
            value: '1.43.9',
            policy: 'single',
            summary: 'Exercise the production string property',
        });
        await writer.ensureClaim({
            id: entityId,
            property: 'P58',
            value: 42,
            policy: 'single',
            summary: 'Exercise the production quantity property',
        });
        const lastEdit = {
            time: '+2026-09-01T00:00:00Z',
            timezone: 0,
            before: 0,
            after: 0,
            precision: 10,
            calendarmodel: 'http://www.wikidata.org/entity/Q1985727',
        };
        await writer.ensureClaim({
            id: entityId,
            property: 'P73',
            value: lastEdit,
            policy: 'single',
            references: {
                P21: `${instance}/api.php`,
                P22: '+2026-09-28T00:00:00Z',
            },
            summary: 'Exercise the production time property and references',
        });

        const schemaClaimsResponse = await fetch(`${apiUrl}?${new URLSearchParams({
            action: 'wbgetentities',
            ids: entityId,
            props: 'claims',
            format: 'json',
        })}`);
        const schemaClaimsData = await schemaClaimsResponse.json() as {
            entities?: Record<string, { claims?: Record<string, Array<{
                mainsnak?: { datavalue?: { value?: unknown } };
                references?: Array<{ snaks?: Record<string, unknown> }>;
            }>> }>;
        };
        const claims = schemaClaimsData.entities?.[entityId]?.claims;
        assert.equal(claims?.P1?.[0].mainsnak?.datavalue?.value, candidate.site);
        assert.equal(
            (claims?.P2?.[0].mainsnak?.datavalue?.value as { id?: string } | undefined)?.id,
            hostItem,
        );
        assert.equal(claims?.P57?.[0].mainsnak?.datavalue?.value, '1.43.9');
        assert.equal(
            Number((claims?.P58?.[0].mainsnak?.datavalue?.value as { amount?: string } | undefined)?.amount),
            42,
        );
        assert.equal(
            (claims?.P73?.[0].mainsnak?.datavalue?.value as { time?: string } | undefined)?.time,
            lastEdit.time,
        );
        assert.ok(claims?.P73?.[0].references?.[0].snaks?.P21);
        assert.ok(claims?.P73?.[0].references?.[0].snaks?.P22);
    });

    it('reads local MediaWiki version and siteinfo into property sync plans', async () => {
        const plan = await planWikiSync(
            { item: 'Q1', site: instance },
            {
                targetInstance: instance,
                knownWikis: [
                    { item: 'Q1', site: instance },
                    { item: 'Q2', site: 'https://not-linked.example' },
                ],
            },
        );
        assert.equal(plan.status, 'ready');
        if (plan.status !== 'ready') return;

        const values = new Map(plan.syncs.map(sync => [sync.property, sync.value]));
        assert.equal(values.get('P57'), '1.43.9');
        assert.equal(values.get('P13'), 'Q54');
        assert.ok(values.has('P68'));
        assert.ok(values.has('P69'));
        assert.ok(values.has('P70'));
        assert.ok(values.has('P62'));
        assert.ok(values.has('P59'));
        assert.ok(values.has('P60'));
        assert.ok(values.has('P61'));
        assert.ok(values.has('P58'));
        assert.ok(values.has('P67'));
        assert.ok(values.has('P73'));

        const softwarePlan = await planWikiSync(
            { item: 'Q1', site: instance },
            {
                targetInstance: instance,
                knownWikis: [{ item: 'Q1', site: instance }],
                action: 'software',
            },
        );
        assert.equal(softwarePlan.status, 'ready');
        if (softwarePlan.status === 'ready') {
            assert.ok(softwarePlan.syncs.some(sync => sync.property === 'P57'));
            assert.ok(softwarePlan.syncs.some(sync => sync.property === 'P68'));
            assert.ok(softwarePlan.syncs.some(sync => sync.property === 'P69'));
            assert.ok(softwarePlan.syncs.some(sync => sync.property === 'P70'));
            assert.ok(softwarePlan.syncs.every(sync =>
                ['P57', 'P68', 'P69', 'P70'].includes(sync.property),
            ));
            assert.deepEqual(softwarePlan.entitySyncs, []);
            assert.deepEqual(softwarePlan.relatedSyncs, []);
        }

        const metricsPlan = await planWikiSync(
            { item: 'Q1', site: instance },
            {
                targetInstance: instance,
                knownWikis: [{ item: 'Q1', site: instance }],
                action: 'metrics',
            },
        );
        assert.equal(metricsPlan.status, 'ready');
        if (metricsPlan.status === 'ready') {
            assert.ok(metricsPlan.syncs.some(sync => sync.property === 'P58'));
            assert.ok(metricsPlan.syncs.some(sync => sync.property === 'P67'));
            assert.ok(metricsPlan.syncs.every(sync =>
                ['P58', 'P59', 'P60', 'P61', 'P62', 'P67'].includes(sync.property),
            ));
            assert.deepEqual(metricsPlan.entitySyncs, []);
            assert.deepEqual(metricsPlan.relatedSyncs, []);
        }

        const existingStatusPlan = await planWikiSync({
            item: 'Q1',
            site: instance,
            statusItem: 'Q57',
        });
        assert.equal(existingStatusPlan.status, 'ready');
        if (existingStatusPlan.status === 'ready') {
            assert.equal(existingStatusPlan.syncs.some(sync => sync.property === 'P13'), false);
        }
    });
});

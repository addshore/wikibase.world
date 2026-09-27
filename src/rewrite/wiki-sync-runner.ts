import { findActionApi, getEntityClaims, getEntityLanguageData } from './wikibase-reader.js';
import { fetchEntityMetrics } from './entity-metrics.js';
import {
    extractPageMetadata,
    planEntityMetadataSyncs,
    type EntityMetadataSync,
} from './entity-metadata.js';
import { lookupReverseDns, planHostClaimSyncs } from './host-detection.js';
import {
    fetchExternalLinkDomains,
    IGNORED_EXTERNAL_LINK_HOSTS,
    planWikiLinkSyncs,
    type WikiLinkSync,
} from './external-links.js';
import { mediaWikiWikibaseVerifier } from './verifier.js';
import {
    extractMediaWikiVersion,
    findEntityNamespaces,
    planEntityMetricClaimSyncs,
    planInceptionClaimSync,
    planLastEditClaimSync,
    planMainPageUrlNormalization,
    planSiteInfoClaimSyncs,
    planWikiClaimSyncs,
    type WikiClaimSync,
} from './wiki-sync.js';
import type { KnownWiki, WikiVerifier } from './model.js';

export type WikiSyncPlan =
    | { status: 'skipped'; reason: string }
    | {
        status: 'ready';
        syncs: WikiClaimSync[];
        entitySyncs: EntityMetadataSync[];
        relatedSyncs: WikiLinkSync[];
        warnings: string[];
    };

export const WIKI_SYNC_ACTIONS = [
    'all',
    'software',
    'metrics',
    'hosting',
    'links',
    'cleanup',
    'activity',
] as const;

export type WikiSyncAction = typeof WIKI_SYNC_ACTIONS[number];

export interface WikiSyncPlanOptions {
    fetch?: typeof globalThis.fetch;
    verifier?: WikiVerifier;
    timeoutMs?: number;
    targetInstance?: string;
    knownWikis?: KnownWiki[];
    reverseDnsLookup?: typeof lookupReverseDns;
    action?: WikiSyncAction;
}

export async function planWikiSync(
    wiki: KnownWiki,
    {
        fetch: fetchImpl = globalThis.fetch,
        verifier = mediaWikiWikibaseVerifier,
        timeoutMs = 60_000,
        targetInstance,
        knownWikis = [],
        reverseDnsLookup = lookupReverseDns,
        action = 'all',
    }: WikiSyncPlanOptions = {},
): Promise<WikiSyncPlan> {
    const includes = (requested: Exclude<WikiSyncAction, 'all'>) =>
        action === 'all' || action === requested;
    const verified = await verifier.verify(wiki.site);
    if (!verified) return { status: 'skipped', reason: 'not a reachable Wikibase' };
    if (new URL(verified.site).hostname !== new URL(wiki.site).hostname) {
        return { status: 'skipped', reason: 'redirected to another host' };
    }

    const signal = AbortSignal.timeout(timeoutMs);
    const response = await fetchImpl(wiki.site, {
        headers: { 'User-Agent': 'Wikibase World importer' },
        signal,
    });
    const pageHtml = await response.text();
    const responseUrl = new URL(response.url || wiki.site);
    if (responseUrl.hostname !== new URL(wiki.site).hostname) {
        return { status: 'skipped', reason: 'page redirected to another host' };
    }
    const validPage = response.status === 200 ||
        (response.status === 404 && pageHtml.includes('There is currently no text in this page'));
    if (!validPage) {
        return { status: 'skipped', reason: `HTTP ${response.status}` };
    }
    const pageFinalUrl = responseUrl.toString();
    const syncs: WikiClaimSync[] = [];

    const api = await findActionApi(verified.site, fetchImpl, signal);
    const warnings: string[] = [];
    syncs.push(...planWikiClaimSyncs(
        wiki,
        includes('software') ? extractMediaWikiVersion(pageHtml) : undefined,
    ).filter(sync =>
        sync.property === 'P57'
            ? includes('software')
            : sync.property === 'P13' && includes('activity'),
    ));
    if (includes('cleanup') && wiki.site.endsWith('/wiki/Main_Page') && targetInstance) {
        try {
            const shortenedSite = wiki.site.replace(/\/wiki\/Main_Page$/, '');
            const [existingClaims, shortenedResponse] = await Promise.all([
                getEntityClaims(targetInstance, wiki.item, fetchImpl, signal),
                fetchImpl(shortenedSite, {
                    headers: { 'User-Agent': 'Wikibase World importer' },
                    signal,
                }),
            ]);
            const shortenedFinalUrl = shortenedResponse.url || shortenedSite;
            syncs.push(...planMainPageUrlNormalization(
                wiki.site,
                pageFinalUrl,
                shortenedFinalUrl,
                existingClaims.P1 ?? [],
            ));
        } catch (error) {
            warnings.push(`Main page URL normalization unavailable: ${errorMessage(error)}`);
        }
    }
    let entitySyncs: EntityMetadataSync[] = [];
    if (includes('cleanup') && targetInstance) {
        try {
            const pageMetadata = extractPageMetadata(pageHtml);
            const existingLanguageData = await getEntityLanguageData(
                targetInstance,
                wiki.item,
                'en',
                fetchImpl,
                signal,
            );
            entitySyncs = planEntityMetadataSyncs(pageMetadata, existingLanguageData);
        } catch (error) {
            warnings.push(`Labels/descriptions unavailable: ${errorMessage(error)}`);
        }
    }
    if (includes('hosting')) {
        let reverseDns: string[] = [];
        try {
            reverseDns = await reverseDnsLookup(new URL(wiki.site).hostname);
        } catch (error) {
            warnings.push(`Reverse DNS unavailable: ${errorMessage(error)}`);
        }
        syncs.push(...planHostClaimSyncs(wiki.site, reverseDns, pageHtml));
    }

    if (includes('software') || includes('metrics')) {
        const siteInfoUrl = new URL(api.endpoint);
        siteInfoUrl.search = new URLSearchParams({
            action: 'query',
            meta: 'siteinfo',
            siprop: 'general|namespaces|statistics',
            format: 'json',
        }).toString();
        try {
            const siteInfoResponse = await fetchImpl(siteInfoUrl, {
                headers: { 'User-Agent': 'Wikibase World importer' },
                signal,
            });
            if (!siteInfoResponse.ok) {
                throw new Error(`HTTP ${siteInfoResponse.status}`);
            }
            const siteInfoPayload = await siteInfoResponse.json() as { query?: unknown };
            if (
                !siteInfoPayload.query ||
                typeof siteInfoPayload.query !== 'object' ||
                Array.isArray(siteInfoPayload.query)
            ) {
                throw new Error('invalid response');
            }
            const siteInfo = siteInfoPayload.query as {
                general?: unknown;
                statistics?: unknown;
                namespaces?: unknown;
            };
            syncs.push(...planSiteInfoClaimSyncs(siteInfo).filter(sync =>
                sync.property === 'P68' || sync.property === 'P69' || sync.property === 'P70'
                    ? includes('software')
                    : includes('metrics'),
            ));
            if (includes('metrics')) {
                try {
                    const metrics = await fetchEntityMetrics(
                        api.endpoint,
                        findEntityNamespaces(siteInfo.namespaces),
                        { fetch: fetchImpl, signal },
                    );
                    syncs.push(...planEntityMetricClaimSyncs(metrics));
                } catch (error) {
                    warnings.push(`Entity metrics unavailable: ${errorMessage(error)}`);
                }
            }
        } catch (error) {
            warnings.push(`Siteinfo unavailable: ${errorMessage(error)}`);
        }
    }

    if (includes('activity')) {
        const logEventsUrl = new URL(api.endpoint);
        logEventsUrl.search = new URLSearchParams({
            action: 'query',
            list: 'logevents',
            ledir: 'newer',
            lelimit: '1',
            format: 'json',
        }).toString();
        try {
            const logEventsResponse = await fetchImpl(logEventsUrl, {
                headers: { 'User-Agent': 'Wikibase World importer' },
                signal,
            });
            if (!logEventsResponse.ok) throw new Error(`HTTP ${logEventsResponse.status}`);
            const logEventsPayload = await logEventsResponse.json() as {
                query?: { logevents?: Array<{ timestamp?: string }> };
                warnings?: unknown;
            };
            if (logEventsPayload.warnings || !Array.isArray(logEventsPayload.query?.logevents)) {
                throw new Error('invalid response');
            }
            const timestamp = logEventsPayload.query.logevents[0]?.timestamp;
            const inceptionDate = timestamp?.match(/^(\d{4}-\d{2}-\d{2})T/)?.[1];
            if (inceptionDate && targetInstance) {
                const existingP5 = (await getEntityClaims(
                    targetInstance,
                    wiki.item,
                    fetchImpl,
                    signal,
                )).P5 ?? [];
                syncs.push(...planInceptionClaimSync(
                    inceptionDate,
                    logEventsUrl.toString(),
                    new Date().toISOString().slice(0, 10),
                    existingP5,
                ));
            }
        } catch (error) {
            warnings.push(`Inception date unavailable: ${errorMessage(error)}`);
        }

        const lastEditUrl = new URL(api.endpoint);
        lastEditUrl.search = new URLSearchParams({
            action: 'query',
            list: 'recentchanges|logevents',
            rclimit: '1',
            lelimit: '1',
            format: 'json',
        }).toString();
        try {
            const lastEditResponse = await fetchImpl(lastEditUrl, {
                headers: { 'User-Agent': 'Wikibase World importer' },
                signal,
            });
            if (!lastEditResponse.ok) throw new Error(`HTTP ${lastEditResponse.status}`);
            const lastEditPayload = await lastEditResponse.json() as {
                query?: {
                    recentchanges?: Array<{ timestamp?: string }>;
                    logevents?: Array<{ timestamp?: string }>;
                };
                warnings?: unknown;
            };
            if (
                lastEditPayload.warnings ||
                !Array.isArray(lastEditPayload.query?.recentchanges) ||
                !Array.isArray(lastEditPayload.query.logevents)
            ) {
                throw new Error('invalid response');
            }
            const recentChange = lastEditPayload.query.recentchanges[0]?.timestamp;
            const recentLog = lastEditPayload.query.logevents[0]?.timestamp;
            const lastEditTimestamp = [recentChange, recentLog]
                .filter((value): value is string => value !== undefined)
                .sort()
                .at(-1);
            if (lastEditTimestamp) {
                syncs.push(...planLastEditClaimSync(
                    lastEditTimestamp,
                    lastEditUrl.toString(),
                    new Date().toISOString().slice(0, 10),
                ));
            }
        } catch (error) {
            warnings.push(`Last edit unavailable: ${errorMessage(error)}`);
        }
    }

    let relatedSyncs: WikiLinkSync[] = [];
    if (
        includes('links') &&
        !IGNORED_EXTERNAL_LINK_HOSTS.has(new URL(api.endpoint).hostname.toLowerCase())
    ) {
        try {
            const externalLinks = await fetchExternalLinkDomains(api.endpoint, { fetch: fetchImpl, signal });
            if (externalLinks.truncated) {
                warnings.push(`External link scan for ${wiki.site} reached its page limit`);
            }
            relatedSyncs = planWikiLinkSyncs(wiki, externalLinks.domains, knownWikis);
        } catch (error) {
            warnings.push(`External wiki links unavailable: ${errorMessage(error)}`);
        }
    }

    return {
        status: 'ready',
        syncs,
        entitySyncs,
        relatedSyncs,
        warnings,
    };
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

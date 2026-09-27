import type { WikiCandidate } from '../model.js';
import type { ClaimSync, KnownWiki } from '../model.js';

interface CloudApiWiki {
    id: number;
    domain: string;
    sitename?: string | null;
}

interface CloudApiResponse {
    data?: CloudApiWiki[];
    meta?: {
        current_page?: number;
        last_page?: number;
        per_page?: number;
    };
}

export interface WikibaseCloudSourceOptions {
    endpoint?: string;
    perPage?: number;
    fetch?: typeof globalThis.fetch;
}

function isCloudApiWiki(value: unknown): value is CloudApiWiki {
    if (!value || typeof value !== 'object') return false;
    const wiki = value as Partial<CloudApiWiki>;
    return Number.isSafeInteger(wiki.id) &&
        typeof wiki.domain === 'string' &&
        wiki.domain.length > 0;
}

function shouldUseDomainAsLabel(sitename: string): boolean {
    const name = sitename.toLowerCase();
    const ignoredNames = ['test', 'testwiki', 'wikibase', 'testing'];
    return ignoredNames.includes(name) ||
        /^\d+$/.test(name) ||
        ignoredNames.some(prefix =>
            name.startsWith(prefix) && /^\d+$/.test(name.slice(prefix.length)),
        );
}

function toCandidate(wiki: CloudApiWiki): WikiCandidate {
    const site = `https://${wiki.domain}`;
    const sitename = wiki.sitename?.trim() || wiki.domain;
    const useDomain = shouldUseDomainAsLabel(sitename);

    return {
        source: 'wikibase.cloud',
        site,
        label: useDomain ? wiki.domain : sitename,
        ...(!useDomain && sitename !== wiki.domain && { aliases: [wiki.domain] }),
        claims: {
            P1: site,
            P2: 'Q8',
            P3: 'Q10',
            P13: 'Q54',
            P49: `${site}/wiki/Main_Page`,
            P54: String(wiki.id),
        },
        syncClaims: {
            P54: String(wiki.id),
        },
    };
}

export function createWikibaseCloudSource({
    endpoint = 'https://www.wikibase.cloud/api/wiki',
    perPage = 100,
    fetch: fetchImpl = globalThis.fetch,
}: WikibaseCloudSourceOptions = {}) {
    if (!Number.isSafeInteger(perPage) || perPage < 1) {
        throw new RangeError('perPage must be a positive safe integer');
    }

    return {
        async discover(): Promise<WikiCandidate[]> {
            const wikis: CloudApiWiki[] = [];
            let page = 1;

            while (true) {
                const url = new URL(endpoint);
                url.searchParams.set('sort', 'pages');
                url.searchParams.set('direction', 'desc');
                url.searchParams.set('page', String(page));
                url.searchParams.set('per_page', String(perPage));

                const response = await fetchImpl(url);
                if (!response.ok) {
                    throw new Error(`wikibase.cloud API returned HTTP ${response.status}`);
                }

                const payload = await response.json() as CloudApiResponse;
                const lastPage = payload.meta?.last_page;
                if (
                    !Array.isArray(payload.data) ||
                    !payload.data.every(isCloudApiWiki) ||
                    typeof lastPage !== 'number' ||
                    !Number.isSafeInteger(lastPage)
                ) {
                    throw new Error('wikibase.cloud API returned an invalid wiki list');
                }
                wikis.push(...payload.data);
                if (lastPage < page) {
                    throw new Error('wikibase.cloud API returned invalid pagination metadata');
                }
                if (payload.data.length === 0 && (page < lastPage || wikis.length > 0)) {
                    throw new Error(`wikibase.cloud API page ${page} was unexpectedly empty`);
                }
                if (page >= lastPage) break;
                page++;
            }

            return wikis
                .sort((a, b) => b.id - a.id)
                .map(toCandidate);
        },
        syncMissing(knownWikis: KnownWiki[], discovered: WikiCandidate[]): ClaimSync[] {
            if (discovered.length === 0) return [];
            const activeDomains = new Set(discovered.map(candidate => new URL(candidate.site).hostname.toLowerCase()));
            return knownWikis.flatMap(wiki => {
                if (
                    wiki.hostItem !== 'Q8' ||
                    wiki.statusItem === 'Q57' ||
                    activeDomains.has(new URL(wiki.site).hostname.toLowerCase())
                ) {
                    return [];
                }
                return [{
                    item: wiki.item,
                    site: wiki.site,
                    source: 'wikibase.cloud API',
                    property: 'P13',
                    value: 'Q57',
                    policy: 'single' as const,
                }];
            });
        },
    };
}

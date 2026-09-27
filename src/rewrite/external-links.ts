import type { KnownWiki } from './model.js';

export const IGNORED_EXTERNAL_LINK_HOSTS = new Set([
    'www.wikidata.org',
    'wikibase.world',
    'wikibase-registry.wmflabs.org',
    'commons.wikimedia.org',
]);

export interface ExternalLinkOptions {
    fetch?: typeof globalThis.fetch;
    signal?: AbortSignal;
    maxIterations?: number;
}

export interface ExternalLinkResults {
    domains: string[];
    truncated: boolean;
}

interface ExternalLinkResponse {
    query?: {
        exturlusage?: Array<{ url?: string }>;
    };
    continue?: Record<string, string>;
}

export async function fetchExternalLinkDomains(
    actionApi: URL,
    {
        fetch: fetchImpl = globalThis.fetch,
        signal,
        maxIterations = 350,
    }: ExternalLinkOptions = {},
): Promise<ExternalLinkResults> {
    if (!Number.isSafeInteger(maxIterations) || maxIterations < 1) {
        throw new RangeError('maxIterations must be a positive safe integer');
    }

    const domains = new Set<string>();
    let continuation: Record<string, string> = {};
    let iterations = 0;

    while (iterations < maxIterations) {
        iterations++;
        const url = new URL(actionApi);
        url.search = new URLSearchParams({
            action: 'query',
            list: 'exturlusage',
            euprotocol: 'https',
            eulimit: '500',
            eunamespace: '120|122',
            euprop: 'url',
            format: 'json',
            ...continuation,
        }).toString();
        const response = await fetchImpl(url, { signal });
        if (!response.ok) {
            throw new Error(`External link API returned HTTP ${response.status}: ${url}`);
        }
        const payload = await response.json() as ExternalLinkResponse;
        if (!Array.isArray(payload.query?.exturlusage)) {
            throw new Error(`External link API returned invalid results: ${url}`);
        }

        for (const link of payload.query.exturlusage) {
            if (typeof link.url !== 'string') continue;
            try {
                const linkUrl = new URL(link.url.startsWith('//') ? `https:${link.url}` : link.url);
                const hostname = linkUrl.hostname.toLowerCase();
                if (!IGNORED_EXTERNAL_LINK_HOSTS.has(hostname)) domains.add(hostname);
            } catch {
                // Ignore malformed external URLs.
            }
        }

        continuation = payload.continue ?? {};
        if (Object.keys(continuation).length === 0) {
            return { domains: [...domains], truncated: false };
        }
    }

    return { domains: [...domains], truncated: Object.keys(continuation).length > 0 };
}

export interface WikiLinkSync {
    item: string;
    property: 'P55' | 'P56';
    value: string;
}

export function planWikiLinkSyncs(
    source: KnownWiki,
    externalDomains: string[],
    knownWikis: KnownWiki[],
): WikiLinkSync[] {
    if (['Q3', 'Q58'].includes(source.item)) return [];
    const domains = new Set(externalDomains.map(domain => domain.toLowerCase()));
    const matches = new Set<string>();
    for (const wiki of knownWikis) {
        if (wiki.item === source.item) continue;
        try {
            if (domains.has(new URL(wiki.site).hostname.toLowerCase())) {
                matches.add(wiki.item);
            }
        } catch {
            throw new Error(`Known wiki ${wiki.item} has an invalid site URL: ${wiki.site}`);
        }
    }

    const syncs: WikiLinkSync[] = [];
    for (const item of matches) {
        syncs.push(
            { item: source.item, property: 'P55', value: item },
            { item, property: 'P56', value: source.item },
        );
    }
    return syncs;
}

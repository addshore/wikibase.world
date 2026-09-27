import type { KnownWiki } from './model.js';

interface ApiResponse {
    query?: Record<string, unknown>;
    continue?: Record<string, string>;
    entities?: Record<string, RawEntity & { missing?: string }>;
}

interface RawEntity {
    claims?: Record<string, RawClaim[]>;
    descriptions?: Record<string, { value?: string }>;
    aliases?: Record<string, Array<{ value?: string }>>;
}

export interface RawClaim {
    id?: string;
    references?: unknown[];
    mainsnak?: {
        snaktype?: string;
        datavalue?: {
            type?: string;
            value?: unknown;
        };
    };
}

interface SparqlResponse {
    results?: {
        bindings?: Array<{
            item?: { value?: string };
            site?: { value?: string };
            host?: { value?: string };
            status?: { value?: string };
        }>;
    };
}

export interface WikiReaderOptions {
    sparqlEndpoint?: string;
    fetch?: typeof globalThis.fetch;
}

function claimValue(entity: RawEntity, property: string): string | null {
    const value = entity.claims?.[property]?.[0]?.mainsnak?.datavalue?.value;
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string') {
        return value.id;
    }
    return null;
}

async function readJson(
    fetchImpl: typeof fetch,
    url: URL,
    signal?: AbortSignal,
): Promise<ApiResponse> {
    const response = await fetchImpl(url, { signal });
    if (!response.ok) throw new Error(`Wikibase API returned HTTP ${response.status}: ${url}`);
    return await response.json() as ApiResponse;
}

export async function findActionApi(
    instance: string,
    fetchImpl: typeof fetch,
    signal?: AbortSignal,
): Promise<{
    endpoint: URL;
    namespaces: Record<string, {
        id?: number;
        canonical?: string;
        name?: string;
        defaultcontentmodel?: string;
    }>;
}> {
    const base = new URL(instance);
    const paths = ['/api.php', '/w/api.php'];

    for (const path of paths) {
        const endpoint = new URL(path, base);
        endpoint.search = new URLSearchParams({
            action: 'query',
            meta: 'siteinfo',
            siprop: 'namespaces',
            format: 'json',
        }).toString();
        const response = await fetchImpl(endpoint, { signal });
        if (!response.ok) continue;
        const payload = await response.json() as ApiResponse & {
            query?: {
                namespaces?: Record<string, {
                    id?: number;
                    canonical?: string;
                    name?: string;
                    defaultcontentmodel?: string;
                }>;
            };
        };
        if (payload.query?.namespaces) return { endpoint, namespaces: payload.query.namespaces };
    }

    throw new Error(`Could not locate a working MediaWiki Action API at ${instance}`);
}

export async function getEntityClaims(
    instance: string,
    item: string,
    fetchImpl: typeof fetch = globalThis.fetch,
    signal?: AbortSignal,
): Promise<Record<string, RawClaim[]>> {
    const { endpoint } = await findActionApi(instance, fetchImpl, signal);
    const url = new URL(endpoint);
    url.search = new URLSearchParams({
        action: 'wbgetentities',
        ids: item,
        props: 'claims',
        format: 'json',
    }).toString();
    const payload = await readJson(fetchImpl, url, signal);
    const entity = payload.entities?.[item];
    if (!entity || entity.missing !== undefined) {
        throw new Error(`Wikibase item ${item} does not exist at ${instance}`);
    }
    return entity.claims ?? {};
}

export async function getEntityLanguageData(
    instance: string,
    item: string,
    language: string,
    fetchImpl: typeof fetch = globalThis.fetch,
    signal?: AbortSignal,
): Promise<{ description?: string; aliases: string[] }> {
    const { endpoint } = await findActionApi(instance, fetchImpl, signal);
    const url = new URL(endpoint);
    url.search = new URLSearchParams({
        action: 'wbgetentities',
        ids: item,
        props: 'descriptions|aliases',
        languages: language,
        format: 'json',
    }).toString();
    const payload = await readJson(fetchImpl, url, signal);
    const entity = payload.entities?.[item];
    if (!entity || entity.missing !== undefined) {
        throw new Error(`Wikibase item ${item} does not exist at ${instance}`);
    }
    return {
        ...(entity.descriptions?.[language]?.value && {
            description: entity.descriptions[language].value,
        }),
        aliases: (entity.aliases?.[language] ?? [])
            .flatMap(alias => typeof alias.value === 'string' ? [alias.value] : []),
    };
}

async function readViaActionApi(
    instance: string,
    fetchImpl: typeof fetch,
): Promise<KnownWiki[]> {
    const { endpoint, namespaces } = await findActionApi(instance, fetchImpl);
    const itemNamespace = Object.values(namespaces).find(namespace =>
        namespace.canonical === 'Item' || namespace.name === 'Item',
    );
    if (itemNamespace?.id === undefined) {
        throw new Error(`Could not find the Wikibase Item namespace at ${instance}`);
    }

    const itemIds: string[] = [];
    const continuation = new URLSearchParams({
        action: 'query',
        list: 'allpages',
        apnamespace: String(itemNamespace.id),
        aplimit: 'max',
        format: 'json',
    });

    while (true) {
        const url = new URL(endpoint);
        url.search = continuation.toString();
        const payload = await readJson(fetchImpl, url);
        const query = payload.query as { allpages?: Array<{ title?: string }> } | undefined;
        if (!Array.isArray(query?.allpages)) {
            throw new Error(`Wikibase API returned no item pages for ${instance}`);
        }
        for (const page of query.allpages) {
            const id = page.title?.match(/(?:^|:)Q\d+$/)?.[0].replace(/^:/, '');
            if (id) itemIds.push(id);
        }

        if (!payload.continue) break;
        continuation.delete('continue');
        for (const [key, value] of Object.entries(payload.continue)) {
            continuation.set(key, value);
        }
    }

    const wikis: KnownWiki[] = [];
    for (let offset = 0; offset < itemIds.length; offset += 50) {
        const url = new URL(endpoint);
        url.search = new URLSearchParams({
            action: 'wbgetentities',
            ids: itemIds.slice(offset, offset + 50).join('|'),
            props: 'claims',
            format: 'json',
        }).toString();
        const payload = await readJson(fetchImpl, url);

        for (const [item, entity] of Object.entries(payload.entities ?? {})) {
            const type = claimValue(entity, 'P3');
            const site = claimValue(entity, 'P1');
            if (type === 'Q10' && site) {
                const hostItem = claimValue(entity, 'P2') ?? undefined;
                const statusItem = claimValue(entity, 'P13') ?? undefined;
                wikis.push({ item, site, ...(hostItem && { hostItem }), ...(statusItem && { statusItem }) });
            }
        }
    }

    return wikis;
}

async function readViaSparql(
    endpoint: string,
    instance: string,
    fetchImpl: typeof fetch,
): Promise<KnownWiki[]> {
    const base = new URL(instance).origin;
    const query = `
      PREFIX wdt: <${base}/prop/direct/>
      PREFIX wd: <${base}/entity/>
      SELECT ?item ?site ?host ?status WHERE {
        ?item wdt:P3 wd:Q10;
          wdt:P1 ?site.
        OPTIONAL { ?item wdt:P2 ?host. }
        OPTIONAL { ?item wdt:P13 ?status. }
      }
    `;
    const url = new URL(endpoint);
    url.search = new URLSearchParams({ query, format: 'json' }).toString();
    const response = await fetchImpl(url, { headers: { Accept: 'application/sparql-results+json' } });
    if (response.status === 404) return readViaActionApi(instance, fetchImpl);
    if (!response.ok) throw new Error(`SPARQL endpoint returned HTTP ${response.status}: ${url}`);

    const payload = await response.json() as SparqlResponse;
    const bindings = payload.results?.bindings;
    if (!Array.isArray(bindings)) throw new Error(`SPARQL endpoint returned invalid results: ${url}`);
    const wikis = new Map<string, KnownWiki>();
    for (const binding of bindings) {
        const item = binding.item?.value?.match(/Q\d+$/)?.[0];
        const site = binding.site?.value;
        const hostItem = binding.host?.value?.match(/Q\d+$/)?.[0];
        const statusItem = binding.status?.value?.match(/Q\d+$/)?.[0];
        if (!item || !site) continue;
        const previous = wikis.get(item);
        wikis.set(item, {
            item,
            site,
            ...((hostItem ?? previous?.hostItem) && { hostItem: hostItem ?? previous?.hostItem }),
            ...((statusItem ?? previous?.statusItem) && { statusItem: statusItem ?? previous?.statusItem }),
        });
    }
    return [...wikis.values()];
}

export async function loadKnownWikis(
    instance: string,
    { sparqlEndpoint, fetch: fetchImpl = globalThis.fetch }: WikiReaderOptions = {},
): Promise<KnownWiki[]> {
    const endpoint = sparqlEndpoint ?? new URL('/query/sparql', instance).toString();
    return readViaSparql(endpoint, instance, fetchImpl);
}

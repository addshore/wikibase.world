interface ApiResponse {
    query?: {
        allpages?: Array<{ title?: string }>;
        logevents?: Array<{ title?: string }>;
    };
    continue?: Record<string, string>;
    warnings?: unknown;
}

export interface EntityMetricOptions {
    fetch?: typeof globalThis.fetch;
    signal?: AbortSignal;
    propertyCountLimit?: number;
}

export interface EntityMetricNamespaces {
    item?: number;
    property?: number;
}

async function readApiResponse(
    endpoint: URL,
    params: URLSearchParams,
    fetchImpl: typeof globalThis.fetch,
    signal?: AbortSignal,
): Promise<ApiResponse> {
    const url = new URL(endpoint);
    url.search = params.toString();
    const response = await fetchImpl(url, { signal });
    if (!response.ok) {
        throw new Error(`MediaWiki API returned HTTP ${response.status}: ${url}`);
    }
    return await response.json() as ApiResponse;
}

export async function countNamespacePages(
    endpoint: URL,
    namespaceId: number,
    {
        fetch: fetchImpl = globalThis.fetch,
        signal,
        propertyCountLimit = 20 * 500,
    }: EntityMetricOptions = {},
): Promise<number | undefined> {
    let count = 0;
    let continuation: Record<string, string> = {};

    do {
        const params = new URLSearchParams({
            action: 'query',
            list: 'allpages',
            apnamespace: String(namespaceId),
            aplimit: '500',
            format: 'json',
            ...continuation,
        });
        const payload = await readApiResponse(endpoint, params, fetchImpl, signal);
        if (payload.warnings || !Array.isArray(payload.query?.allpages)) {
            throw new Error(`MediaWiki API returned invalid allpages data for namespace ${namespaceId}`);
        }
        count += payload.query.allpages.length;
        if (count > propertyCountLimit) return undefined;
        continuation = payload.continue ?? {};
    } while (Object.keys(continuation).length > 0);

    return count;
}

export async function fetchMaxItemId(
    endpoint: URL,
    namespaceId: number,
    {
        fetch: fetchImpl = globalThis.fetch,
        signal,
    }: EntityMetricOptions = {},
): Promise<number | undefined> {
    const payload = await readApiResponse(endpoint, new URLSearchParams({
        action: 'query',
        list: 'logevents',
        lenamespace: String(namespaceId),
        letype: 'create',
        lelimit: '1',
        leprop: 'title',
        format: 'json',
    }), fetchImpl, signal);
    if (payload.warnings) {
        throw new Error(`MediaWiki API returned warnings for item creation logs`);
    }
    const title = payload.query?.logevents?.[0]?.title;
    const itemId = title?.match(/(?:^|:)Q(\d+)$/)?.[1];
    if (!itemId) return undefined;
    const numericId = Number(itemId);
    return Number.isSafeInteger(numericId) ? numericId : undefined;
}

export async function fetchEntityMetrics(
    endpoint: URL,
    namespaces: EntityMetricNamespaces,
    options: EntityMetricOptions = {},
): Promise<{ propertyCount?: number; maxItemId?: number }> {
    const [propertyCount, maxItemId] = await Promise.all([
        namespaces.property === undefined
            ? Promise.resolve(undefined)
            : countNamespacePages(endpoint, namespaces.property, options),
        namespaces.item === undefined
            ? Promise.resolve(undefined)
            : fetchMaxItemId(endpoint, namespaces.item, options),
    ]);
    return {
        ...(propertyCount !== undefined && { propertyCount }),
        ...(maxItemId !== undefined && { maxItemId }),
    };
}

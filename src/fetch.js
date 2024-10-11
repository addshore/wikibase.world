import NodeFetchCache, { FileSystemCache } from 'node-fetch-cache';

const fetchCachedInternal = NodeFetchCache.create({
    cache: new FileSystemCache({
        cacheDirectory: './.cache',
        ttl: 60*30,
    }),
});
const fetchuc = async (url, options) => {
    // console.log(`🚀 Fetching ${url} (uncached)`)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 100000);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timeoutId);
    }
}
const fetchc = async (url, options) => {
    // console.log(`🚀 Fetching ${url} (caching)`)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 100000);
    try {
        return await fetchCachedInternal(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timeoutId);
    }
}

export { fetchuc, fetchc };
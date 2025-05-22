import NodeFetchCache, { FileSystemCache } from 'node-fetch-cache';

const fetchCachedInternal = NodeFetchCache.create({
    cache: new FileSystemCache({
        cacheDirectory: './.cache',
        ttl: 60*30,
    }),
});
const fetchuc = async (url, options) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 100000);
    try {
        let response;
        do {
            response = await fetch(url, { ...options, signal: controller.signal });
            if (response.status === 429) {
                console.log('↩️⏸️ 429 Too Many Requests, retrying in 10 seconds for fetchuc url:', url);
                await new Promise(resolve => setTimeout(resolve, 10000)); //60s
                console.log('↩️ Retrying now for fetchuc url:', url);
            }
        } while (response.status === 429);
        return response;
    } catch (error) {
        if (error.name === 'AbortError') {
            console.error('Fetch aborted for fetchuc url:', url);
        } else {
            console.error('Fetch error for fetchuc url:', url, error);
        }
    } finally {
        clearTimeout(timeoutId);
    }
}

// Original fetchc implementation
const originalFetchc = async (url, options) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 100000);
    try {
        let response;
        do {
            response = await fetchCachedInternal(url, { ...options, signal: controller.signal });
            if (response.status === 429) {
                console.log('↩️⏸️ 429 Too Many Requests, retrying in 10 seconds for fetchc url:', url);
                await new Promise(resolve => setTimeout(resolve, 10000)); //60s
                console.log('↩️ Retrying now for fetchc url:', url);
            }
        } while (response.status === 429);
        return response;
    } catch (error) {
        if (error.name === 'AbortError') {
            console.error('Fetch aborted for fetchc url:', url);
        } else {
            console.error('Fetch error for fetchc url:', url, error);
        }
    } finally {
        clearTimeout(timeoutId);
    }
};

// currentFetchc initially points to the original implementation
let currentFetchc = originalFetchc;

// Exported fetchc that will be used by other modules
const fetchc = async (url, options) => {
    return currentFetchc(url, options);
};

// Exported function to set a mock implementation for fetchc
const setMockFetchc = (mockFunction) => {
    currentFetchc = mockFunction;
};

export { fetchuc, fetchc, setMockFetchc };
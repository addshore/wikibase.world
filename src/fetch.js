import NodeFetchCache, { FileSystemCache } from 'node-fetch-cache';
import process from 'node:process';
import { lookup } from 'node:dns/promises';
import { queueStats } from './general.js';

const fetchCachedInternal = NodeFetchCache.create({
    cache: new FileSystemCache({
        cacheDirectory: './.cache',
        ttl: 60*30,
    }),
});

const envFlag = (name) => {
    const value = process.env[name]?.toLowerCase();
    return value === '1' || value === 'true' || value === 'yes';
};

const envInt = (name, fallback) => {
    const raw = process.env[name];
    if (raw === undefined || raw === '') {
        return fallback;
    }

    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed) || parsed < 0) {
        console.warn(`⚠️ Invalid ${name} value "${raw}", using ${fallback}`);
        return fallback;
    }

    return parsed;
};

const FETCH_TIMEOUT_MS = envInt('FETCH_TIMEOUT_MS', 10000);
const FETCH_RETRY_DELAY_MS = envInt('FETCH_RETRY_DELAY_MS', 10000);
const FETCH_SLOW_LOG_MS = envInt('FETCH_SLOW_LOG_MS', 5000);
const FETCH_DEBUG = envFlag('FETCH_DEBUG');
const FETCH_DEBUG_DNS = envFlag('FETCH_DEBUG_DNS');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const sanitizeOptions = (options = {}) => {
    const fetchOptions = { ...options };
    const debugLabel = fetchOptions.debugLabel;
    const timeoutMs = fetchOptions.timeoutMs;
    const diagnostics = fetchOptions.diagnostics;

    delete fetchOptions.debugLabel;
    delete fetchOptions.timeoutMs;
    delete fetchOptions.diagnostics;

    return {
        fetchOptions,
        debugLabel,
        timeoutMs,
        diagnostics,
    };
};

const getMethod = (options) => options?.method || 'GET';

const getUrlString = (url) => {
    if (typeof url === 'string') {
        return url;
    }

    if (typeof url?.url === 'string') {
        return url.url;
    }

    return String(url);
};

const summarizeQueues = () => {
    const stats = queueStats();
    return {
        many: { size: stats.many.size, pending: stats.many.pending },
        four: { size: stats.four.size, pending: stats.four.pending },
        one: { size: stats.one.size, pending: stats.one.pending },
    };
};

const lookupHostDetails = async (urlString) => {
    if (!FETCH_DEBUG_DNS) {
        return undefined;
    }

    try {
        const hostname = new URL(urlString).hostname;
        const addresses = await lookup(hostname, { all: true, verbatim: true });
        return {
            hostname,
            addresses: addresses.map(address => `${address.address}/${address.family}`),
        };
    } catch (error) {
        return {
            dnsLookupFailed: true,
            message: error.message,
            code: error.code,
        };
    }
};

const buildLogContext = async ({ kind, url, options, attempt, elapsedMs, timeoutMs, error, debugLabel, diagnostics }) => {
    const urlString = getUrlString(url);
    const method = getMethod(options);
    const context = {
        fetcher: kind,
        method,
        url: urlString,
        debugLabel: debugLabel || undefined,
        attempt,
        elapsedMs,
        timeoutMs,
        queueStats: summarizeQueues(),
        diagnostics: diagnostics || undefined,
        errorName: error?.name,
        errorMessage: error?.message,
        errorCode: error?.code,
        errorErrno: error?.errno,
        errorType: error?.type,
        cause: error?.cause?.message || error?.cause,
    };

    if (error?.stack && FETCH_DEBUG) {
        context.stack = error.stack;
    }

    try {
        const parsed = new URL(urlString);
        context.host = parsed.host;
        context.pathname = parsed.pathname;
    } catch {
        // Ignore URL parsing failures in diagnostics.
    }

    if (error?.name === 'AbortError') {
        context.abortReason = error?.cause?.message || error?.cause || `Timed out after ${timeoutMs}ms`;
        context.network = await lookupHostDetails(urlString);
    }

    return context;
};

const createTimeoutError = (kind, method, urlString, timeoutMs, attempt, debugLabel) => {
    return new Error(`${kind} ${method} ${urlString} timed out after ${timeoutMs}ms on attempt ${attempt}${debugLabel ? ` (${debugLabel})` : ''}`);
};

const runFetch = async (kind, fetchImpl, url, options = {}) => {
    const { fetchOptions, debugLabel, timeoutMs: perRequestTimeoutMs, diagnostics } = sanitizeOptions(options);
    const timeoutMs = perRequestTimeoutMs ?? FETCH_TIMEOUT_MS;
    const urlString = getUrlString(url);
    const method = getMethod(fetchOptions);
    const startedAt = Date.now();
    let attempt = 0;

    while (true) {
        attempt++;
        const controller = new AbortController();
        const timeoutId = timeoutMs > 0
            ? setTimeout(() => controller.abort(createTimeoutError(kind, method, urlString, timeoutMs, attempt, debugLabel)), timeoutMs)
            : null;

        try {
            const response = await fetchImpl(url, { ...fetchOptions, signal: controller.signal });
            const elapsedMs = Date.now() - startedAt;

            if (FETCH_DEBUG && elapsedMs >= FETCH_SLOW_LOG_MS) {
                console.log('🐢 Slow fetch', {
                    fetcher: kind,
                    method,
                    url: urlString,
                    debugLabel: debugLabel || undefined,
                    attempt,
                    elapsedMs,
                    status: response?.status,
                    returnedFromCache: response?.returnedFromCache,
                    queueStats: summarizeQueues(),
                    diagnostics: diagnostics || undefined,
                });
            }

            if (response.status === 429) {
                console.log(`↩️⏸️ 429 Too Many Requests, retrying in ${FETCH_RETRY_DELAY_MS}ms for ${kind} ${method} url:`, urlString);
                await sleep(FETCH_RETRY_DELAY_MS);
                console.log(`↩️ Retrying now for ${kind} ${method} url:`, urlString);
                continue;
            }

            return response;
        } catch (error) {
            const elapsedMs = Date.now() - startedAt;
            const context = await buildLogContext({
                kind,
                url,
                options: fetchOptions,
                attempt,
                elapsedMs,
                timeoutMs,
                error,
                debugLabel,
                diagnostics,
            });

            if (error.name === 'AbortError') {
                console.error('Fetch aborted', context);
            } else {
                console.error('Fetch error', context);
            }

            return null;
        } finally {
            if (timeoutId !== null) {
                clearTimeout(timeoutId);
            }
        }
    }
};

const fetchuc = async (url, options) => runFetch('fetchuc', fetch, url, options);

// Original fetchc implementation
const originalFetchc = async (url, options) => runFetch('fetchc', fetchCachedInternal, url, options);

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
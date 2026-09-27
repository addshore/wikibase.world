import type { WikiVerifier } from './model.js';

export interface WikibaseVerifierOptions {
    fetch?: typeof globalThis.fetch;
    timeoutMs?: number;
}

function getEditApiUrl(link: string | null, html: string | null, base: string): URL | null {
    const linkedApi = link?.match(/<([^>]+)>;\s*rel="EditURI"/i)?.[1];
    const htmlApi = html?.match(/<link\b[^>]*rel="EditURI"[^>]*href="([^"]+)"/i)?.[1];
    const href = linkedApi ?? htmlApi;
    if (!href) return null;

    const apiUrl = new URL(href, base);
    apiUrl.searchParams.delete('action');
    apiUrl.hash = '';
    return apiUrl;
}

export function createWikibaseVerifier({
    fetch: fetchImpl = globalThis.fetch,
    timeoutMs = 10_000,
}: WikibaseVerifierOptions = {}): WikiVerifier {
    return {
        async verify(site) {
            let siteUrl: URL;
            try {
                siteUrl = new URL(site);
            } catch {
                return null;
            }
            if (!['http:', 'https:'].includes(siteUrl.protocol) || !siteUrl.hostname) return null;

            const headers = { 'User-Agent': 'Wikibase World importer' };
            const signal = AbortSignal.timeout(timeoutMs);
            let headResponse: Response | undefined;
            try {
                headResponse = await fetchImpl(siteUrl, { method: 'HEAD', headers, signal });
            } catch {
                // Some MediaWiki installations reject HEAD; the GET below is the fallback.
            }

            let pageHtml: string | null = null;
            let finalSite = headResponse?.url || siteUrl.toString();
            let editApiUrl = headResponse?.ok
                ? getEditApiUrl(headResponse.headers.get('Link'), null, finalSite)
                : null;

            if (!editApiUrl) {
                const pageResponse = await fetchImpl(siteUrl, { headers, signal });
                pageHtml = await pageResponse.text();
                finalSite = pageResponse.url || finalSite;
                const pageLooksValid = pageResponse.status === 200 ||
                    (pageResponse.status === 404 &&
                        pageHtml.includes('There is currently no text in this page'));
                if (!pageLooksValid) return null;
                editApiUrl = getEditApiUrl(null, pageHtml, finalSite);
            }
            if (!editApiUrl) return null;

            const versionUrl = new URL(editApiUrl);
            versionUrl.pathname = versionUrl.pathname.replace(/api\.php$/, 'index.php');
            versionUrl.search = new URLSearchParams({ title: 'Special:Version' }).toString();
            const versionResponse = await fetchImpl(versionUrl, { headers, signal });
            if (!versionResponse.ok) return null;
            const versionHtml = await versionResponse.text();
            if (!versionHtml.includes('mw-version-ext-wikibase-WikibaseRepository')) return null;

            const finalUrl = new URL(finalSite);
            const canonicalSite = new URL(siteUrl.pathname, finalUrl.origin);
            canonicalSite.search = '';
            canonicalSite.hash = '';
            canonicalSite.pathname = canonicalSite.pathname.replace(/\/+$/, '');
            return { site: canonicalSite.toString().replace(/\/$/, '') };
        },
    };
}

export const mediaWikiWikibaseVerifier = createWikibaseVerifier();

import { canonicalSiteKey } from '../site-key.js';
import type { WikiCandidate } from '../model.js';

export interface UrlListSourceOptions {
    hostItem?: string;
}

function normalizeUrl(input: string): URL {
    const value = input.trim();
    if (!value) throw new Error('URL list contains a blank entry');
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
        throw new Error(`URL list contains a non-HTTP site: ${input}`);
    }
    url.hash = '';
    return url;
}

export function createUrlListSource(
    entries: string[],
    { hostItem }: UrlListSourceOptions = {},
) {
    return {
        async discover(): Promise<WikiCandidate[]> {
            const candidates = new Map<string, WikiCandidate>();

            for (const entry of entries) {
                let url: URL;
                try {
                    url = normalizeUrl(entry);
                } catch (error) {
                    throw new Error(`Invalid URL list entry "${entry}"`, { cause: error });
                }

                const site = url.toString().replace(/\/$/, '');
                const key = canonicalSiteKey(site);
                if (candidates.has(key)) continue;
                candidates.set(key, {
                    source: 'URL list',
                    site,
                    label: url.hostname,
                    claims: {
                        P1: site,
                        P3: 'Q10',
                        ...(hostItem && { P2: hostItem }),
                    },
                });
            }

            return [...candidates.values()];
        },
    };
}

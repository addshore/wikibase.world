import type { WikiCandidate } from '../model.js';

export interface GoogleSearchOptions {
    engine: 'google';
    api_key: string;
    q: string;
    location: string;
    num: number;
    nfpr: 1;
}

export interface GoogleSearchResponse {
    organic_results?: Array<{ link?: string }>;
    error?: string;
}

export type GoogleSearch = (options: GoogleSearchOptions) => Promise<GoogleSearchResponse>;

export interface GoogleSourceOptions {
    apiKey?: string;
    search: GoogleSearch;
}

const ignoredDomains = [
    'wikidata.org', 'openstreetmap.org', 'wikimedia.org', 'mediawiki.org',
    'wikipedia.org', 'wikinews.org', 'wikifunctions.org', 'github.com',
    'githubusercontent.com', 'nist.gov', 'withgoogle.com', 'reddit.com',
    'facebook.com', 'instagram.com', 'twitter.com', 'amazon.com', 'mozilla.org',
    'learningwikibase.com', 'translatewiki.net', 'addshore.com', 'cisa.gov',
    'tiktok.com', 'sony.jp', 'books.jq', 'quora.com', 'mail-archive.com',
    'mitre.org', 'linkedin.com', 'medium.com', 'wikimedia.de', 'readthedocs.io',
    'amazonaws.com', 'youtube.com', 'wikibase.cloud',
];

function buildQuery(): string {
    const pages = ['NewItem', 'NewProperty'].map(page => `"Special:${page}"`).join(' OR ');
    const exclusions = ignoredDomains.map(domain => `-site:${domain}`).join(' ');
    return `(${pages}) ${exclusions}`;
}

export function createGoogleSearchSource({ apiKey, search }: GoogleSourceOptions) {
    return {
        async discover(): Promise<WikiCandidate[]> {
            if (!apiKey) throw new Error('SERPAPI_KEY is required to use Google discovery');

            const response = await search({
                engine: 'google',
                api_key: apiKey,
                q: buildQuery(),
                location: 'Austin, Texas',
                num: 100,
                nfpr: 1,
            });
            if (response.error) throw new Error(`Google search failed: ${response.error}`);
            if (!Array.isArray(response.organic_results)) {
                throw new Error('Google search response did not include organic results');
            }

            const domains = new Set<string>();
            for (const result of response.organic_results) {
                if (!result.link) continue;
                try {
                    const domain = new URL(result.link).hostname.toLowerCase();
                    if (!ignoredDomains.some(ignored =>
                        domain === ignored || domain.endsWith(`.${ignored}`),
                    )) {
                        domains.add(domain);
                    }
                } catch {
                    // Malformed organic result links are not import candidates.
                }
            }

            return [...domains].map(domain => {
                const site = `https://${domain}`;
                return {
                    source: 'google',
                    site,
                    label: domain,
                    claims: {
                        P1: site,
                        P3: 'Q10',
                        P13: 'Q54',
                    },
                };
            });
        },
    };
}

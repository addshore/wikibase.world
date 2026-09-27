import { lookup, reverse } from 'node:dns/promises';
import type { WikiClaimSync } from './wiki-sync.js';

const CLOUD_REVERSE_DNS = '221.76.141.34.bc.googleusercontent.com';
const PROFESSIONAL_WIKI_REVERSE_DNS = 'server-108-138-217-36.lhr61.r.cloudfront.net';
const WIKITIDE_REVERSE_DNS = 'cp37.wikitide.net';

export async function lookupReverseDns(hostname: string): Promise<string[]> {
    const { address } = await lookup(hostname);
    const hostnames = await reverse(address);
    return hostnames.map(host => host.toLowerCase());
}

export function planHostClaimSyncs(
    site: string,
    reverseDns: string[] = [],
    homepageHtml = '',
): WikiClaimSync[] {
    const hostname = new URL(site).hostname.toLowerCase();
    const reverseHosts = new Set(reverseDns.map(host => host.toLowerCase()));
    const syncs: WikiClaimSync[] = [];

    const isCloud = hostname.endsWith('.wikibase.cloud') ||
        reverseHosts.has(CLOUD_REVERSE_DNS);
    const isProfessionalWiki = hostname.endsWith('.wikibase.wiki') ||
        reverseHosts.has(PROFESSIONAL_WIKI_REVERSE_DNS) ||
        homepageHtml.includes('w/images/HostedByProfessionalWiki.png');
    const isMiraheze = hostname.endsWith('.miraheze.org') ||
        reverseHosts.has(WIKITIDE_REVERSE_DNS);
    const isWmfLabs = hostname.endsWith('.wmflabs.org');

    if (isCloud) {
        const domain = `https://${hostname}`;
        const queryUrl = `${domain}/query`;
        const sparqlUrl = `${domain}/query/sparql`;
        syncs.push(
            { property: 'P2', value: 'Q8', policy: 'single' },
            { property: 'P7', value: queryUrl, policy: 'single' },
            { property: 'P8', value: sparqlUrl, policy: 'single' },
            { property: 'P49', value: `${domain}/wiki/Main_Page`, policy: 'single' },
            {
                property: 'P37',
                value: 'Q285',
                policy: 'include',
                qualifiers: { P7: queryUrl, P8: sparqlUrl },
            },
            {
                property: 'P37',
                value: 'Q287',
                policy: 'include',
                qualifiers: { P1: `${domain}/tools/cradle` },
            },
            {
                property: 'P37',
                value: 'Q286',
                policy: 'include',
                qualifiers: { P1: `${domain}/tools/quickstatements` },
            },
            { property: 'P12', value: 'Q51', policy: 'include' },
            { property: 'P12', value: 'Q52', policy: 'include' },
        );
    }
    if (isProfessionalWiki) {
        syncs.push({ property: 'P2', value: 'Q7', policy: 'single' });
    }
    if (isMiraheze) {
        syncs.push({ property: 'P2', value: 'Q118', policy: 'single' });
    }
    if (isWmfLabs) {
        syncs.push({ property: 'P2', value: 'Q6', policy: 'single' });
    }

    return syncs;
}

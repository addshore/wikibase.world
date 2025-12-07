/**
 * External Links Fetcher - Fetches external URLs used in item/property namespaces
 * 
 * Subscribes to: wiki.context-ready
 * Emits: wiki.data.external-links
 */

import { eventBus, Events } from '../../events/bus.js';
import { fetchc } from '../../fetch.js';
import { HEADERS } from '../../general.js';

// Domains to ignore when collecting external links
const IGNORED_DOMAINS = [
    'www.wikidata.org',
    'wikibase.world',
    'wikibase-registry.wmflabs.org',
    'commons.wikimedia.org',
];

/**
 * Fetch external links from item and property namespaces
 * @param {string} actionApi - The action API URL
 * @param {number} maxIterations - Maximum number of API calls to make
 * @returns {Promise<Set<string>>} Set of domains found
 */
export async function fetchExternalLinks(actionApi, maxIterations = 350) {
    const domains = new Set();
    let loops = 0;
    let continueToken = '';
    
    do {
        loops++;
        let url = `${actionApi}?format=json&action=query&list=exturlusage&euprotocol=https&eulimit=500&eunamespace=120|122&euprop=url`;
        if (continueToken) {
            url += `&eucontinue=${continueToken}`;
        }
        
        try {
            const response = await fetchc(url, { headers: HEADERS });
            if (!response) break;
            
            const data = await response.json();
            if (!data?.query?.exturlusage) break;
            
            for (const link of data.query.exturlusage) {
                try {
                    let linkUrl = link.url;
                    if (linkUrl.startsWith('//')) {
                        linkUrl = 'https:' + linkUrl;
                    }
                    const domain = new URL(linkUrl).hostname;
                    if (!IGNORED_DOMAINS.includes(domain)) {
                        domains.add(domain);
                    }
                } catch {
                    // Invalid URL, skip
                }
            }
            
            continueToken = data.continue?.eucontinue || '';
        } catch (e) {
            console.log(`❌ Failed to fetch external links: ${e.message}`);
            break;
        }
    } while (continueToken && loops < maxIterations);
    
    if (loops >= maxIterations) {
        console.log(`❌ Too many iterations fetching external links`);
    }
    
    return domains;
}

/**
 * Register the external links fetcher with the event bus
 * @param {Object} queues - Queue instances { many, four, one }
 */
export function register(queues) {
    eventBus.register(Events.WIKI_CONTEXT_READY, 'fetcher:external-links', ({ wiki, worldContext }) => {
        if (!wiki.actionApi) return;
        
        // Skip ignored domains
        const wikiDomain = new URL(wiki.actionApi).hostname;
        if (IGNORED_DOMAINS.includes(wikiDomain)) return;
        
        queues.many.add(async () => {
            const domains = await fetchExternalLinks(wiki.actionApi);
            if (domains.size > 0) {
                eventBus.emit(Events.DATA_EXTERNAL_LINKS, { 
                    wiki, 
                    externalLinkDomains: [...domains],
                    worldContext,
                    queues 
                });
            }
        }, { jobName: `fetch:external-links:${wiki.item}` });
    });
}

export default { register, fetchExternalLinks, IGNORED_DOMAINS };

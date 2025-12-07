/**
 * URL Normalizer Processor - Normalizes Main_Page URLs to shorter form
 * 
 * Subscribes to: wiki.context-ready
 * Property: P1 (URL)
 */

import { eventBus, Events } from '../../../events/bus.js';
import { world } from '../../../world.js';
import { fetchc } from '../../../fetch.js';
import { HEADERS } from '../../../general.js';

const PROPERTY = 'P1';

/**
 * Check if URL can be shortened
 * @param {string} url - The current URL
 * @param {string} originalFinalUrl - The original response URL
 * @returns {Promise<{ canShorten: boolean, shorterUrl: string }>}
 */
export async function canShortenUrl(url, originalFinalUrl) {
    if (!url.includes('/wiki/Main_Page')) {
        return { canShorten: false, shorterUrl: '' };
    }
    
    const shorterUrl = url.replace(/\/wiki\/Main_Page$/, '');
    
    try {
        const newResponse = await fetchc(shorterUrl, { headers: HEADERS });
        if (originalFinalUrl === newResponse?.url) {
            return { canShorten: true, shorterUrl };
        }
        return { canShorten: false, shorterUrl: '' };
    } catch {
        return { canShorten: false, shorterUrl: '' };
    }
}

/**
 * Process URL normalization for wiki
 * @param {Object} context - { wiki, response, queues }
 */
export function process({ wiki, response, queues }) {
    if (!wiki.site?.includes('/wiki/Main_Page')) return;
    
    queues.many.add(async () => {
        const { canShorten, shorterUrl } = await canShortenUrl(wiki.site, response?.url);
        
        if (!canShorten) {
            if (shorterUrl) {
                console.log(`❌ The URL ${wiki.site} cannot be shortened to ${shorterUrl}`);
            }
            return;
        }
        
        // Check for multiple P1 claims
        if (wiki.simpleClaims.P1?.length > 1) {
            console.log(`❌ The item ${wiki.item} has more than 1 P1 claim`);
            return;
        }
        
        world.queueWork.claimUpdate(
            queues.one,
            { id: wiki.item, property: PROPERTY, oldValue: wiki.site, newValue: shorterUrl },
            { summary: 'Shorten Main_Page URL for consistency in [[Property:P1]] usage' }
        );
    }, { jobName: `normalize-url:${wiki.item}` });
}

/**
 * Register the processor with the event bus
 */
export function register() {
    eventBus.register(Events.WIKI_CONTEXT_READY, 'processor:url-normalizer', process);
}

export default { register, process, canShortenUrl, PROPERTY };

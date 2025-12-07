/**
 * Professional Wiki Host Processor - Detects Professional Wiki (The Wikibase Consultancy) hosted wikis
 * 
 * Subscribes to: wiki.context-ready
 * Properties:
 *   - P2 (host) -> Q7 (The Wikibase Consultancy)
 */

import { eventBus, Events } from '../../../events/bus.js';
import { world } from '../../../world.js';
import { fetchc } from '../../../fetch.js';
import { HEADERS } from '../../../general.js';

// Known reverse DNS for Professional Wiki
const REVERSE_WBWIKI = "server-108-138-217-36.lhr61.r.cloudfront.net";

// QID for Professional Wiki / The Wikibase Consultancy
const HOST_QID = 'Q7';

/**
 * Check if page contains Professional Wiki hosting logo
 * @param {string} url - The URL to check
 * @param {string|null} responseText - Pre-fetched response text
 * @returns {Promise<boolean>}
 */
export async function hasHostedByProfessionalWikiLogo(url, responseText = null) {
    try {
        let htmlContent = responseText;
        if (htmlContent === null) {
            const response = await fetchc(url, { headers: HEADERS });
            htmlContent = await response?.text();
        }
        return htmlContent?.includes('w/images/HostedByProfessionalWiki.png') || false;
    } catch {
        return false;
    }
}

/**
 * Check if wiki is hosted by Professional Wiki
 * @param {Object} wiki - Wiki context
 * @returns {Promise<{ isProfessionalWiki: boolean, reason: string }>}
 */
export async function isProfessionalWiki(wiki) {
    if (wiki.site?.endsWith('.wikibase.wiki')) {
        return { isProfessionalWiki: true, reason: 'based on .wikibase.wiki domain' };
    }
    if (wiki.reverseDNS?.includes?.(REVERSE_WBWIKI)) {
        return { isProfessionalWiki: true, reason: 'based on reverse DNS match' };
    }
    if (await hasHostedByProfessionalWikiLogo(wiki.url, wiki.responseText)) {
        return { isProfessionalWiki: true, reason: 'based on footer image presence' };
    }
    return { isProfessionalWiki: false, reason: '' };
}

/**
 * Process Professional Wiki hosted wiki
 * @param {Object} context - { wiki, queues }
 */
export async function process({ wiki, queues }) {
    const { isProfessionalWiki: isHosted, reason } = await isProfessionalWiki(wiki);
    if (!isHosted) return;
    
    // P2 (Host) -> Q7 (The Wikibase Consultancy)
    if (!wiki.simpleClaims.P2 || wiki.simpleClaims.P2[0] !== HOST_QID) {
        world.queueWork.claimEnsure(
            queues.one,
            { id: wiki.item, property: 'P2', value: HOST_QID },
            { summary: `Add [[Property:P2]] claim for [[Item:${HOST_QID}]] ${reason}` }
        );
    }
}

/**
 * Register the processor with the event bus
 */
export function register() {
    eventBus.register(Events.WIKI_CONTEXT_READY, 'processor:host:professional-wiki', process);
}

export default { register, process, isProfessionalWiki, hasHostedByProfessionalWikiLogo, REVERSE_WBWIKI };

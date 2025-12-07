/**
 * Wiki Link Processor - Adds links to/from known wikis based on external links
 * 
 * Subscribes to: wiki.data.external-links
 * Properties:
 *   - P55 (links to wikibase)
 *   - P56 (linked from wikibase)
 */

import { eventBus, Events } from '../../../events/bus.js';
import { world } from '../../../world.js';

const LINKS_TO_PROPERTY = 'P55';
const LINKED_FROM_PROPERTY = 'P56';

// Items to skip linking from (wikibase.world itself, registry)
const SKIP_SOURCE_ITEMS = ['Q3', 'Q58'];

/**
 * Process wiki links based on external link domains
 * @param {Object} context - { wiki, externalLinkDomains, worldContext, queues }
 */
export function process({ wiki, externalLinkDomains, worldContext, queues }) {
    if (!worldContext || !externalLinkDomains?.length) return;
    
    const { worldWikiDomains, worldWikiItems } = worldContext;
    
    // Combine URL domains and formatted external ID domains
    const allDomains = new Set(externalLinkDomains);
    if (wiki.formattedExternalIdDomains) {
        wiki.formattedExternalIdDomains.forEach(d => allDomains.add(d));
    }
    
    // Find domains that are known wikis
    const knownDomains = [...allDomains].filter(domain => worldWikiDomains.includes(domain));
    
    const knownDomainQids = knownDomains.map(domain => {
        const index = worldWikiDomains.indexOf(domain);
        return worldWikiItems[index];
    });
    
    for (const qid of knownDomainQids) {
        // Skip self-links
        if (qid === wiki.item) continue;
        
        // Skip linking from special items
        if (SKIP_SOURCE_ITEMS.includes(wiki.item)) continue;
        
        // Add "links to" claim
        world.queueWork.claimEnsure(
            queues.four,
            { id: wiki.item, property: LINKS_TO_PROPERTY, value: qid },
            { summary: `Add [[Property:${LINKS_TO_PROPERTY}]] via "External Identifiers" and "URLs" to [[Item:${qid}]]` }
        );
        
        // Add "linked from" claim on target
        world.queueWork.claimEnsure(
            queues.four,
            { id: qid, property: LINKED_FROM_PROPERTY, value: wiki.item },
            { summary: `Add [[Property:${LINKED_FROM_PROPERTY}]] via "External Identifiers" and "URLs" from [[Item:${wiki.item}]]` }
        );
    }
}

/**
 * Register the processor with the event bus
 */
export function register() {
    eventBus.register(Events.DATA_EXTERNAL_LINKS, 'processor:wiki-links', process);
}

export default { register, process, LINKS_TO_PROPERTY, LINKED_FROM_PROPERTY, SKIP_SOURCE_ITEMS };

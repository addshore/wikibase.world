/**
 * Miraheze Host Processor - Detects Miraheze/Wikitide hosted wikis
 * 
 * Subscribes to: wiki.context-ready
 * Properties:
 *   - P2 (host) -> Q118 (Miraheze)
 */

import { eventBus, Events } from '../../../events/bus.js';
import { world } from '../../../world.js';

// Known reverse DNS for Wikitide (Miraheze)
const REVERSE_WIKITIDE = "cp37.wikitide.net";

// QID for Miraheze
const HOST_QID = 'Q118';

/**
 * Check if wiki is hosted on Miraheze
 * @param {Object} wiki - Wiki context
 * @returns {{ isMiraheze: boolean, reason: string }}
 */
export function isMiraheze(wiki) {
    if (wiki.site?.endsWith('.miraheze.org')) {
        return { isMiraheze: true, reason: 'based on .miraheze.org domain' };
    }
    if (wiki.reverseDNS?.includes?.(REVERSE_WIKITIDE)) {
        return { isMiraheze: true, reason: 'based on reverse DNS match' };
    }
    return { isMiraheze: false, reason: '' };
}

/**
 * Process Miraheze hosted wiki
 * @param {Object} context - { wiki, queues }
 */
export function process({ wiki, queues }) {
    const { isMiraheze: isHosted, reason } = isMiraheze(wiki);
    if (!isHosted) return;
    
    // P2 (Host) -> Q118 (Miraheze)
    if (!wiki.simpleClaims.P2 || wiki.simpleClaims.P2[0] !== HOST_QID) {
        world.queueWork.claimEnsure(
            queues.one,
            { id: wiki.item, property: 'P2', value: HOST_QID },
            { summary: `Add [[Property:P2]] claim for [[Item:${HOST_QID}]] based on [[Property:P1]] of ${wiki.site} ${reason}` }
        );
    }
}

/**
 * Register the processor with the event bus
 */
export function register() {
    eventBus.register(Events.WIKI_CONTEXT_READY, 'processor:host:miraheze', process);
}

export default { register, process, isMiraheze, REVERSE_WIKITIDE };

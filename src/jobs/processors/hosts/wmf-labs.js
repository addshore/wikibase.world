/**
 * WMF Labs Host Processor - Detects Wikimedia Foundation Labs hosted wikis
 * 
 * Subscribes to: wiki.context-ready
 * Properties:
 *   - P2 (host) -> Q6 (WMF Labs)
 */

import { eventBus, Events } from '../../../events/bus.js';
import { world } from '../../../world.js';

// QID for WMF Labs
const HOST_QID = 'Q6';

/**
 * Check if wiki is hosted on WMF Labs
 * @param {Object} wiki - Wiki context
 * @returns {{ isWmfLabs: boolean, reason: string }}
 */
export function isWmfLabs(wiki) {
    if (wiki.site?.endsWith('.wmflabs.org')) {
        return { isWmfLabs: true, reason: 'based on .wmflabs.org domain' };
    }
    return { isWmfLabs: false, reason: '' };
}

/**
 * Process WMF Labs hosted wiki
 * @param {Object} context - { wiki, queues }
 */
export function process({ wiki, queues }) {
    const { isWmfLabs: isHosted, reason } = isWmfLabs(wiki);
    if (!isHosted) return;
    
    // P2 (Host) -> Q6 (WMF Labs)
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
    eventBus.register(Events.WIKI_CONTEXT_READY, 'processor:host:wmf-labs', process);
}

export default { register, process, isWmfLabs };

/**
 * Activity Status Processor - Sets activity status (P13) when wiki is alive
 * 
 * Subscribes to: wiki.context-ready
 * Property: P13 (activity status)
 */

import { eventBus, Events } from '../../../events/bus.js';
import { world } from '../../../world.js';

const PROPERTY = 'P13';
const ACTIVE_QID = 'Q54';

/**
 * Process activity status for wiki
 * @param {Object} context - { wiki, queues }
 */
export function process({ wiki, queues }) {
    // If the item does not have a P13 claim, then ensure P13 -> Q54 (active)
    // Note: This doesn't change existing claims, as redirects are followed
    if (!wiki.simpleClaims.P13) {
        world.queueWork.claimEnsure(
            queues.one,
            { id: wiki.item, property: PROPERTY, value: ACTIVE_QID },
            { summary: `Add [[Property:${PROPERTY}]] claim for [[Item:${ACTIVE_QID}]] based on the fact it responds with a 200 of MediaWiki` }
        );
    }
}

/**
 * Register the processor with the event bus
 */
export function register() {
    eventBus.register(Events.WIKI_CONTEXT_READY, 'processor:activity-status', process);
}

export default { register, process, PROPERTY, ACTIVE_QID };

/**
 * Max Item ID Processor - Updates max item ID (P67) from entity counts
 * 
 * Subscribes to: wiki.data.max-item-id
 * Property: P67 (max item ID)
 */

import { eventBus, Events } from '../../../events/bus.js';
import { ensureNumericClaim } from '../../../claims/helpers.js';

const PROPERTY = 'P67';
const PROPERTY_NAME = 'max item ID';

/**
 * Process max item ID
 * @param {Object} context - { wiki, maxItemId, queues }
 */
export function process({ wiki, maxItemId, queues }) {
    if (maxItemId === null || maxItemId === undefined) return;
    
    ensureNumericClaim({
        queue: queues.one,
        wiki,
        property: PROPERTY,
        value: maxItemId,
        summaryAdd: `Add [[Property:${PROPERTY}]] claim for ${maxItemId} based on the last created item`,
        summaryUpdate: `Update [[Property:${PROPERTY}]] claim from {old} to {new} (delta: {delta}) based on the last created item`
    });
}

/**
 * Register the processor with the event bus
 */
export function register() {
    eventBus.register(Events.DATA_MAX_ITEM_ID, 'processor:max-item-id', process);
}

export default { register, process, PROPERTY, PROPERTY_NAME };

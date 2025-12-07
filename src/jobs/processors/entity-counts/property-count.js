/**
 * Property Count Processor - Updates property count (P58) from entity counts
 * 
 * Subscribes to: wiki.data.property-count
 * Property: P58 (number of properties)
 */

import { eventBus, Events } from '../../../events/bus.js';
import { ensureNumericClaim } from '../../../claims/helpers.js';

const PROPERTY = 'P58';
const PROPERTY_NAME = 'number of properties';

/**
 * Process property count
 * @param {Object} context - { wiki, propertyCount, queues }
 */
export function process({ wiki, propertyCount, queues }) {
    if (propertyCount === null || propertyCount === undefined) return;
    
    ensureNumericClaim({
        queue: queues.one,
        wiki,
        property: PROPERTY,
        value: propertyCount,
        summaryAdd: `Add [[Property:${PROPERTY}]] claim for ${propertyCount} based on ${PROPERTY_NAME} in the property namespace`,
        summaryUpdate: `Update [[Property:${PROPERTY}]] claim from {old} to {new} (delta: {delta}) based on ${PROPERTY_NAME} in the property namespace`
    });
}

/**
 * Register the processor with the event bus
 */
export function register() {
    eventBus.register(Events.DATA_PROPERTY_COUNT, 'processor:property-count', process);
}

export default { register, process, PROPERTY, PROPERTY_NAME };

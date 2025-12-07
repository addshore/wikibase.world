/**
 * Example Processor Template
 * 
 * This file shows how to create a new processor that listens
 * to a specific data event and produces claim updates.
 * 
 * To use this template:
 * 1. Copy this file to the appropriate processor directory
 * 2. Rename the file and update the constants
 * 3. Implement the process function
 * 4. Add the processor to the directory's index.js
 */

import { eventBus, Events } from '../../../events/bus.js';
import { ensureStringClaim } from '../../../claims/helpers.js';
// import { ensureNumericClaim } from '../../../claims/helpers.js'; // Uncomment for numeric claims
// import { world } from '../../../world.js'; // Uncomment if you need direct world access

// Configuration - update these for your processor
const PROPERTY = 'P99';           // The property ID this processor handles
const PROPERTY_NAME = 'Example';   // Human-readable name for summaries

/**
 * Process function - called when the subscribed event fires
 * 
 * @param {Object} context - Event context containing:
 *   @param {Object} context.wiki - Wiki context with item, simpleClaims, entity, etc.
 *   @param {Object} context.siteinfo - (if listening to DATA_SITEINFO) The siteinfo data
 *   @param {Object} context.queues - Queue instances { many, four, one }
 */
export function process({ wiki, siteinfo, queues }) {
    // 1. Extract the value from the data
    const value = siteinfo?.general?.someField;
    
    // 2. Return early if value not available
    if (!value) return;
    
    // 3. Use helpers to ensure/update the claim
    // For string values:
    ensureStringClaim({
        queue: queues.one,
        wiki,
        property: PROPERTY,
        value: String(value),
        summaryAdd: `Add [[Property:${PROPERTY}]] claim for ${value} based on ${PROPERTY_NAME} from siteinfo`,
        summaryUpdate: `Update [[Property:${PROPERTY}]] claim from {old} to {new} based on ${PROPERTY_NAME} from siteinfo`
    });
    
    // For numeric values with logarithmic threshold:
    // ensureNumericClaim({
    //     queue: queues.one,
    //     wiki,
    //     property: PROPERTY,
    //     value: Number(value),
    //     summaryAdd: `Add [[Property:${PROPERTY}]] claim for ${value}`,
    //     summaryUpdate: `Update [[Property:${PROPERTY}]] claim from {old} to {new} (delta: {delta})`
    // });
}

/**
 * Register this processor with the event bus
 * 
 * Choose the appropriate event to listen to:
 * - Events.DATA_SITEINFO - After siteinfo is fetched
 * - Events.DATA_INCEPTION - After inception date is fetched
 * - Events.DATA_MANIFEST - After manifest is fetched
 * - Events.DATA_PROPERTY_COUNT - After property count is calculated
 * - Events.DATA_MAX_ITEM_ID - After max item ID is calculated
 * - Events.DATA_EXTERNAL_LINKS - After external links are collected
 * - Events.WIKI_CONTEXT_READY - After all basic wiki context is built
 */
export function register() {
    eventBus.register(
        Events.DATA_SITEINFO,           // The event to listen to
        'processor:example',             // Unique name for this handler
        process                          // The handler function
    );
}

// Export the module
export default { register, process, PROPERTY, PROPERTY_NAME };

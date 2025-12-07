/**
 * Database Type Processor - Extracts and updates database type (P69) from siteinfo
 * 
 * Subscribes to: wiki.data.siteinfo
 * Property: P69 (database type)
 */

import { eventBus, Events } from '../../../events/bus.js';
import { ensureStringClaim } from '../../../claims/helpers.js';

const PROPERTY = 'P69';
const PROPERTY_NAME = 'database type';

/**
 * Process database type from siteinfo
 * @param {Object} context - { wiki, siteinfo, queues }
 */
export function process({ wiki, siteinfo, queues }) {
    const dbtype = siteinfo?.general?.dbtype;
    if (!dbtype) return;
    
    ensureStringClaim({
        queue: queues.one,
        wiki,
        property: PROPERTY,
        value: dbtype,
        summaryAdd: `Add [[Property:${PROPERTY}]] claim for ${dbtype} based on ${PROPERTY_NAME} from siteinfo`,
        summaryUpdate: `Update [[Property:${PROPERTY}]] claim from {old} to {new} based on ${PROPERTY_NAME} from siteinfo`
    });
}

/**
 * Register the processor with the event bus
 */
export function register() {
    eventBus.register(Events.DATA_SITEINFO, 'processor:db-type', process);
}

export default { register, process, PROPERTY, PROPERTY_NAME };

/**
 * Database Version Processor - Extracts and updates database version (P70) from siteinfo
 * 
 * Subscribes to: wiki.data.siteinfo
 * Property: P70 (database version)
 */

import { eventBus, Events } from '../../../events/bus.js';
import { ensureStringClaim } from '../../../claims/helpers.js';

const PROPERTY = 'P70';
const PROPERTY_NAME = 'database version';

/**
 * Process database version from siteinfo
 * @param {Object} context - { wiki, siteinfo, queues }
 */
export function process({ wiki, siteinfo, queues }) {
    const dbversion = siteinfo?.general?.dbversion;
    if (!dbversion) return;
    
    ensureStringClaim({
        queue: queues.one,
        wiki,
        property: PROPERTY,
        value: dbversion,
        summaryAdd: `Add [[Property:${PROPERTY}]] claim for ${dbversion} based on ${PROPERTY_NAME} from siteinfo`,
        summaryUpdate: `Update [[Property:${PROPERTY}]] claim from {old} to {new} based on ${PROPERTY_NAME} from siteinfo`
    });
}

/**
 * Register the processor with the event bus
 */
export function register() {
    eventBus.register(Events.DATA_SITEINFO, 'processor:db-version', process);
}

export default { register, process, PROPERTY, PROPERTY_NAME };

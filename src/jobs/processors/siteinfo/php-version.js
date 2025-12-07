/**
 * PHP Version Processor - Extracts and updates PHP version (P68) from siteinfo
 * 
 * Subscribes to: wiki.data.siteinfo
 * Property: P68 (PHP version)
 */

import { eventBus, Events } from '../../../events/bus.js';
import { ensureStringClaim } from '../../../claims/helpers.js';

const PROPERTY = 'P68';
const PROPERTY_NAME = 'PHP version';

/**
 * Process PHP version from siteinfo
 * @param {Object} context - { wiki, siteinfo, queues }
 */
export function process({ wiki, siteinfo, queues }) {
    const phpversion = siteinfo?.general?.phpversion;
    if (!phpversion) return;
    
    ensureStringClaim({
        queue: queues.one,
        wiki,
        property: PROPERTY,
        value: phpversion,
        summaryAdd: `Add [[Property:${PROPERTY}]] claim for ${phpversion} based on ${PROPERTY_NAME} from siteinfo`,
        summaryUpdate: `Update [[Property:${PROPERTY}]] claim from {old} to {new} based on ${PROPERTY_NAME} from siteinfo`
    });
}

/**
 * Register the processor with the event bus
 */
export function register() {
    eventBus.register(Events.DATA_SITEINFO, 'processor:php-version', process);
}

export default { register, process, PROPERTY, PROPERTY_NAME };

/**
 * MediaWiki Version Processor - Updates MediaWiki version (P57) from page meta
 * 
 * Subscribes to: wiki.context-ready
 * Property: P57 (MediaWiki version)
 */

import { eventBus, Events } from '../../../events/bus.js';
import { ensureStringClaim } from '../../../claims/helpers.js';

const PROPERTY = 'P57';
const PROPERTY_NAME = 'MediaWiki version';

/**
 * Process MediaWiki version from wiki context
 * @param {Object} context - { wiki, queues }
 */
export function process({ wiki, queues }) {
    const mwVersion = wiki.mwVersion;
    if (!mwVersion) return;
    
    ensureStringClaim({
        queue: queues.one,
        wiki,
        property: PROPERTY,
        value: mwVersion,
        summaryAdd: `Add [[Property:${PROPERTY}]] claim for ${mwVersion}, extracted from home page meta data`,
        summaryUpdate: `Update [[Property:${PROPERTY}]] claim from {old} to {new}, extracted from home page meta data`
    });
}

/**
 * Register the processor with the event bus
 */
export function register() {
    eventBus.register(Events.WIKI_CONTEXT_READY, 'processor:mediawiki-version', process);
}

export default { register, process, PROPERTY, PROPERTY_NAME };

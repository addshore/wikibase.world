/**
 * Event Bus - Central event system for the wikibase.world processing pipeline
 * 
 * Events flow in a pipeline:
 * 1. run.tidy-world - Initial trigger to start the tidy process
 * 2. wiki.discovered - A wiki URL has been found and needs checking
 * 3. wiki.alive - Wiki is alive and responding
 * 4. wiki.dead - Wiki appears to be dead/offline
 * 5. wiki.data.{type} - Data has been fetched (siteinfo, manifest, inception, etc.)
 * 6. edit.claim.{action} - Edit actions to be queued (ensure, update, create)
 * 7. edit.label.set - Label edit to be queued
 * 8. edit.description.set - Description edit to be queued
 */

import EventEmitter from 'node:events';

/**
 * @typedef {Object} WikiContext
 * @property {string} item - The wikibase.world item ID (e.g., 'Q123')
 * @property {string} site - The wiki URL
 * @property {string} domain - The domain of the wiki
 * @property {string} [actionApi] - The action API URL
 * @property {string} [restApi] - The REST API URL
 * @property {Object} [entity] - The full entity from wikibase.world
 * @property {Object} [simpleClaims] - Simplified claims from the entity
 */

/**
 * @typedef {Object} SiteInfoData
 * @property {Object} general - General site info
 * @property {Object} namespaces - Namespace info
 * @property {Object} statistics - Site statistics
 */

// Event type constants for type safety and autocomplete
export const Events = {
    // Lifecycle events
    RUN_TIDY_WORLD: 'run.tidy-world',
    
    // Wiki discovery and status
    WIKI_DISCOVERED: 'wiki.discovered',
    WIKI_ALIVE: 'wiki.alive',
    WIKI_DEAD: 'wiki.dead',
    WIKI_CONTEXT_READY: 'wiki.context-ready',
    
    // Data fetched events
    DATA_SITEINFO: 'wiki.data.siteinfo',
    DATA_MANIFEST: 'wiki.data.manifest',
    DATA_INCEPTION: 'wiki.data.inception',
    DATA_EXTERNAL_LINKS: 'wiki.data.external-links',
    DATA_FORMATTER_URLS: 'wiki.data.formatter-urls',
    DATA_PROPERTY_COUNT: 'wiki.data.property-count',
    DATA_MAX_ITEM_ID: 'wiki.data.max-item-id',
    DATA_REVERSE_DNS: 'wiki.data.reverse-dns',
    DATA_PAGE_META: 'wiki.data.page-meta',
    DATA_WB_METADATA: 'wiki.data.wb-metadata',
    
    // Edit events
    EDIT_CLAIM_ENSURE: 'edit.claim.ensure',
    EDIT_CLAIM_UPDATE: 'edit.claim.update',
    EDIT_CLAIM_CREATE: 'edit.claim.create',
    EDIT_LABEL_SET: 'edit.label.set',
    EDIT_DESCRIPTION_SET: 'edit.description.set',
    EDIT_ALIAS_ADD: 'edit.alias.add',
    EDIT_ALIAS_REMOVE: 'edit.alias.remove',
    EDIT_REFERENCE_SET: 'edit.reference.set',
};

class EventBus extends EventEmitter {
    constructor() {
        super();
        this.setMaxListeners(100); // Allow many listeners for modular processors
        this.registeredHandlers = new Map();
    }

    /**
     * Register a named handler for an event
     * @param {string} event - Event name
     * @param {string} handlerName - Unique name for this handler
     * @param {Function} handler - The handler function
     */
    register(event, handlerName, handler) {
        if (!this.registeredHandlers.has(event)) {
            this.registeredHandlers.set(event, new Map());
        }
        
        const handlers = this.registeredHandlers.get(event);
        if (handlers.has(handlerName)) {
            console.warn(`Handler '${handlerName}' already registered for event '${event}', replacing...`);
        }
        
        handlers.set(handlerName, handler);
        this.on(event, handler);
        
        return this;
    }

    /**
     * Get all registered handler names for an event
     * @param {string} event - Event name
     * @returns {string[]} Array of handler names
     */
    getHandlers(event) {
        const handlers = this.registeredHandlers.get(event);
        return handlers ? Array.from(handlers.keys()) : [];
    }

    /**
     * Get all events with registered handlers
     * @returns {string[]} Array of event names
     */
    getRegisteredEvents() {
        return Array.from(this.registeredHandlers.keys());
    }

    /**
     * Log the current event registration state
     */
    logRegistrations() {
        console.log('📋 Event Bus Registrations:');
        for (const [event, handlers] of this.registeredHandlers) {
            console.log(`   ${event}: ${Array.from(handlers.keys()).join(', ')}`);
        }
    }
}

// Singleton event bus instance
const eventBus = new EventBus();

export { eventBus };
export default eventBus;

/**
 * Wikibase.cloud Host Processor - Detects and configures wikibase.cloud hosted wikis
 * 
 * Subscribes to: wiki.context-ready
 * Properties:
 *   - P2 (host) -> Q8 (wikibase.cloud)
 *   - P7 (query service UI)
 *   - P8 (SPARQL endpoint)
 *   - P49 (main page URL)
 *   - P37 (wiki tools)
 *   - P12 (entity types supported)
 */

import { eventBus, Events } from '../../../events/bus.js';
import { world } from '../../../world.js';

// Known reverse DNS for wikibase.cloud
const REVERSE_CLOUD = "221.76.141.34.bc.googleusercontent.com";

// QIDs
const HOST_QID = 'Q8';           // wikibase.cloud
const QUERY_SERVICE_QID = 'Q285'; // Query service
const CRADLE_QID = 'Q287';        // Cradle
const QUICKSTATEMENTS_QID = 'Q286'; // QuickStatements
const ITEM_ENTITY_QID = 'Q51';    // Item entity type
const PROPERTY_ENTITY_QID = 'Q52'; // Property entity type

/**
 * Check if wiki is hosted on wikibase.cloud
 * @param {Object} wiki - Wiki context
 * @returns {{ isCloud: boolean, reason: string }}
 */
export function isWikibaseCloud(wiki) {
    if (wiki.domain?.endsWith('.wikibase.cloud')) {
        return { isCloud: true, reason: '(from the domain)' };
    }
    if (wiki.reverseDNS?.includes?.(REVERSE_CLOUD)) {
        return { isCloud: true, reason: '(from reverse DNS)' };
    }
    return { isCloud: false, reason: '' };
}

/**
 * Process wikibase.cloud hosted wiki
 * @param {Object} context - { wiki, queues }
 */
export function process({ wiki, queues }) {
    const { isCloud, reason } = isWikibaseCloud(wiki);
    if (!isCloud) return;
    
    const protocolledDomain = 'https://' + wiki.domain;
    const queue = queues.one;
    
    // P2 (Host) -> Q8 (Wikibase.cloud)
    if (!wiki.simpleClaims.P2 || wiki.simpleClaims.P2[0] !== HOST_QID) {
        world.queueWork.claimEnsure(
            queue,
            { id: wiki.item, property: 'P2', value: HOST_QID },
            { summary: `Add [[Property:P2]] claim for [[Item:${HOST_QID}]] based on [[Property:P1]] of ${wiki.site} ${reason}` }
        );
    }
    
    // P7 (Query Service UI)
    const hasQueryUi = wiki.simpleClaims.P7?.length <= 1 && 
        (wiki.simpleClaims.P7?.includes(protocolledDomain + '/query') || 
         wiki.simpleClaims.P7?.includes(protocolledDomain + '/query/'));
    if (!wiki.simpleClaims.P7 || !hasQueryUi) {
        world.queueWork.claimEnsure(
            queue,
            { id: wiki.item, property: 'P7', value: protocolledDomain + '/query' },
            { summary: `Add [[Property:P7]] claim for ${protocolledDomain}/query as it is known for [[Item:${HOST_QID}]] hosted wikis` }
        );
    }
    
    // P8 (SPARQL Endpoint)
    const hasSparqlEndpoint = wiki.simpleClaims.P8?.length <= 1 && 
        wiki.simpleClaims.P8?.[0] === protocolledDomain + '/query/sparql';
    if (!wiki.simpleClaims.P8 || !hasSparqlEndpoint) {
        world.queueWork.claimEnsure(
            queue,
            { id: wiki.item, property: 'P8', value: protocolledDomain + '/query/sparql' },
            { summary: `Add [[Property:P8]] claim for ${protocolledDomain}/query/sparql as it is known for [[Item:${HOST_QID}]] hosted wikis` }
        );
    }
    
    // P49 (Main Page URL)
    const hasMainPage = wiki.simpleClaims.P49?.length <= 1 && 
        wiki.simpleClaims.P49?.[0] === protocolledDomain + '/wiki/Main_Page';
    if (!wiki.simpleClaims.P49 || !hasMainPage) {
        world.queueWork.claimEnsure(
            queue,
            { id: wiki.item, property: 'P49', value: protocolledDomain + '/wiki/Main_Page' },
            { summary: `Add [[Property:P49]] claim for ${protocolledDomain}/wiki/Main_Page as it is known for [[Item:${HOST_QID}]] hosted wikis` }
        );
    }
    
    // P37 (Wiki tools) - Query Service
    if (!wiki.simpleClaims.P37 || !wiki.simpleClaims.P37.includes(QUERY_SERVICE_QID)) {
        world.queueWork.claimEnsure(
            queue,
            { 
                id: wiki.item, 
                property: 'P37', 
                value: QUERY_SERVICE_QID, 
                qualifiers: {
                    'P7': protocolledDomain + '/query', 
                    'P8': protocolledDomain + '/query/sparql'
                } 
            },
            { summary: `Add [[Property:P37]] claim for [[Item:${QUERY_SERVICE_QID}]] based on the fact it is a wikibase.cloud wiki` }
        );
    }
    
    // P37 (Wiki tools) - Cradle
    if (!wiki.simpleClaims.P37 || !wiki.simpleClaims.P37.includes(CRADLE_QID)) {
        world.queueWork.claimEnsure(
            queue,
            { 
                id: wiki.item, 
                property: 'P37', 
                value: CRADLE_QID, 
                qualifiers: { 'P1': protocolledDomain + '/tools/cradle' } 
            },
            { summary: `Add [[Property:P37]] claim for [[Item:${CRADLE_QID}]] based on the fact it is a wikibase.cloud wiki` }
        );
    }
    
    // P37 (Wiki tools) - QuickStatements
    if (!wiki.simpleClaims.P37 || !wiki.simpleClaims.P37.includes(QUICKSTATEMENTS_QID)) {
        world.queueWork.claimEnsure(
            queue,
            { 
                id: wiki.item, 
                property: 'P37', 
                value: QUICKSTATEMENTS_QID, 
                qualifiers: { 'P1': protocolledDomain + '/tools/quickstatements' } 
            },
            { summary: `Add [[Property:P37]] claim for [[Item:${QUICKSTATEMENTS_QID}]] based on the fact it is a wikibase.cloud wiki` }
        );
    }
    
    // P12 (Entity types) - Items
    if (!wiki.simpleClaims.P12 || !wiki.simpleClaims.P12.includes(ITEM_ENTITY_QID)) {
        world.queueWork.claimEnsure(
            queue,
            { id: wiki.item, property: 'P12', value: ITEM_ENTITY_QID },
            { summary: `Add [[Property:P12]] claim for [[Item:${ITEM_ENTITY_QID}]] based on the fact it is a wikibase.cloud wiki` }
        );
    }
    
    // P12 (Entity types) - Properties
    if (!wiki.simpleClaims.P12 || !wiki.simpleClaims.P12.includes(PROPERTY_ENTITY_QID)) {
        world.queueWork.claimEnsure(
            queue,
            { id: wiki.item, property: 'P12', value: PROPERTY_ENTITY_QID },
            { summary: `Add [[Property:P12]] claim for [[Item:${PROPERTY_ENTITY_QID}]] based on the fact it is a wikibase.cloud wiki` }
        );
    }
}

/**
 * Register the processor with the event bus
 */
export function register() {
    eventBus.register(Events.WIKI_CONTEXT_READY, 'processor:host:wikibase-cloud', process);
}

export default { register, process, isWikibaseCloud, REVERSE_CLOUD };

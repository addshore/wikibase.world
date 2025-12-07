/**
 * Entity Counts Fetcher - Fetches property and item counts from the wiki
 * 
 * Subscribes to: wiki.data.siteinfo (needs namespace info)
 * Emits: wiki.data.property-count, wiki.data.max-item-id
 */

import { eventBus, Events } from '../../events/bus.js';
import { fetchc } from '../../fetch.js';
import { HEADERS } from '../../general.js';

/**
 * Get the count of pages in a namespace
 * @param {string} actionApi - The action API URL
 * @param {number} namespaceId - The namespace ID to count
 * @param {number} limit - Maximum count before giving up
 * @returns {Promise<number|null>}
 */
export async function getPageCount(actionApi, namespaceId, limit = 10000) {
    let count = 0;
    let continueToken = '';
    
    do {
        const url = `${actionApi}?action=query&list=allpages&apnamespace=${namespaceId}&aplimit=500&format=json${continueToken ? `&apcontinue=${continueToken}` : ''}`;
        
        try {
            const response = await fetchc(url, { headers: HEADERS });
            if (!response) return null;
            
            const data = await response.json();
            if (data.warnings || !data.query?.allpages) return null;
            
            count += data.query.allpages.length;
            continueToken = data.continue?.apcontinue || '';
            
            if (count > limit) {
                console.log(`❌ Count exceeded limit of ${limit}`);
                return null;
            }
        } catch {
            return null;
        }
    } while (continueToken);
    
    return count;
}

/**
 * Get the maximum entity ID (last created) in a namespace
 * @param {string} actionApi - The action API URL
 * @param {number} namespaceId - The namespace ID
 * @returns {Promise<number|null>}
 */
export async function getMaxEntityId(actionApi, namespaceId) {
    try {
        const url = `${actionApi}?action=query&list=logevents&lenamespace=${namespaceId}&letype=create&lelimit=1&leprop=title&format=json`;
        const response = await fetchc(url, { headers: HEADERS });
        if (!response) return null;
        
        const data = await response.json();
        if (data.warnings || !data.query?.logevents?.length) return null;
        
        let lastEntity = data.query.logevents[0].title;
        // Remove namespace prefix if present
        if (lastEntity.includes(':')) {
            lastEntity = lastEntity.split(':')[1];
        }
        // Extract numeric ID
        const match = lastEntity.match(/\d+/);
        return match ? parseInt(match[0]) : null;
    } catch {
        return null;
    }
}

/**
 * Find a namespace ID by content model
 * @param {Object} namespaces - Namespace info from siteinfo
 * @param {string} contentModel - Content model to find (e.g., 'wikibase-property')
 * @returns {string|null}
 */
function findNamespaceByContentModel(namespaces, contentModel) {
    return Object.keys(namespaces).find(
        key => namespaces[key].defaultcontentmodel === contentModel
    );
}

/**
 * Register the entity counts fetcher with the event bus
 * @param {Object} queues - Queue instances { many, four, one }
 */
export function register(queues) {
    eventBus.register(Events.DATA_SITEINFO, 'fetcher:entity-counts', async ({ wiki, siteinfo, queues: q }) => {
        if (!wiki.actionApi) return;
        const queue = q || queues;
        
        // Fetch property count
        const propertyNsId = findNamespaceByContentModel(siteinfo.namespaces, 'wikibase-property');
        if (propertyNsId) {
            queue.many.add(async () => {
                const count = await getPageCount(wiki.actionApi, propertyNsId, 20 * 500);
                if (count !== null) {
                    eventBus.emit(Events.DATA_PROPERTY_COUNT, { wiki, propertyCount: count, queues: queue });
                }
            }, { jobName: `fetch:property-count:${wiki.item}` });
        }
        
        // Fetch max item ID
        const itemNsId = findNamespaceByContentModel(siteinfo.namespaces, 'wikibase-item');
        if (itemNsId) {
            queue.many.add(async () => {
                const maxId = await getMaxEntityId(wiki.actionApi, itemNsId);
                if (maxId !== null) {
                    eventBus.emit(Events.DATA_MAX_ITEM_ID, { wiki, maxItemId: maxId, queues: queue });
                }
            }, { jobName: `fetch:max-item-id:${wiki.item}` });
        }
    });
}

export default { register, getPageCount, getMaxEntityId };

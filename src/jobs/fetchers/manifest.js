/**
 * Manifest Fetcher - Fetches Wikibase manifest data from REST API
 * 
 * Subscribes to: wiki.context-ready
 * Emits: wiki.data.manifest
 */

import { eventBus, Events } from '../../events/bus.js';
import { fetchc } from '../../fetch.js';
import { HEADERS } from '../../general.js';

/**
 * Fetch Wikibase manifest from REST API
 * @param {string} restApi - The REST API URL
 * @returns {Promise<Object|null>}
 */
export async function fetchManifest(restApi) {
    try {
        const url = restApi + '/wikibase-manifest/v0/manifest';
        const response = await fetchc(url, { headers: HEADERS });
        if (!response || response.status !== 200) return null;
        
        return await response.json();
    } catch {
        // Manifest may not be available on all wikis
        return null;
    }
}

/**
 * Register the manifest fetcher with the event bus
 * @param {Object} queues - Queue instances { many, four, one }
 */
export function register(queues) {
    eventBus.register(Events.WIKI_CONTEXT_READY, 'fetcher:manifest', ({ wiki }) => {
        if (!wiki.restApi) return;
        
        queues.many.add(async () => {
            const manifest = await fetchManifest(wiki.restApi);
            if (manifest) {
                eventBus.emit(Events.DATA_MANIFEST, { wiki, manifest, queues });
            }
        }, { jobName: `fetch:manifest:${wiki.item}` });
    });
}

export default { register, fetchManifest };

/**
 * Inception Fetcher - Fetches the wiki's inception date from first log entry
 * 
 * Subscribes to: wiki.context-ready
 * Emits: wiki.data.inception
 */

import { eventBus, Events } from '../../events/bus.js';
import { fetchc } from '../../fetch.js';
import { HEADERS } from '../../general.js';

/**
 * Fetch inception date from a wiki's action API
 * @param {string} actionApi - The action API URL
 * @returns {Promise<{date: string, apiUrl: string}|null>}
 */
export async function fetchInceptionDate(actionApi) {
    try {
        const apiUrl = actionApi + '?action=query&list=logevents&ledir=newer&lelimit=1&format=json';
        const response = await fetchc(apiUrl, { headers: HEADERS });
        if (!response) return null;
        
        const data = await response.json();
        if (!data?.query?.logevents || data.query.logevents.length !== 1) {
            return null;
        }
        
        // Timestamp is like 2020-02-11T18:11:02Z
        const timestamp = data.query.logevents[0].timestamp;
        const date = timestamp.split('T')[0];
        
        return { date, apiUrl };
    } catch (error) {
        console.log(`❌ Failed to fetch inception date: ${error.message}`);
        return null;
    }
}

/**
 * Register the inception fetcher with the event bus
 * @param {Object} queues - Queue instances { many, four, one }
 */
export function register(queues) {
    eventBus.register(Events.WIKI_CONTEXT_READY, 'fetcher:inception', ({ wiki }) => {
        if (!wiki.actionApi) return;
        
        queues.many.add(async () => {
            const inception = await fetchInceptionDate(wiki.actionApi);
            if (inception) {
                eventBus.emit(Events.DATA_INCEPTION, { wiki, inception, queues });
            }
        }, { jobName: `fetch:inception:${wiki.item}` });
    });
}

export default { register, fetchInceptionDate };

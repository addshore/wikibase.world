/**
 * Last Edit Fetcher - Fetches the wiki's last edit timestamp from recent changes or logs
 *
 * Subscribes to: wiki.context-ready
 * Emits: wiki.data.last-edit
 */

import { eventBus, Events } from '../../events/bus.js';
import { fetchc } from '../../fetch.js';
import { HEADERS } from '../../general.js';

/**
 * Fetch last edit timestamp from a wiki's action API
 * @param {string} actionApi - The action API URL
 * @returns {Promise<{timestamp: string, apiUrl: string}|null>}
 */
export async function fetchLastEdit(actionApi) {
    try {
        const apiUrl = actionApi + '?action=query&list=recentchanges|logevents&rclimit=1&lelimit=1&format=json';
        const response = await fetchc(apiUrl, { headers: HEADERS });
        if (!response) return null;

        const data = await response.json();
        if (!data || !data.query) return null;

        const rcTimestamp = data.query.recentchanges?.[0]?.timestamp;
        const logTimestamp = data.query.logevents?.[0]?.timestamp;

        if (!rcTimestamp && !logTimestamp) return null;

        // Take the latest of the two
        let timestamp;
        if (rcTimestamp && logTimestamp) {
            timestamp = rcTimestamp > logTimestamp ? rcTimestamp : logTimestamp;
        } else {
            timestamp = rcTimestamp || logTimestamp;
        }

        return { timestamp, apiUrl };
    } catch (error) {
        console.log(`❌ Failed to fetch last edit: ${error.message}`);
        return null;
    }
}

/**
 * Register the last edit fetcher with the event bus
 * @param {Object} queues - Queue instances { many, four, one }
 */
export function register(queues) {
    eventBus.register(Events.WIKI_CONTEXT_READY, 'fetcher:last-edit', ({ wiki }) => {
        if (!wiki.actionApi) return;

        queues.many.add(async () => {
            const lastEdit = await fetchLastEdit(wiki.actionApi);
            if (lastEdit) {
                eventBus.emit(Events.DATA_LAST_EDIT, { wiki, lastEdit, queues });
            }
        }, { jobName: `fetch:last-edit:${wiki.item}` });
    });
}

export default { register, fetchLastEdit };

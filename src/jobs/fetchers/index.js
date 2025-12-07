/**
 * Fetchers Index - Exports all data fetchers for easy registration
 */

import siteinfoFetcher from './siteinfo.js';
import inceptionFetcher from './inception.js';
import manifestFetcher from './manifest.js';
import reverseDnsFetcher from './reverse-dns.js';
import entityCountsFetcher from './entity-counts.js';
import externalLinksFetcher from './external-links.js';

export const fetchers = [
    siteinfoFetcher,
    inceptionFetcher,
    manifestFetcher,
    reverseDnsFetcher,
    entityCountsFetcher,
    externalLinksFetcher,
];

/**
 * Register all fetchers with the event bus
 * @param {Object} queues - Queue instances { many, four, one }
 */
export function registerAllFetchers(queues) {
    for (const fetcher of fetchers) {
        if (fetcher.register) {
            fetcher.register(queues);
        }
    }
    console.log(`📥 Registered ${fetchers.length} data fetchers`);
}

export {
    siteinfoFetcher,
    inceptionFetcher,
    manifestFetcher,
    reverseDnsFetcher,
    entityCountsFetcher,
    externalLinksFetcher,
};

export default { registerAllFetchers, fetchers };

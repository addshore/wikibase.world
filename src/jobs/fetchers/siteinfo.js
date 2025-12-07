/**
 * Site Info Fetcher - Fetches MediaWiki siteinfo API data
 * 
 * Subscribes to: wiki.context-ready
 * Emits: wiki.data.siteinfo
 */

import { eventBus, Events } from '../../events/bus.js';
import { fetchc } from '../../fetch.js';
import { HEADERS } from '../../general.js';

/**
 * @typedef {Object} SiteInfoResult
 * @property {Object} general - General site info (sitename, phpversion, etc.)
 * @property {Object} namespaces - Namespace definitions
 * @property {Object} statistics - Site statistics (pages, edits, users, etc.)
 */

/**
 * Fetch siteinfo from a wiki's action API
 * @param {string} actionApi - The action API URL
 * @returns {Promise<SiteInfoResult|null>}
 */
export async function fetchSiteInfo(actionApi) {
    try {
        const url = actionApi + '?action=query&meta=siteinfo&siprop=general|namespaces|statistics&format=json';
        const response = await fetchc(url, { headers: HEADERS });
        if (!response) return null;
        
        const data = await response.json();
        if (!data || !data.query) return null;
        
        return {
            general: data.query.general || {},
            namespaces: data.query.namespaces || {},
            statistics: data.query.statistics || {}
        };
    } catch (error) {
        console.log(`❌ Failed to fetch siteinfo: ${error.message}`);
        return null;
    }
}

/**
 * Register the siteinfo fetcher with the event bus
 * @param {Object} queues - Queue instances { many, four, one }
 */
export function register(queues) {
    eventBus.register(Events.WIKI_CONTEXT_READY, 'fetcher:siteinfo', ({ wiki }) => {
        if (!wiki.actionApi) return;
        
        queues.many.add(async () => {
            const siteinfo = await fetchSiteInfo(wiki.actionApi);
            if (siteinfo) {
                eventBus.emit(Events.DATA_SITEINFO, { wiki, siteinfo, queues });
            }
        }, { jobName: `fetch:siteinfo:${wiki.item}` });
    });
}

export default { register, fetchSiteInfo };

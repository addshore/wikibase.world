/**
 * Statistics Processor - Extracts and updates site statistics from siteinfo
 * 
 * Subscribes to: wiki.data.siteinfo
 * Properties:
 *   - P62 (pages count)
 *   - P59 (edits count)
 *   - P60 (users count)
 *   - P61 (active users count)
 */

import { eventBus, Events } from '../../../events/bus.js';
import { ensureNumericClaim } from '../../../claims/helpers.js';

/**
 * Configuration for each statistic property
 */
const STATISTICS_CONFIG = [
    {
        property: 'P62',
        statField: 'pages',
        name: 'number of pages'
    },
    {
        property: 'P59',
        statField: 'edits',
        name: 'number of edits'
    },
    {
        property: 'P60',
        statField: 'users',
        name: 'number of users'
    },
    {
        property: 'P61',
        statField: 'activeusers',
        name: 'number of active users'
    }
];

/**
 * Process site statistics from siteinfo
 * @param {Object} context - { wiki, siteinfo, queues }
 */
export function process({ wiki, siteinfo, queues }) {
    const statistics = siteinfo?.statistics;
    if (!statistics) return;
    
    for (const config of STATISTICS_CONFIG) {
        const value = statistics[config.statField];
        if (value === undefined || value === null) continue;
        
        ensureNumericClaim({
            queue: queues.one,
            wiki,
            property: config.property,
            value: Number(value),
            summaryAdd: `Add [[Property:${config.property}]] claim for ${value} based on ${config.name} in the wiki (mediawiki statistics)`,
            summaryUpdate: `Update [[Property:${config.property}]] claim from {old} to {new} (delta: {delta}) based on ${config.name} in the wiki (mediawiki statistics)`
        });
    }
}

/**
 * Register the processor with the event bus
 */
export function register() {
    eventBus.register(Events.DATA_SITEINFO, 'processor:statistics', process);
}

export default { register, process, STATISTICS_CONFIG };

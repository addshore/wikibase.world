/**
 * Siteinfo Processors Index - Exports all siteinfo-based processors
 */

import phpVersionProcessor from './php-version.js';
import dbTypeProcessor from './db-type.js';
import dbVersionProcessor from './db-version.js';
import statisticsProcessor from './statistics.js';

export const processors = [
    phpVersionProcessor,
    dbTypeProcessor,
    dbVersionProcessor,
    statisticsProcessor,
];

/**
 * Register all siteinfo processors with the event bus
 */
export function registerAllSiteinfoProcessors() {
    for (const processor of processors) {
        processor.register();
    }
    console.log(`📊 Registered ${processors.length} siteinfo processors`);
}

export {
    phpVersionProcessor,
    dbTypeProcessor,
    dbVersionProcessor,
    statisticsProcessor,
};

export default { registerAllSiteinfoProcessors, processors };

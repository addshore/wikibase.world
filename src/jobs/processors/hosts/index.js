/**
 * Host Processors Index - Exports all host detection processors
 */

import wikibaseCloudProcessor from './wikibase-cloud.js';
import professionalWikiProcessor from './professional-wiki.js';
import mirahezeProcessor from './miraheze.js';
import wmfLabsProcessor from './wmf-labs.js';

export const processors = [
    wikibaseCloudProcessor,
    professionalWikiProcessor,
    mirahezeProcessor,
    wmfLabsProcessor,
];

/**
 * Register all host processors with the event bus
 */
export function registerAllHostProcessors() {
    for (const processor of processors) {
        processor.register();
    }
    console.log(`🏠 Registered ${processors.length} host detection processors`);
}

export {
    wikibaseCloudProcessor,
    professionalWikiProcessor,
    mirahezeProcessor,
    wmfLabsProcessor,
};

export default { registerAllHostProcessors, processors };

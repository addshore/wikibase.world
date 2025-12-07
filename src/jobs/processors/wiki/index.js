/**
 * Wiki Processors Index - Exports all core wiki processors
 */

import mediawikiVersionProcessor from './mediawiki-version.js';
import activityStatusProcessor from './activity-status.js';
import labelsDescriptionsProcessor from './labels-descriptions.js';
import urlNormalizerProcessor from './url-normalizer.js';
import wikiLinksProcessor from './wiki-links.js';

export const processors = [
    mediawikiVersionProcessor,
    activityStatusProcessor,
    labelsDescriptionsProcessor,
    urlNormalizerProcessor,
    wikiLinksProcessor,
];

/**
 * Register all wiki processors with the event bus
 */
export function registerAllWikiProcessors() {
    for (const processor of processors) {
        processor.register();
    }
    console.log(`🌐 Registered ${processors.length} wiki processors`);
}

export {
    mediawikiVersionProcessor,
    activityStatusProcessor,
    labelsDescriptionsProcessor,
    urlNormalizerProcessor,
    wikiLinksProcessor,
};

export default { registerAllWikiProcessors, processors };

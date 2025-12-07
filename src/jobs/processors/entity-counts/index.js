/**
 * Entity Count Processors Index - Exports all entity count processors
 */

import propertyCountProcessor from './property-count.js';
import maxItemIdProcessor from './max-item-id.js';

export const processors = [
    propertyCountProcessor,
    maxItemIdProcessor,
];

/**
 * Register all entity count processors with the event bus
 */
export function registerAllEntityCountProcessors() {
    for (const processor of processors) {
        processor.register();
    }
    console.log(`🔢 Registered ${processors.length} entity count processors`);
}

export {
    propertyCountProcessor,
    maxItemIdProcessor,
};

export default { registerAllEntityCountProcessors, processors };

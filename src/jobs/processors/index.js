/**
 * Processors Index - Central registration point for all processors
 */

import { registerAllSiteinfoProcessors } from './siteinfo/index.js';
import { registerAllEntityCountProcessors } from './entity-counts/index.js';
import { registerAllHostProcessors } from './hosts/index.js';
import { registerAllWikiProcessors } from './wiki/index.js';
import inceptionProcessor from './inception.js';

/**
 * Register all processors with the event bus
 */
export function registerAllProcessors() {
    console.log('📋 Registering all processors...');
    
    // Register grouped processors
    registerAllSiteinfoProcessors();
    registerAllEntityCountProcessors();
    registerAllHostProcessors();
    registerAllWikiProcessors();
    
    // Register standalone processors
    inceptionProcessor.register();
    console.log(`📅 Registered inception processor`);
    
    console.log('✅ All processors registered');
    console.log('');
}

// Re-export everything for convenience
export * from './siteinfo/index.js';
export * from './entity-counts/index.js';
export * from './hosts/index.js';
export * from './wiki/index.js';
export { inceptionProcessor };

export default { registerAllProcessors };

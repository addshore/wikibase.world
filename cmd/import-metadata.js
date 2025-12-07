/**
 * Import Metadata v2 - Event-driven wikibase-metadata.toolforge.org importer
 * 
 * This script uses a modular event-driven architecture where:
 * 1. Fetcher iterates through metadata IDs
 * 2. Each wiki is processed through a queue
 * 3. Events coordinate checks and imports
 * 
 * Usage:
 *   node cmd/import-metadata-v2.js [filter]
 *   
 *   filter - Optional specific metadata ID to process
 */

import { world } from '../src/world.js';
import { queues } from '../src/general.js';
import { checkOnlineAndWikibase } from '../src/site.js';
import { metadatalookup } from '../src/metadata.js';
import { eventBus } from '../src/events/bus.js';
import dotenv from 'dotenv';
import process from 'process';

dotenv.config();

// Configuration
const MAX_CONSECUTIVE_MISSING = 50;
const MAX_ID = 1000000;

// Script filter (optional - specific metadata ID)
const scriptFilter = process.argv[2];
if (scriptFilter !== undefined) {
    console.log(`🚀 Running import-metadata-v2 with filter: ${scriptFilter}`);
}

// Event constants for this importer
const MetadataEvents = {
    // Metadata entry found
    METADATA_FOUND: 'metadata.entry-found',
    // Wiki discovered from metadata
    WIKI_DISCOVERED: 'metadata.wiki-discovered',
    // Wiki is valid and online
    WIKI_VALID: 'metadata.wiki-valid',
    // Wiki already exists in wikibase.world
    WIKI_EXISTS: 'metadata.wiki-exists',
    // Wiki is new (not in wikibase.world)
    WIKI_NEW: 'metadata.wiki-new',
    // Wiki check failed
    WIKI_FAILED: 'metadata.wiki-failed',
    // Metadata entry not found
    METADATA_MISSING: 'metadata.entry-missing',
};

// World context
let worldContext = {
    worldWikis: [],
    worldWikiURLs: [],
    worldWikiItems: [],
};

// Statistics
const stats = {
    scanned: 0,
    found: 0,
    missing: 0,
    existing: 0,
    new: 0,
    failed: 0,
    invalidUrl: 0,
};

/**
 * Initialize world context by querying known wikis
 */
async function initializeWorldContext() {
    console.log('🌍 Loading world context...');
    worldContext.worldWikis = await world.sparql.wikisAll();
    worldContext.worldWikiURLs = worldContext.worldWikis.map(wiki => wiki.site);
    worldContext.worldWikiItems = worldContext.worldWikis.map(wiki => wiki.item);
    console.log(`   Found ${worldContext.worldWikis.length} known wikis`);
}

/**
 * Find existing wiki item ID by domain
 */
function findExistingWikiItem(domain) {
    for (let i = 0; i < worldContext.worldWikiURLs.length; i++) {
        if (worldContext.worldWikiURLs[i].includes(domain)) {
            return worldContext.worldWikiItems[i];
        }
    }
    return null;
}

/**
 * Check if domain exists in world
 */
function domainExistsInWorld(domain) {
    return worldContext.worldWikiURLs.some(url => url.includes(domain));
}

/**
 * Setup the event flow for processing
 */
function setupEventFlow() {
    // Handle metadata found - check the wiki
    eventBus.register(MetadataEvents.METADATA_FOUND, 'metadata:process-entry', ({ id, data }) => {
        const baseUrl = data.urls?.baseUrl;
        
        if (!baseUrl) {
            console.log(`   ⏭️ ID ${id}: no baseUrl`);
            stats.invalidUrl++;
            return;
        }
        
        let domain;
        try {
            domain = new URL(baseUrl).hostname;
        } catch {
            console.log(`   ⏭️ ID ${id}: invalid baseUrl (${baseUrl})`);
            stats.invalidUrl++;
            return;
        }
        
        eventBus.emit(MetadataEvents.WIKI_DISCOVERED, { id, data, domain, baseUrl });
    });
    
    // Handle wiki discovery - check if exists or new
    eventBus.register(MetadataEvents.WIKI_DISCOVERED, 'metadata:check-exists', ({ id, data, domain, baseUrl }) => {
        if (domainExistsInWorld(domain)) {
            const existingItemId = findExistingWikiItem(domain);
            eventBus.emit(MetadataEvents.WIKI_EXISTS, { id, data, domain, existingItemId });
        } else {
            eventBus.emit(MetadataEvents.WIKI_NEW, { id, data, domain, baseUrl });
        }
    });
    
    // Handle existing wiki - ensure metadata ID claim
    eventBus.register(MetadataEvents.WIKI_EXISTS, 'metadata:update-existing', ({ id, data, domain, existingItemId }) => {
        if (!existingItemId) {
            console.log(`   ❌ ${domain}: could not find item ID`);
            return;
        }
        
        world.queueWork.claimEnsure(
            queues.one,
            { id: existingItemId, property: 'P53', value: data.id },
            { summary: `Add [[Property:P53]] for a known https://wikibase-metadata.toolforge.org Wikibase` }
        );
        
        console.log(`   ✅ Ensured metadata ID for existing wiki: ${domain} (${existingItemId}) → P53=${data.id}`);
        stats.existing++;
    });
    
    // Handle new wiki - validate and create
    eventBus.register(MetadataEvents.WIKI_NEW, 'metadata:validate-new', ({ id, data, domain, baseUrl }) => {
        queues.four.add(async () => {
            const { result, text } = await checkOnlineAndWikibase(baseUrl);
            
            if (!result) {
                console.log(`   ❌ ${domain}: ${text}`);
                stats.failed++;
                eventBus.emit(MetadataEvents.WIKI_FAILED, { id, domain, reason: text });
                return;
            }
            
            eventBus.emit(MetadataEvents.WIKI_VALID, { id, data, domain, baseUrl });
        }, { jobName: `validate:${domain}` });
    });
    
    // Handle valid new wiki - create item
    eventBus.register(MetadataEvents.WIKI_VALID, 'metadata:create-new', ({ id, data, domain, baseUrl }) => {
        // Get URL without protocol for label
        const urlNoProt = baseUrl.split("//")[1];
        
        world.queueWork.itemCreate(queues.one, {
            labels: { en: urlNoProt },
            claims: {
                P1: baseUrl,
                P3: "Q10", // wikibase site
                P13: 'Q54', // active
                P53: data.id,
            }
        }, { summary: `Importing ${baseUrl} from https://wikibase-metadata.toolforge.org` });
        
        console.log(`   🆕 Queued new wiki: ${domain} (metadata ID: ${data.id})`);
        stats.new++;
    });
}

/**
 * Wait for all queues to be idle
 */
async function waitForQueues() {
    let lastSize = -1;
    let stableCount = 0;
    
    while (stableCount < 3) {
        const currentSize = queues.many.size + queues.many.pending + 
                           queues.four.size + queues.four.pending + 
                           queues.one.size + queues.one.pending;
        
        if (currentSize === 0 && lastSize === 0) {
            stableCount++;
        } else {
            stableCount = 0;
        }
        
        lastSize = currentSize;
        await new Promise(resolve => setTimeout(resolve, 500));
    }
}

/**
 * Print final statistics
 */
function printStats() {
    console.log('');
    console.log('📊 Import Statistics:');
    console.log(`   IDs scanned:      ${stats.scanned}`);
    console.log(`   Entries found:    ${stats.found}`);
    console.log(`   Missing entries:  ${stats.missing}`);
    console.log(`   Invalid URLs:     ${stats.invalidUrl}`);
    console.log(`   Existing updated: ${stats.existing}`);
    console.log(`   New created:      ${stats.new}`);
    console.log(`   Failed:           ${stats.failed}`);
}

/**
 * Start the import process
 */
async function startImport() {
    console.log('📚 Starting Metadata Import v2');
    console.log('');
    
    // Initialize world context
    await initializeWorldContext();
    
    // Setup event flow
    setupEventFlow();
    
    // Log registered events
    console.log('');
    console.log('📋 Event Handlers:');
    for (const event of Object.values(MetadataEvents)) {
        const handlers = eventBus.getHandlers(event);
        if (handlers.length > 0) {
            console.log(`   ${event}: ${handlers.join(', ')}`);
        }
    }
    console.log('');
    
    // Scan metadata IDs
    console.log('📥 Scanning wikibase-metadata.toolforge.org...');
    
    queues.many.add(async () => {
        let consecutiveMissing = 0;
        
        // If filter is provided, just process that one ID
        if (scriptFilter) {
            const id = parseInt(scriptFilter);
            stats.scanned++;
            
            const data = await metadatalookup(id);
            if (data) {
                stats.found++;
                eventBus.emit(MetadataEvents.METADATA_FOUND, { id, data });
            } else {
                console.log(`   ❌ ID ${id} does not exist`);
                stats.missing++;
            }
            return;
        }
        
        // Otherwise scan from 1 to MAX_ID
        for (let id = 1; id < MAX_ID; id++) {
            stats.scanned++;
            
            const data = await metadatalookup(id);
            
            if (!data) {
                consecutiveMissing++;
                stats.missing++;
                
                if (id % 100 === 0 || consecutiveMissing >= MAX_CONSECUTIVE_MISSING) {
                    console.log(`   📍 Scanned ${id} IDs (${stats.found} found, ${consecutiveMissing} consecutive missing)`);
                }
                
                if (consecutiveMissing >= MAX_CONSECUTIVE_MISSING) {
                    console.log(`   🛑 Reached ${MAX_CONSECUTIVE_MISSING} consecutive missing entries, stopping scan`);
                    break;
                }
                
                continue;
            }
            
            // Reset consecutive missing counter
            consecutiveMissing = 0;
            stats.found++;
            
            eventBus.emit(MetadataEvents.METADATA_FOUND, { id, data });
        }
        
        console.log(`   📍 Scan complete: ${stats.scanned} IDs scanned, ${stats.found} found`);
    }, { jobName: 'scan-metadata-ids' });
    
    // Wait for all work to complete
    await waitForQueues();
    
    // Print statistics
    printStats();
    
    console.log('');
    console.log('✅ All processing complete!');
    process.exit(0);
}

// Run!
startImport();

/**
 * Import Cloud v2 - Event-driven wikibase.cloud wiki importer
 * 
 * This script uses a modular event-driven architecture where:
 * 1. Fetcher retrieves the wikibase.cloud wiki list from API
 * 2. Each wiki is processed through a queue
 * 3. Events coordinate status checks and imports
 * 4. Also marks deleted wikis as permanently offline
 * 
 * Usage:
 *   node cmd/import-cloud-v2.js [filter]
 *   
 *   filter - Optional substring to filter wikis by domain
 */

import { simplifyClaims } from 'wikibase-sdk';
import { fetchuc, fetchc } from '../src/fetch.js';
import { world } from '../src/world.js';
import { queues, HEADERS } from '../src/general.js';
import { eventBus } from '../src/events/bus.js';
import process from 'process';

// Configuration
const CLOUD_HOST_QID = 'Q8';
const CLOUD_API_URL = 'https://www.wikibase.cloud/api/wiki?sort=pages&direction=desc&page=1&per_page=99999';

// Script filter (optional)
const scriptFilter = process.argv[2];
if (scriptFilter !== undefined) {
    console.log(`🚀 Running import-cloud-v2 with filter: ${scriptFilter}`);
}

// Event constants for this importer
const CloudEvents = {
    // Wiki list fetched from API
    LIST_FETCHED: 'cloud.list-fetched',
    // Individual wiki discovered from list
    WIKI_DISCOVERED: 'cloud.wiki-discovered',
    // Wiki is alive and responding
    WIKI_ALIVE: 'cloud.wiki-alive',
    // Wiki is new (not in wikibase.world)
    WIKI_NEW: 'cloud.wiki-new',
    // Wiki already exists in wikibase.world
    WIKI_EXISTS: 'cloud.wiki-exists',
    // Wiki from world not in cloud list (deleted)
    WIKI_DELETED: 'cloud.wiki-deleted',
    // Wiki check failed
    WIKI_FAILED: 'cloud.wiki-failed',
};

// World context
let worldContext = {
    worldWikis: [],
    worldWikiURLs: [],
    worldWikiItems: [],
    worldCloudWikis: [],
};

// Cloud wikis list (for deletion check)
let cloudWikiDomains = [];

// Statistics
const stats = {
    totalInApi: 0,
    filtered: 0,
    existing: 0,
    new: 0,
    deleted: 0,
    failed: 0,
};

/**
 * Initialize world context by querying known wikis
 */
async function initializeWorldContext() {
    console.log('🌍 Loading world context...');
    worldContext.worldWikis = await world.sparql.wikis();
    worldContext.worldCloudWikis = await world.sparql.cloudWikis();
    worldContext.worldWikiURLs = worldContext.worldWikis.map(wiki => wiki.site);
    worldContext.worldWikiItems = worldContext.worldWikis.map(wiki => wiki.item);
    console.log(`   Found ${worldContext.worldWikis.length} known wikis`);
    console.log(`   Found ${worldContext.worldCloudWikis.length} known cloud wikis`);
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
 * Check if wiki name should be ignored (test wikis, etc.)
 */
function shouldIgnoreName(name) {
    const lowerName = name.toLowerCase();
    const ignoredPatterns = ['test', 'testwiki', 'wikibase', 'testing'];
    
    return (
        ignoredPatterns.includes(lowerName) ||
        ignoredPatterns.some(pattern => /^\d+$/.test(lowerName.replace(pattern, '')) && lowerName.startsWith(pattern)) ||
        /^\d+$/.test(lowerName)
    );
}

/**
 * Setup the event flow for processing
 */
function setupEventFlow() {
    // Handle list fetched - emit discovery events for each wiki
    eventBus.register(CloudEvents.LIST_FETCHED, 'cloud:process-list', (wikis) => {
        stats.totalInApi = wikis.length;
        
        // Store domains for deletion check
        cloudWikiDomains = wikis.map(w => w.domain);
        
        for (const wiki of wikis) {
            // Apply filter if provided
            if (scriptFilter !== undefined && !wiki.domain.includes(scriptFilter)) {
                continue;
            }
            
            stats.filtered++;
            eventBus.emit(CloudEvents.WIKI_DISCOVERED, { wiki });
        }
        
        console.log(`   📋 Processing ${stats.filtered} wikis (from ${stats.totalInApi} total)`);
        
        // Also check for deleted wikis
        checkDeletedWikis();
    });
    
    // Handle wiki discovery - check if alive in queue
    eventBus.register(CloudEvents.WIKI_DISCOVERED, 'cloud:check-alive', ({ wiki }) => {
        queues.four.add(async () => {
            const url = `https://${wiki.domain}`;
            try {
                const response = await fetchc(url, { headers: HEADERS });
                if (!response) {
                    console.log(`   ❌ ${wiki.domain}: connection error or timeout`);
                    stats.failed++;
                    eventBus.emit(CloudEvents.WIKI_FAILED, { wiki, reason: 'connection-error' });
                    return;
                }
                
                const responseText = await response.text();
                const is200 = response.status === 200;
                const is404WithNoText = response.status === 404 && 
                    responseText.includes("There is currently no text in this page");
                
                if (is200 || is404WithNoText) {
                    eventBus.emit(CloudEvents.WIKI_ALIVE, { wiki, response, responseText });
                } else {
                    console.log(`   ❌ ${wiki.domain}: HTTP ${response.status}`);
                    stats.failed++;
                    eventBus.emit(CloudEvents.WIKI_FAILED, { wiki, reason: `http-${response.status}` });
                }
            } catch (e) {
                console.log(`   ❌ ${wiki.domain}: ${e.message}`);
                stats.failed++;
                eventBus.emit(CloudEvents.WIKI_FAILED, { wiki, reason: e.message });
            }
        }, { jobName: `check-alive:${wiki.domain}` });
    });
    
    // Handle alive wiki - check if exists or new
    eventBus.register(CloudEvents.WIKI_ALIVE, 'cloud:check-exists', ({ wiki }) => {
        const existingItemId = findExistingWikiItem(wiki.domain);
        
        if (existingItemId) {
            eventBus.emit(CloudEvents.WIKI_EXISTS, { wiki, existingItemId });
        } else {
            eventBus.emit(CloudEvents.WIKI_NEW, { wiki });
        }
    });
    
    // Handle existing wiki - ensure cloud ID claim
    eventBus.register(CloudEvents.WIKI_EXISTS, 'cloud:update-existing', ({ wiki, existingItemId }) => {
        world.queueWork.claimEnsure(
            queues.one,
            { id: existingItemId, property: 'P54', value: `${wiki.id}` },
            { summary: `Add [[Property:P54]] for a known https://wikibase.cloud Wikibase` }
        );
        
        console.log(`   ✅ Ensured cloud ID for existing wiki: ${wiki.domain} (${existingItemId}) → P54=${wiki.id}`);
        stats.existing++;
    });
    
    // Handle new wiki - create item
    eventBus.register(CloudEvents.WIKI_NEW, 'cloud:create-new', ({ wiki }) => {
        queues.many.add(async () => {
            const url = `https://${wiki.domain}`;
            const ignoreName = shouldIgnoreName(wiki.sitename);
            
            const labels = ignoreName ? { en: wiki.domain } : { en: wiki.sitename };
            const aliases = ignoreName ? {} : { en: [wiki.domain] };
            
            world.queueWork.itemCreate(queues.one, {
                labels,
                ...(Object.keys(aliases).length > 0 && { aliases }),
                claims: {
                    P1: url,
                    P2: CLOUD_HOST_QID,
                    P3: "Q10", // wikibase site
                    P13: 'Q54', // active
                    P49: url + "/wiki/Main_Page",
                    P54: `${wiki.id}`,
                }
            }, { summary: `Importing https://${wiki.domain} from [[Item:Q8]] active wikis list` });
            
            console.log(`   🆕 Queued new wiki: ${wiki.domain} (cloud ID: ${wiki.id})`);
            stats.new++;
        }, { jobName: `create-new:${wiki.domain}` });
    });
    
    // Handle deleted wiki - mark as permanently offline
    eventBus.register(CloudEvents.WIKI_DELETED, 'cloud:mark-deleted', ({ wiki }) => {
        queues.four.add(async () => {
            // Lookup the item for the site on wikibase.world
            const { entities } = await fetchuc(world.sdk.getEntities({ ids: [wiki.item] }), { headers: HEADERS })
                .then(res => res?.json() || { entities: {} });
            
            if (!entities[wiki.item]) {
                console.log(`   ❌ Item ${wiki.item} does not exist`);
                return;
            }
            
            const simpleClaims = simplifyClaims(entities[wiki.item].claims);
            
            // Use claimEnsure to handle P13 properly (single value, replace if needed)
            if (simpleClaims.P13 && simpleClaims.P13[0] === 'Q57') {
                console.log(`   ⏭️ ${wiki.site} already marked as offline permanently`);
                return;
            }
            
            world.queueWork.claimEnsure(
                queues.one,
                { id: wiki.item, property: 'P13', value: 'Q57' },
                { summary: `Set [[Property:P13]] to [[Item:Q57]] for deleted [[Item:Q8]] Wikibase` }
            );
            
            console.log(`   🗑️ Marked as deleted: ${wiki.site} (${wiki.item}) → P13=Q57`);
            stats.deleted++;
        }, { jobName: `mark-deleted:${wiki.item}` });
    });
}

/**
 * Check for wikis in world that are no longer in cloud API (deleted)
 */
function checkDeletedWikis() {
    console.log('');
    console.log('🔍 Checking for deleted cloud wikis...');
    
    for (const wiki of worldContext.worldCloudWikis) {
        // Apply filter if provided
        if (scriptFilter !== undefined && !wiki.site.includes(scriptFilter)) {
            continue;
        }
        
        // Extract domain from site URL
        const domain = wiki.site.replace(/^https?:\/\//, '').split('/')[0];
        
        // Check if this domain is still in the cloud API list
        const isInCloudList = cloudWikiDomains.some(d => d.includes(domain) || domain.includes(d));
        
        if (!isInCloudList) {
            eventBus.emit(CloudEvents.WIKI_DELETED, { wiki, domain });
        }
    }
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
    console.log(`   Total in API:     ${stats.totalInApi}`);
    console.log(`   Filtered:         ${stats.filtered}`);
    console.log(`   Existing updated: ${stats.existing}`);
    console.log(`   New created:      ${stats.new}`);
    console.log(`   Marked deleted:   ${stats.deleted}`);
    console.log(`   Failed:           ${stats.failed}`);
}

/**
 * Start the import process
 */
async function startImport() {
    console.log('☁️ Starting Cloud Import v2');
    console.log('');
    
    // Initialize world context
    await initializeWorldContext();
    
    // Setup event flow
    setupEventFlow();
    
    // Log registered events
    console.log('');
    console.log('📋 Event Handlers:');
    for (const event of Object.values(CloudEvents)) {
        const handlers = eventBus.getHandlers(event);
        if (handlers.length > 0) {
            console.log(`   ${event}: ${handlers.join(', ')}`);
        }
    }
    console.log('');
    
    // Fetch and process the list
    console.log('📥 Fetching wikibase.cloud wiki list...');
    queues.many.add(async () => {
        const response = await fetchuc(CLOUD_API_URL);
        const data = await response.json();
        
        // Validate response
        if (data.meta.per_page !== 99999) {
            console.log(`   ❌ API per_page is ${data.meta.per_page}, expected 99999`);
            return;
        }
        if (data.meta.to > 99999) {
            console.log(`   ❌ API returned more than 99999 results`);
            return;
        }
        
        const wikis = data.data;
        // Sort by id desc (newest first)
        wikis.sort((a, b) => b.id - a.id);
        
        console.log(`   Found ${wikis.length} wikis in API`);
        eventBus.emit(CloudEvents.LIST_FETCHED, wikis);
    }, { jobName: 'fetch-cloud-list' });
    
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

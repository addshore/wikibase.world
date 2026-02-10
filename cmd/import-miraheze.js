/**
 * Import Miraheze v2 - Event-driven Miraheze wiki importer
 * 
 * This script uses a modular event-driven architecture where:
 * 1. Fetcher retrieves the Miraheze wiki list
 * 2. Each wiki is processed through a queue
 * 3. Events coordinate status checks and imports
 * 
 * Usage:
 *   node cmd/import-miraheze-v2.js [filter]
 *   
 *   filter - Optional substring to filter wikis by domain
 */

import fetch from 'node-fetch';
import { world } from '../src/world.js';
import { queues, HEADERS } from '../src/general.js';
import { eventBus } from '../src/events/bus.js';
import process from 'process';

// Configuration
const MIRAHEZE_QID = 'Q118';
const LIST_URL = 'https://www.irccloud.com/pastebin/raw/cOYehYeA/wr.php';

// Script filter (optional)
const scriptFilter = process.argv[2];
if (scriptFilter !== undefined) {
    console.log(`🚀 Running import-miraheze-v2 with filter: ${scriptFilter}`);
}

// Event constants for this importer
const MirahezeEvents = {
    // Wiki list fetched
    LIST_FETCHED: 'miraheze.list-fetched',
    // Individual wiki discovered from list
    WIKI_DISCOVERED: 'miraheze.wiki-discovered',
    // Wiki URL resolved (after following redirects)
    WIKI_RESOLVED: 'miraheze.wiki-resolved',
    // Wiki status determined
    WIKI_STATUS_CHECKED: 'miraheze.wiki-status-checked',
    // Wiki is new (not in wikibase.world)
    WIKI_NEW: 'miraheze.wiki-new',
    // Wiki already exists in wikibase.world
    WIKI_EXISTS: 'miraheze.wiki-exists',
    // Wiki skipped (not a wikibase)
    WIKI_SKIPPED: 'miraheze.wiki-skipped',
};

// World context
let worldContext = {
    worldWikis: [],
    worldWikiURLs: [],
};

// Statistics
const stats = {
    total: 0,
    filtered: 0,
    existing: 0,
    new: 0,
    skipped: 0,
    failed: 0,
};

/**
 * Initialize world context by querying known wikis
 */
async function initializeWorldContext() {
    console.log('🌍 Loading world context...');
    worldContext.worldWikis = await world.sparql.wikisAll();
    worldContext.worldWikiURLs = worldContext.worldWikis.map(wiki => wiki.site);
    console.log(`   Found ${worldContext.worldWikis.length} known wikis`);
}

/**
 * Fetch the Miraheze wiki list
 */
async function fetchMirahezeDbList() {
    const response = await fetch(LIST_URL);
    const text = await response.text();
    // Match lines like 'aftertheendwiki' =>
    const matches = [...text.matchAll(/'([a-z0-9]+)wiki'\s*=>/g)];
    return matches.map(m => m[1]);
}

/**
 * Resolve the final URL after redirects
 */
async function resolveFinalUrl(db) {
    const url = `https://${db}.miraheze.org`;
    try {
        const response = await fetch(url, { headers: HEADERS, redirect: 'follow' });
        const html = await response.text();
        return { url: response.url, html };
    } catch (e) {
        console.log(`   ❌ Failed to fetch ${url}: ${e.message}`);
        return null;
    }
}

/**
 * Get wiki status from banners on the main page
 */
async function getWikiStatus(db) {
    const url = `https://${db}.miraheze.org/wiki/Main_Page?uselang=en`;
    try {
        const response = await fetch(url, { headers: HEADERS });
        const text = await response.text();
        
        // Check if wiki is deleted
        if (text.includes("<title>Wiki deleted</title>") || text.includes("<h1><b>Wiki deleted</b></h1>")) {
            return 'Q57'; // offline permanently
        }
        
        // Check if wiki is closed due to dormancy
        if (text.includes("This wiki has been automatically closed because there have been") ||
            text.includes('Dormancy Policy">closed</a>')) {
            return 'Q1345'; // closed
        }
        
        return 'Q54'; // active
    } catch {
        console.log(`   ⚠️ Failed to fetch main page for ${db}, assuming active`);
        return 'Q54'; // assume active on error
    }
}

/**
 * Find existing wiki item ID by domain
 */
function findExistingWikiItem(finalDomain, originalDomain) {
    for (let i = 0; i < worldContext.worldWikiURLs.length; i++) {
        if (worldContext.worldWikiURLs[i].includes(finalDomain) || 
            worldContext.worldWikiURLs[i].includes(originalDomain)) {
            return worldContext.worldWikis[i].item;
        }
    }
    return null;
}

/**
 * Setup the event flow for processing
 */
function setupEventFlow() {
    // Handle list fetched - emit discovery events for each wiki
    eventBus.register(MirahezeEvents.LIST_FETCHED, 'miraheze:process-list', (dbNames) => {
        stats.total = dbNames.length;
        
        for (const db of dbNames) {
            const domain = `${db}.miraheze.org`;
            
            // Apply filter if provided
            if (scriptFilter !== undefined && !domain.includes(scriptFilter)) {
                continue;
            }
            
            stats.filtered++;
            eventBus.emit(MirahezeEvents.WIKI_DISCOVERED, { db, domain });
        }
        
        console.log(`   📋 Processing ${stats.filtered} wikis (from ${stats.total} total)`);
    });
    
    // Handle wiki discovery - resolve URL in queue
    eventBus.register(MirahezeEvents.WIKI_DISCOVERED, 'miraheze:resolve-url', ({ db, domain }) => {
        queues.many.add(async () => {
            const resolved = await resolveFinalUrl(db);
            if (!resolved) {
                stats.failed++;
                return;
            }
            
            const finalDomain = new URL(resolved.url).hostname;
            eventBus.emit(MirahezeEvents.WIKI_RESOLVED, { 
                db, 
                domain, 
                finalDomain, 
                html: resolved.html 
            });
        }, { jobName: `resolve:${domain}` });
    });
    
    // Handle resolved wiki - check if exists or new
    eventBus.register(MirahezeEvents.WIKI_RESOLVED, 'miraheze:check-exists', ({ db, domain, finalDomain, html }) => {
        queues.many.add(async () => {
            const existingItemId = findExistingWikiItem(finalDomain, domain);
            
            if (existingItemId) {
                eventBus.emit(MirahezeEvents.WIKI_EXISTS, { db, domain, finalDomain, existingItemId });
            } else {
                // Check if it's actually a Wikibase wiki
                if (!html.includes("wikibase") && !html.includes("Wikibase")) {
                    console.log(`   ⏭️ ${domain} does not appear to be a Wikibase wiki`);
                    stats.skipped++;
                    eventBus.emit(MirahezeEvents.WIKI_SKIPPED, { db, domain, reason: 'not-wikibase' });
                    return;
                }
                
                eventBus.emit(MirahezeEvents.WIKI_NEW, { db, domain, finalDomain });
            }
        }, { jobName: `check-exists:${domain}` });
    });
    
    // Handle existing wiki - ensure activity claim
    eventBus.register(MirahezeEvents.WIKI_EXISTS, 'miraheze:update-existing', ({ db, domain, finalDomain, existingItemId }) => {
        queues.four.add(async () => {
            const status = await getWikiStatus(db);
            
            world.queueWork.claimEnsure(
                queues.one,
                { id: existingItemId, property: 'P13', value: status },
                { summary: `Set activity [[Property:P13]] for Miraheze wiki to [[Item:${status}]] based on banners` }
            );
            
            console.log(`   ✅ Ensured activity for existing wiki: ${finalDomain} (${existingItemId}) → P13=${status}`);
            stats.existing++;
        }, { jobName: `update-existing:${domain}` });
    });
    
    // Handle new wiki - create item
    eventBus.register(MirahezeEvents.WIKI_NEW, 'miraheze:create-new', ({ db, domain, finalDomain }) => {
        queues.four.add(async () => {
            const status = await getWikiStatus(db);
            
            let labels = {};
            let aliases = {};
            
            if (finalDomain !== domain) {
                labels.en = finalDomain;
                aliases.en = [domain];
            } else {
                labels.en = domain;
            }
            
            const claims = {
                P1: "https://" + finalDomain,
                P2: MIRAHEZE_QID,
                P3: "Q10", // wikibase site
                P13: status,
            };
            
            world.queueWork.itemCreate(queues.one, {
                labels,
                ...(Object.keys(aliases).length > 0 && { aliases }),
                claims
            }, { summary: `Importing ${finalDomain} from Miraheze list: ${LIST_URL}` });
            
            console.log(`   🆕 Queued new wiki: ${finalDomain} (P13=${status})`);
            stats.new++;
        }, { jobName: `create-new:${domain}` });
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
    console.log(`   Total in list:    ${stats.total}`);
    console.log(`   Filtered:         ${stats.filtered}`);
    console.log(`   Existing updated: ${stats.existing}`);
    console.log(`   New created:      ${stats.new}`);
    console.log(`   Skipped:          ${stats.skipped}`);
    console.log(`   Failed:           ${stats.failed}`);
}

/**
 * Start the import process
 */
async function startImport() {
    console.log('🔄 Starting Miraheze Import v2');
    console.log('');
    
    // Initialize world context
    await initializeWorldContext();
    
    // Setup event flow
    setupEventFlow();
    
    // Log registered events
    console.log('');
    console.log('📋 Event Handlers:');
    for (const event of Object.values(MirahezeEvents)) {
        const handlers = eventBus.getHandlers(event);
        if (handlers.length > 0) {
            console.log(`   ${event}: ${handlers.join(', ')}`);
        }
    }
    console.log('');
    
    // Fetch and process the list
    console.log('📥 Fetching Miraheze wiki list...');
    queues.many.add(async () => {
        const dbNames = await fetchMirahezeDbList();
        console.log(`   Found ${dbNames.length} wikis in list`);
        eventBus.emit(MirahezeEvents.LIST_FETCHED, dbNames);
    }, { jobName: 'fetch-miraheze-list' });
    
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

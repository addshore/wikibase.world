/**
 * Import Google v2 - Event-driven Google search wiki importer
 * 
 * This script uses a modular event-driven architecture where:
 * 1. Fetcher retrieves search results from SerpAPI
 * 2. Each domain is processed through a queue
 * 3. Events coordinate checks and imports
 * 
 * Usage:
 *   node cmd/import-google-v2.js [filter]
 *   
 *   filter - Optional substring to filter domains
 */

import { getJson } from 'serpapi';
import { world } from '../src/world.js';
import { queues } from '../src/general.js';
import { checkOnlineAndWikibase } from '../src/site.js';
import { eventBus } from '../src/events/bus.js';
import dotenv from 'dotenv';
import process from 'process';

dotenv.config();

// Script filter (optional)
const scriptFilter = process.argv[2];
if (scriptFilter !== undefined) {
    console.log(`🚀 Running import-google-v2 with filter: ${scriptFilter}`);
}

// Event constants for this importer
const GoogleEvents = {
    // Search results fetched
    SEARCH_COMPLETE: 'google.search-complete',
    // Domain discovered from search
    DOMAIN_DISCOVERED: 'google.domain-discovered',
    // Domain is a valid Wikibase
    DOMAIN_VALID: 'google.domain-valid',
    // Domain already exists in wikibase.world
    DOMAIN_EXISTS: 'google.domain-exists',
    // Domain is new (not in wikibase.world)
    DOMAIN_NEW: 'google.domain-new',
    // Domain check failed
    DOMAIN_FAILED: 'google.domain-failed',
};

// Wikibase special pages to search for
const SPECIAL_PAGES = [
    "NewItem",
    "NewProperty",
];

// Domains to ignore in search results
const DOMAINS_TO_IGNORE = [
    "wikidata.org",
    "openstreetmap.org",
    "wikimedia.org",
    "mediawiki.org",
    "wikipedia.org",
    "wikinews.org",
    "wikifunctions.org",
    "github.com",
    "githubusercontent.com",
    "nist.gov",
    "withgoogle.com",
    "reddit.com",
    "facebook.com",
    "instagram.com",
    "twitter.com",
    "amazon.com",
    "mozilla.org",
    "learningwikibase.com",
    "translatewiki.net",
    "addshore.com",
    "cisa.gov",
    "tiktok.com",
    "sony.jp",
    "books.jq",
    "quora.com",
    "mail-archive.com",
    "mitre.org",
    "linkedin.com",
    "medium.com",
    "wikimedia.de",
    "readthedocs.io",
    "amazonaws.com",
    "youtube.com",
    "wikibase.cloud", // We have an API for that
];

// World context
let worldContext = {
    worldWikis: [],
    worldWikiURLs: [],
};

// Statistics
const stats = {
    searchResults: 0,
    uniqueDomains: 0,
    filtered: 0,
    existing: 0,
    new: 0,
    failed: 0,
};

/**
 * Build search term for SerpAPI
 */
function buildSearchTerm() {
    const pages = SPECIAL_PAGES.map(page => `"Special:${page}"`).join(" OR ");
    const sites = DOMAINS_TO_IGNORE.map(site => `-site:${site}`).join(" ");
    return `(${pages}) ${sites}`;
}

/**
 * SerpAPI configuration
 */
function getSerpConfig(query) {
    return {
        engine: "google",
        api_key: process.env.SERPAPI_KEY,
        q: query,
        location: "Austin, Texas",
        num: 100,
        nfpr: 1,
    };
}

/**
 * Initialize world context by querying known wikis
 */
async function initializeWorldContext() {
    console.log('🌍 Loading world context...');
    worldContext.worldWikis = await world.sparql.wikis();
    worldContext.worldWikiURLs = worldContext.worldWikis.map(wiki => wiki.site);
    console.log(`   Found ${worldContext.worldWikis.length} known wikis`);
}

/**
 * Check if domain already exists in world
 */
function domainExistsInWorld(domain) {
    return worldContext.worldWikiURLs.some(url => url.includes(domain));
}

/**
 * Setup the event flow for processing
 */
function setupEventFlow() {
    // Handle search complete - emit discovery events for each domain
    eventBus.register(GoogleEvents.SEARCH_COMPLETE, 'google:process-results', (domains) => {
        stats.uniqueDomains = domains.length;
        
        for (const domain of domains) {
            // Apply filter if provided
            if (scriptFilter !== undefined && domain !== scriptFilter) {
                continue;
            }
            
            stats.filtered++;
            eventBus.emit(GoogleEvents.DOMAIN_DISCOVERED, { domain });
        }
        
        console.log(`   📋 Processing ${stats.filtered} domains (from ${stats.uniqueDomains} unique)`);
    });
    
    // Handle domain discovery - check if valid Wikibase in queue
    eventBus.register(GoogleEvents.DOMAIN_DISCOVERED, 'google:check-domain', ({ domain }) => {
        queues.four.add(async () => {
            // First check if already exists
            if (domainExistsInWorld(domain)) {
                console.log(`   ⏭️ ${domain}: already exists`);
                stats.existing++;
                eventBus.emit(GoogleEvents.DOMAIN_EXISTS, { domain });
                return;
            }
            
            // Check if online and is a Wikibase
            const url = `https://${domain}`;
            const { result, text } = await checkOnlineAndWikibase(url);
            
            if (!result) {
                console.log(`   ❌ ${domain}: ${text}`);
                stats.failed++;
                eventBus.emit(GoogleEvents.DOMAIN_FAILED, { domain, reason: text });
                return;
            }
            
            eventBus.emit(GoogleEvents.DOMAIN_NEW, { domain });
        }, { jobName: `check-domain:${domain}` });
    });
    
    // Handle new domain - create item
    eventBus.register(GoogleEvents.DOMAIN_NEW, 'google:create-new', ({ domain }) => {
        const url = `https://${domain}`;
        
        world.queueWork.itemCreate(queues.one, {
            labels: { en: domain },
            claims: {
                P1: url,
                P3: "Q10", // wikibase site
                P13: 'Q54', // active
            }
        }, { summary: `Importing https://${domain} from Google search` });
        
        console.log(`   🆕 Queued new wiki: ${domain}`);
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
    console.log(`   Search results:   ${stats.searchResults}`);
    console.log(`   Unique domains:   ${stats.uniqueDomains}`);
    console.log(`   Filtered:         ${stats.filtered}`);
    console.log(`   Already existing: ${stats.existing}`);
    console.log(`   New created:      ${stats.new}`);
    console.log(`   Failed:           ${stats.failed}`);
}

/**
 * Start the import process
 */
async function startImport() {
    console.log('🔍 Starting Google Import v2');
    console.log('');
    
    // Check for API key
    if (!process.env.SERPAPI_KEY) {
        console.log('❌ SERPAPI_KEY environment variable not set');
        process.exit(1);
    }
    
    // Initialize world context
    await initializeWorldContext();
    
    // Setup event flow
    setupEventFlow();
    
    // Log registered events
    console.log('');
    console.log('📋 Event Handlers:');
    for (const event of Object.values(GoogleEvents)) {
        const handlers = eventBus.getHandlers(event);
        if (handlers.length > 0) {
            console.log(`   ${event}: ${handlers.join(', ')}`);
        }
    }
    console.log('');
    
    // Perform search and process results
    console.log('📥 Searching Google for Wikibase instances...');
    console.log(`   Search term: ${buildSearchTerm().substring(0, 80)}...`);
    
    queues.many.add(async () => {
        try {
            const response = await getJson(getSerpConfig(buildSearchTerm()));
            
            if (!response.organic_results) {
                console.log('   ❌ No organic results in response');
                return;
            }
            
            stats.searchResults = response.organic_results.length;
            console.log(`   Found ${stats.searchResults} search results`);
            
            // Extract unique domains
            let domains = response.organic_results.map(result => {
                try {
                    return new URL(result.link).hostname;
                } catch {
                    return null;
                }
            }).filter(Boolean);
            
            // Make unique
            domains = [...new Set(domains)];
            
            console.log(`   Extracted ${domains.length} unique domains`);
            eventBus.emit(GoogleEvents.SEARCH_COMPLETE, domains);
        } catch (e) {
            console.log(`   ❌ Search failed: ${e.message}`);
        }
    }, { jobName: 'google-search' });
    
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

/**
 * Tidy World v2 - Refactored event-driven wiki processor
 * 
 * This script uses a modular event-driven architecture where:
 * 1. Fetchers retrieve data and emit events
 * 2. Processors listen to events and produce edits
 * 3. The main script orchestrates the flow
 * 
 * Usage:
 *   node cmd/tidy-world-v2.js [filter]
 *   
 *   filter - Optional substring to filter wikis by URL
 */

import { simplifyClaims } from 'wikibase-sdk';
import { fetchuc, fetchc } from '../src/fetch.js';
import { world } from '../src/world.js';
import { queues, HEADERS, queueConcurrency } from '../src/general.js';
import { eventBus, Events } from '../src/events/bus.js';
import { registerAllFetchers } from '../src/jobs/fetchers/index.js';
import { registerAllProcessors } from '../src/jobs/processors/index.js';
import { fetchReverseDNS } from '../src/jobs/fetchers/reverse-dns.js';
import { metadatalookup } from '../src/metadata.js';
import process from 'process';

// Configuration
const scriptFilter = process.argv[2];
if (scriptFilter !== undefined) {
    console.log(`🚀 Running with script filter: ${scriptFilter}`);
}

// World context (shared data about known wikis)
let worldContext = {
    worldWikis: [],
    worldWikiURLs: [],
    worldWikiDomains: [],
    worldWikiItems: [],
};

// Known world properties
const WIKIBASE_METADATA_PROPERTY = 'P53';

/**
 * Initialize world context by querying known wikis
 */
async function initializeWorldContext() {
    console.log('🌍 Loading world context...');
    worldContext.worldWikis = await world.sparql.wikis();
    worldContext.worldWikiURLs = worldContext.worldWikis.map(wiki => wiki.site);
    worldContext.worldWikiDomains = worldContext.worldWikiURLs.map(url => new URL(url).hostname);
    worldContext.worldWikiItems = worldContext.worldWikis.map(wiki => wiki.item);
    console.log(`   Found ${worldContext.worldWikis.length} known wikis`);
}

/**
 * Setup the core event flow for wiki discovery and processing
 */
function setupEventFlow() {
    // Listen for wiki discovery and check if alive
    eventBus.register(Events.WIKI_DISCOVERED, 'core:check-alive', (wiki) => {
        queues.many.add(async () => {
            try {
                let response = await fetchc(wiki.site, {
                    method: 'HEAD',
                    headers: HEADERS,
                    debugLabel: 'tidy-world:check-alive:head',
                    diagnostics: { wikiItem: wiki.item, wikiSite: wiki.site }
                });
                let responseText;

                if (response && response.status === 200) {
                    const linkHeader = response.headers.get('Link');
                    if (linkHeader && linkHeader.includes('rel="EditURI"')) {
                        // If we have the EditURI in the Link header, we consider it alive
                        eventBus.emit(Events.WIKI_ALIVE, { wiki, response });
                        return;
                    }
                }

                // Fallback to GET if HEAD failed or didn't have EditURI Link header
                response = await fetchc(wiki.site, {
                    headers: HEADERS,
                    debugLabel: 'tidy-world:check-alive:get',
                    diagnostics: { wikiItem: wiki.item, wikiSite: wiki.site }
                });
                responseText = await response?.text();
                
                if (!response || !responseText) {
                    eventBus.emit(Events.WIKI_DEAD, { wiki, reason: 'No response' });
                    return;
                }
                
                response.loadedText = responseText;
                const finalUrl = response.url;
                
                // Check for domain redirect
                if (new URL(finalUrl).hostname !== new URL(wiki.site).hostname) {
                    console.log(`❌ The URL ${wiki.site} redirected to a different domain: ${finalUrl}`);
                    return;
                }
                
                // Check for MediaWiki
                if (!responseText.includes('content="MediaWiki')) {
                    console.log(`❌ The URL ${wiki.site} is not a MediaWiki, aborting...`);
                    return;
                }
                
                const is200 = response.status === 200;
                const is404WithNoText = response.status === 404 && 
                    responseText.includes("There is currently no text in this page");
                
                if (is200 || is404WithNoText) {
                    eventBus.emit(Events.WIKI_ALIVE, { wiki, response });
                } else {
                    eventBus.emit(Events.WIKI_DEAD, { wiki, reason: `HTTP ${response.status}` });
                }
            } catch (e) {
                console.log(`❌ Failed to check ${wiki.site}: ${e.message}`);
                eventBus.emit(Events.WIKI_DEAD, { wiki, reason: e.message });
            }
        }, { jobName: `check-wiki:${wiki.item}` });
    });
    
    // Handle dead wikis
    eventBus.register(Events.WIKI_DEAD, 'core:log-dead', ({ wiki, reason }) => {
        console.log(`❌ Wiki ${wiki.site} appears dead: ${reason}`);
    });
    
    // Build wiki context when alive - wrap in queue to ensure proper tracking
    eventBus.register(Events.WIKI_ALIVE, 'core:build-context', ({ wiki, response }) => {
        queues.many.add(async () => {
            try {
                await buildWikiContext(wiki, response);
                
                // Emit context ready event with all processors can listen to
                eventBus.emit(Events.WIKI_CONTEXT_READY, { 
                    wiki, 
                    response, 
                    queues,
                    worldContext 
                });
            } catch (e) {
                console.log(`❌ Failed to build context for ${wiki.site}: ${e.message}`);
            }
        }, { jobName: `build-context:${wiki.item}` });
    });
}

/**
 * Build the wiki context with all necessary data
 * @param {Object} wiki - The wiki object
 * @param {Object} response - The HTTP response
 */
async function buildWikiContext(wiki, response) {
    wiki.url = wiki.site;
    wiki.responseText = response.loadedText || '';
    wiki.domain = wiki.site.replace('https://', '').replace('http://', '').split('/')[0];
    
    // Perform reverse DNS lookup
    wiki.reverseDNS = await fetchReverseDNS(wiki.domain);
    
    // Extract action API from EditURI
    wiki.actionApi = extractActionApi(wiki.responseText, response);
    wiki.restApi = wiki.actionApi?.replace('/api.php', '/rest.php') || null;
    
    // Extract page meta data
    extractPageMeta(wiki);
    
    // Load entity from wikibase.world
    await loadWikiEntity(wiki);
    
    // Load wikibase metadata if available
    if (wiki.simpleClaims[WIKIBASE_METADATA_PROPERTY]) {
        if (wiki.simpleClaims[WIKIBASE_METADATA_PROPERTY].length === 1) {
            wiki.wbmetadata = await metadatalookup(wiki.simpleClaims[WIKIBASE_METADATA_PROPERTY]);
        } else {
            console.log(`❌ The item ${wiki.item} has more than 1 ${WIKIBASE_METADATA_PROPERTY} claim`);
        }
    }
}

/**
 * Extract action API URL from response text or Link header
 */
function extractActionApi(responseText, response = null) {
    let apiUrl = null;

    // Try Link header first
    if (response && typeof response.headers?.get === 'function') {
        const linkHeader = response.headers.get('Link');
        if (linkHeader) {
            const match = linkHeader.match(/<(.+?)>;\s*rel="EditURI"/);
            if (match) {
                apiUrl = match[1];
            }
        }
    }

    // Fallback to HTML parsing
    if (!apiUrl && responseText) {
        const matches = responseText.match(/<link rel="EditURI" type="application\/rsd\+xml" href="(.+?)"/);
        if (matches) {
            apiUrl = matches[1];
        }
    }

    if (!apiUrl) return null;

    apiUrl = apiUrl.replace('?action=rsd', '');
    if (apiUrl.startsWith('//')) {
        apiUrl = 'https:' + apiUrl;
    }
    return apiUrl;
}

/**
 * Extract page meta data from response text
 */
function extractPageMeta(wiki) {
    // Title
    const titleMatch = wiki.responseText.match(/<title>(.+?)<\/title>/);
    wiki.title = titleMatch ? titleMatch[1] : undefined;
    
    // Meta description
    const descMatch = wiki.responseText.match(/<meta name="description" content="(.+?)"/);
    if (descMatch && descMatch[1].length >= 4) {
        wiki.metaDescription = descMatch[1]
            .replace(/&#(\d+);/g, (m, code) => String.fromCharCode(code))
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>');
    }
    
    // Generator (MediaWiki version)
    const genMatch = wiki.responseText.match(/<meta name="generator" content="(.+?)"/);
    if (genMatch) {
        wiki.metaGenerator = genMatch[1];
        const versionMatch = wiki.metaGenerator.match(/MediaWiki (.+?)$/);
        wiki.mwVersion = versionMatch ? versionMatch[1] : undefined;
    }
    
    // Language
    const langMatch = wiki.responseText.match(/"wgPageContentLanguage":"(.+?)"/);
    wiki.language = langMatch ? langMatch[1] : 'en';
}

/**
 * Load wiki entity from wikibase.world
 */
async function loadWikiEntity(wiki) {
    const { entities } = await fetchuc(world.sdk.getEntities({ ids: [wiki.item] }), { headers: HEADERS })
        .then(res => res?.json() || { entities: {} });
    
    if (!entities?.[wiki.item]) {
        throw new Error(`Entity ${wiki.item} does not exist`);
    }
    
    wiki.entity = entities[wiki.item];
    wiki.simpleClaims = simplifyClaims(wiki.entity.claims);
}

/**
 * Wait for all queues to be idle (with settling time to allow new jobs to be added)
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
 * Start the tidy process
 */
async function startTidy() {
    console.log('🧹 Starting Tidy World v2');
    console.log('');
    console.log('🛠️ Runtime configuration');
    console.log(`   Node: ${process.version}`);
    console.log(`   Platform: ${process.platform} ${process.arch}`);
    console.log(`   Fetch timeout: ${process.env.FETCH_TIMEOUT_MS || '10000'}ms`);
    console.log(`   Fetch retry delay: ${process.env.FETCH_RETRY_DELAY_MS || '10000'}ms`);
    console.log(`   Fetch debug: ${process.env.FETCH_DEBUG || '0'}`);
    console.log(`   Fetch debug DNS: ${process.env.FETCH_DEBUG_DNS || '0'}`);
    console.log(`   Queue concurrency: many=${queueConcurrency.many}, four=${queueConcurrency.four}, one=${queueConcurrency.one}`);
    console.log('');
    
    // Initialize world context
    await initializeWorldContext();
    
    // Setup event flow
    setupEventFlow();
    
    // Register all fetchers and processors
    registerAllFetchers(queues);
    registerAllProcessors();
    
    // Log registered events
    eventBus.logRegistrations();
    console.log('');
    
    // Trigger initial wiki discovery
    console.log('🔍 Discovering wikis...');
    queues.many.add(async () => {
        let results = await world.sparql.wikis();
        
        // Shuffle for randomness
        results.sort(() => Math.random() - 0.5);
        
        // Apply filter if provided
        if (scriptFilter !== undefined) {
            results = results.filter(wiki => wiki.site.includes(scriptFilter));
            console.log(`   Filtered to ${results.length} wikis`);
            // If there are 10 or less, print up to 10, if there are more than then, add "..." as a final line
            if (results.length <= 10) {
                console.log(`   ${results.map(wiki => wiki.site).join('\n   ')}`);
            } else {
                console.log(`   ${results.slice(0, 10).map(wiki => wiki.site).join('\n   ')}\n   ...`);
            }
        }
        
        // Emit discovery event for each wiki
        for (const wiki of results) {
            eventBus.emit(Events.WIKI_DISCOVERED, wiki);
        }
        
        console.log(`   Queued ${results.length} wikis for processing`);
    }, { jobName: 'fetch-world-wikis' });
    
    // Wait for all work to complete
    await waitForQueues();
    console.log('');
    console.log('✅ All processing complete!');
    process.exit(0);
}

// Run!
startTidy();

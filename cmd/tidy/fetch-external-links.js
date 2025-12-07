/**
 * Fetch External Links - Find wiki-to-wiki links
 * 
 * This script fetches external links from each wiki and creates
 * links (P55/P56) between wikis in wikibase.world.
 * 
 * Usage:
 *   node cmd/tidy/fetch-external-links.js [filter]
 */

import { simplifyClaims } from 'wikibase-sdk';
import { fetchuc } from '../../src/fetch.js';
import { world } from '../../src/world.js';
import { queues, HEADERS } from '../../src/general.js';
import process from 'process';

// Script filter (optional)
const scriptFilter = process.argv[2];
if (scriptFilter !== undefined) {
    console.log(`🚀 Running with filter: ${scriptFilter}`);
}

// World context (for looking up other wikis)
let worldContext = {
    worldWikis: [],
    worldWikiURLs: [],
    worldWikiDomains: [],
};

// Statistics
const stats = {
    total: 0,
    processed: 0,
    linksFound: 0,
    failed: 0,
};

/**
 * Initialize world context
 */
async function initializeWorldContext() {
    console.log('🌍 Loading world context...');
    worldContext.worldWikis = await world.sparql.wikis();
    worldContext.worldWikiURLs = worldContext.worldWikis.map(wiki => wiki.site);
    worldContext.worldWikiDomains = worldContext.worldWikiURLs.map(url => {
        try {
            return new URL(url).hostname;
        } catch {
            return null;
        }
    }).filter(Boolean);
    console.log(`   Found ${worldContext.worldWikis.length} known wikis`);
}

/**
 * Find wiki item by domain
 */
function findWikiByDomain(domain) {
    for (let i = 0; i < worldContext.worldWikiDomains.length; i++) {
        if (worldContext.worldWikiDomains[i] === domain) {
            return worldContext.worldWikis[i];
        }
    }
    return null;
}

/**
 * Fetch external links from wiki
 */
async function fetchExternalLinks(actionApi) {
    const url = `${actionApi}?action=query&list=exturlusage&eulimit=500&format=json`;
    try {
        const response = await fetchuc(url, { headers: HEADERS });
        if (!response) return [];
        const data = await response.json();
        
        const links = data?.query?.exturlusage || [];
        return links.map(l => l.url);
    } catch {
        return [];
    }
}

/**
 * Extract domains from URLs
 */
function extractDomains(urls) {
    const domains = new Set();
    for (const url of urls) {
        try {
            const domain = new URL(url).hostname;
            domains.add(domain);
        } catch {
            // Ignore invalid URLs
        }
    }
    return Array.from(domains);
}

/**
 * Process a single wiki
 */
async function processWiki(wiki) {
    try {
        // Load entity
        const { entities } = await fetchuc(world.sdk.getEntities({ ids: [wiki.item] }), { headers: HEADERS })
            .then(res => res?.json() || { entities: {} });
        
        if (!entities?.[wiki.item]) {
            stats.failed++;
            return;
        }
        
        const simpleClaims = simplifyClaims(entities[wiki.item].claims);
        
        // Get action API
        let actionApi = simpleClaims.P6?.[0];
        if (!actionApi) {
            const siteUrl = wiki.site.replace(/\/$/, '');
            actionApi = `${siteUrl}/w/api.php`;
        }
        
        const externalLinks = await fetchExternalLinks(actionApi);
        const linkedDomains = extractDomains(externalLinks);
        
        let linksCreated = 0;
        
        for (const domain of linkedDomains) {
            const linkedWiki = findWikiByDomain(domain);
            if (linkedWiki && linkedWiki.item !== wiki.item) {
                // Create link from this wiki to linked wiki (P55)
                world.queueWork.claimEnsure(
                    queues.one,
                    { id: wiki.item, property: 'P55', value: linkedWiki.item },
                    { summary: `Add [[Property:P55]] to [[Item:${linkedWiki.item}]] from external links` }
                );
                
                // Create reverse link (P56)
                world.queueWork.claimEnsure(
                    queues.one,
                    { id: linkedWiki.item, property: 'P56', value: wiki.item },
                    { summary: `Add [[Property:P56]] from [[Item:${wiki.item}]] via external links` }
                );
                
                linksCreated++;
                stats.linksFound++;
            }
        }
        
        if (linksCreated > 0) {
            console.log(`   ✅ ${wiki.site}: ${linksCreated} wiki links found`);
        }
        stats.processed++;
    } catch (e) {
        console.log(`   ❌ ${wiki.site}: ${e.message}`);
        stats.failed++;
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
 * Print statistics
 */
function printStats() {
    console.log('');
    console.log('📊 Statistics:');
    console.log(`   Total:        ${stats.total}`);
    console.log(`   Processed:    ${stats.processed}`);
    console.log(`   Links found:  ${stats.linksFound}`);
    console.log(`   Failed:       ${stats.failed}`);
}

/**
 * Main
 */
async function main() {
    console.log('🔗 Fetch External Links - Wiki-to-Wiki Links');
    console.log('');
    
    await initializeWorldContext();
    
    let wikis = worldContext.worldWikis;
    
    // Shuffle for randomness
    wikis.sort(() => Math.random() - 0.5);
    
    // Apply filter
    if (scriptFilter) {
        wikis = wikis.filter(w => w.site.includes(scriptFilter));
        console.log(`   Filtered to ${wikis.length} wikis`);
    }
    
    stats.total = wikis.length;
    console.log(`   Processing ${wikis.length} wikis`);
    console.log('');
    
    // Queue all wiki processing
    for (const wiki of wikis) {
        queues.many.add(() => processWiki(wiki), { jobName: `extlinks:${wiki.item}` });
    }
    
    // Wait for completion
    await waitForQueues();
    
    printStats();
    console.log('');
    console.log('✅ All processing complete!');
    process.exit(0);
}

main();

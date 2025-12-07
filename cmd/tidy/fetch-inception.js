/**
 * Fetch Inception - Find wiki creation dates
 * 
 * This script finds the inception date (P5) for wikis that don't have it set.
 * It queries the wiki's log API for the first log entry.
 * 
 * Usage:
 *   node cmd/tidy/fetch-inception.js [filter]
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

// Statistics
const stats = {
    total: 0,
    alreadyHasInception: 0,
    found: 0,
    notFound: 0,
    failed: 0,
};

/**
 * Get action API for wiki
 */
async function getWikiData(wiki) {
    const { entities } = await fetchuc(world.sdk.getEntities({ ids: [wiki.item] }), { headers: HEADERS })
        .then(res => res?.json() || { entities: {} });
    
    if (!entities?.[wiki.item]) return null;
    
    wiki.entity = entities[wiki.item];
    wiki.simpleClaims = simplifyClaims(wiki.entity.claims);
    
    // Check if already has inception
    if (wiki.simpleClaims.P5?.length > 0) {
        return { hasInception: true };
    }
    
    // Get action API
    let actionApi = wiki.simpleClaims.P6?.[0];
    if (!actionApi) {
        const siteUrl = wiki.site.replace(/\/$/, '');
        actionApi = `${siteUrl}/w/api.php`;
    }
    
    return { actionApi, hasInception: false };
}

/**
 * Fetch inception date from wiki log
 */
async function fetchInceptionDate(actionApi) {
    const url = `${actionApi}?action=query&list=logevents&ledir=newer&lelimit=1&format=json`;
    try {
        const response = await fetchuc(url, { headers: HEADERS });
        if (!response) return null;
        const data = await response.json();
        
        const logEvents = data?.query?.logevents;
        if (!logEvents || logEvents.length === 0) return null;
        
        const firstEvent = logEvents[0];
        const timestamp = firstEvent.timestamp;
        
        // Parse timestamp to date (YYYY-MM-DD format for Wikibase)
        const date = timestamp.split('T')[0];
        return { date, logApiUrl: url };
    } catch {
        return null;
    }
}

/**
 * Process a single wiki
 */
async function processWiki(wiki) {
    try {
        const wikiData = await getWikiData(wiki);
        if (!wikiData) {
            stats.failed++;
            return;
        }
        
        if (wikiData.hasInception) {
            stats.alreadyHasInception++;
            return;
        }
        
        const result = await fetchInceptionDate(wikiData.actionApi);
        if (!result) {
            console.log(`   ⏭️ ${wiki.site}: No log entries found`);
            stats.notFound++;
            return;
        }
        
        const today = new Date().toISOString().split('T')[0];
        
        world.queueWork.claimEnsure(
            queues.one,
            { 
                id: wiki.item, 
                property: 'P5', 
                value: result.date,
                references: { P21: result.logApiUrl, P22: today }
            },
            { summary: `Set [[Property:P5]] to ${result.date} from first log entry` }
        );
        
        console.log(`   ✅ ${wiki.site}: Inception ${result.date}`);
        stats.found++;
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
    console.log(`   Total:              ${stats.total}`);
    console.log(`   Already has P5:     ${stats.alreadyHasInception}`);
    console.log(`   Found inception:    ${stats.found}`);
    console.log(`   No logs found:      ${stats.notFound}`);
    console.log(`   Failed:             ${stats.failed}`);
}

/**
 * Main
 */
async function main() {
    console.log('📅 Fetch Inception - Wiki Creation Dates');
    console.log('');
    
    console.log('🌍 Loading wikis from wikibase.world...');
    let wikis = await world.sparql.wikis();
    
    // Shuffle for randomness
    wikis.sort(() => Math.random() - 0.5);
    
    // Apply filter
    if (scriptFilter) {
        wikis = wikis.filter(w => w.site.includes(scriptFilter));
        console.log(`   Filtered to ${wikis.length} wikis`);
    }
    
    stats.total = wikis.length;
    console.log(`   Found ${wikis.length} wikis to check`);
    console.log('');
    
    // Queue all wiki processing
    for (const wiki of wikis) {
        queues.many.add(() => processWiki(wiki), { jobName: `inception:${wiki.item}` });
    }
    
    // Wait for completion
    await waitForQueues();
    
    printStats();
    console.log('');
    console.log('✅ All processing complete!');
    process.exit(0);
}

main();

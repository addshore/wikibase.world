/**
 * Fetch Manifest - Load Wikibase manifest data
 * 
 * This script fetches the Wikibase manifest from each wiki's REST API
 * and extracts entity counts (property count, max item ID).
 * 
 * Only processes wikis that have an action API defined (or inferrable).
 * 
 * Usage:
 *   node cmd/tidy/fetch-manifest.js [filter]
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
    success: 0,
    noManifest: 0,
    failed: 0,
    updated: {
        propertyCount: 0,
        maxItemId: 0,
    },
};

/**
 * Get REST API for wiki
 */
async function getWikiData(wiki) {
    const { entities } = await fetchuc(world.sdk.getEntities({ ids: [wiki.item] }), { headers: HEADERS })
        .then(res => res?.json() || { entities: {} });
    
    if (!entities?.[wiki.item]) return null;
    
    wiki.entity = entities[wiki.item];
    wiki.simpleClaims = simplifyClaims(wiki.entity.claims);
    
    // Get REST API (P8 or infer from action API)
    let restApi = wiki.simpleClaims.P8?.[0];
    if (!restApi) {
        let actionApi = wiki.simpleClaims.P6?.[0];
        if (!actionApi) {
            const siteUrl = wiki.site.replace(/\/$/, '');
            actionApi = `${siteUrl}/w/api.php`;
        }
        restApi = actionApi.replace('/api.php', '/rest.php');
    }
    
    return { restApi, simpleClaims: wiki.simpleClaims };
}

/**
 * Fetch manifest from wiki
 */
async function fetchManifest(restApi) {
    const url = `${restApi}/wikibase/v0/manifest`;
    try {
        const response = await fetchuc(url, { headers: HEADERS });
        if (!response || response.status !== 200) return null;
        return await response.json();
    } catch {
        return null;
    }
}

/**
 * Get max item ID from REST API
 */
async function fetchMaxItemId(restApi) {
    const url = `${restApi}/wikibase/v0/entities/items`;
    try {
        const response = await fetchuc(url, { headers: HEADERS });
        if (!response || response.status !== 200) return null;
        const data = await response.json();
        
        // The API returns the highest item IDs
        if (data && Array.isArray(data) && data.length > 0) {
            const maxId = data[0].replace('Q', '');
            return parseInt(maxId, 10);
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Get property count from REST API
 */
async function fetchPropertyCount(restApi) {
    const url = `${restApi}/wikibase/v0/entities/properties`;
    try {
        const response = await fetchuc(url, { headers: HEADERS });
        if (!response || response.status !== 200) return null;
        const data = await response.json();
        
        if (data && Array.isArray(data)) {
            return data.length;
        }
        return null;
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
        
        const manifest = await fetchManifest(wikiData.restApi);
        if (!manifest) {
            stats.noManifest++;
            return;
        }
        
        let updates = [];
        
        // Get property count
        const propertyCount = await fetchPropertyCount(wikiData.restApi);
        if (propertyCount !== null) {
            const current = wikiData.simpleClaims.P58?.[0];
            if (current !== propertyCount) {
                world.queueWork.claimEnsure(
                    queues.one,
                    { id: wiki.item, property: 'P58', value: propertyCount },
                    { summary: `Set [[Property:P58]] to ${propertyCount} from REST API` }
                );
                updates.push(`Properties: ${propertyCount}`);
                stats.updated.propertyCount++;
            }
        }
        
        // Get max item ID
        const maxItemId = await fetchMaxItemId(wikiData.restApi);
        if (maxItemId !== null) {
            const current = wikiData.simpleClaims.P67?.[0];
            if (current !== maxItemId) {
                world.queueWork.claimEnsure(
                    queues.one,
                    { id: wiki.item, property: 'P67', value: maxItemId },
                    { summary: `Set [[Property:P67]] to ${maxItemId} from REST API` }
                );
                updates.push(`Max Item: Q${maxItemId}`);
                stats.updated.maxItemId++;
            }
        }
        
        if (updates.length > 0) {
            console.log(`   ✅ ${wiki.site}: ${updates.join(', ')}`);
        } else {
            console.log(`   ✅ ${wiki.site}: manifest found, no updates needed`);
        }
        stats.success++;
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
    console.log(`   Total:           ${stats.total}`);
    console.log(`   Success:         ${stats.success}`);
    console.log(`   No manifest:     ${stats.noManifest}`);
    console.log(`   Failed:          ${stats.failed}`);
    console.log(`   Updates:`);
    console.log(`     Property count: ${stats.updated.propertyCount}`);
    console.log(`     Max item ID:    ${stats.updated.maxItemId}`);
}

/**
 * Main
 */
async function main() {
    console.log('📦 Fetch Manifest - Wikibase REST API Data');
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
        queues.many.add(() => processWiki(wiki), { jobName: `manifest:${wiki.item}` });
    }
    
    // Wait for completion
    await waitForQueues();
    
    printStats();
    console.log('');
    console.log('✅ All processing complete!');
    process.exit(0);
}

main();
